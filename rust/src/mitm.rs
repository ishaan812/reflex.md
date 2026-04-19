//! Hudsucker handler that converts intercepted HTTP into `CaptureEvent`s.
//!
//! MVP strategy: buffer the whole body up to `MAX_BODY`, emit events, and
//! reconstruct the request/response with the same bytes so it still flows
//! through to the client/origin.

use anyhow::anyhow;
use base64::{engine::general_purpose::STANDARD, Engine as _};
use bytes::Bytes;
use http::uri::Scheme;
use http_body_util::{BodyExt, Full};
use hudsucker::{
    hyper::{Request, Response},
    hyper_util::client::legacy::Error as UpstreamError,
    Body, HttpContext, HttpHandler, RequestOrResponse,
};
use std::{
    collections::HashSet,
    sync::Arc,
    time::{Instant, SystemTime},
};
use tokio::sync::{broadcast, Mutex};
use tracing::{debug, warn};
use uuid::Uuid;

use crate::event::{CaptureEvent, Headers};

/// 10 MiB is enough for a full ChatGPT/Claude SSE burst; anything larger is truncated.
const MAX_BODY: usize = 10 * 1024 * 1024;

#[derive(Clone)]
pub struct RecordingHandler {
    pub tx: broadcast::Sender<CaptureEvent>,
    pub allowlist: Arc<HashSet<String>>,
    /// Per-flow scratch: id + start instant, keyed by the handler clone used
    /// for a single req/resp pair. Hudsucker gives each pair its own clone.
    flow: Arc<Mutex<Option<FlowScratch>>>,
}

#[derive(Debug)]
struct FlowScratch {
    id: String,
    started: Instant,
}

impl RecordingHandler {
    pub fn new(tx: broadcast::Sender<CaptureEvent>, allowlist: HashSet<String>) -> Self {
        Self {
            tx,
            allowlist: Arc::new(allowlist),
            flow: Arc::new(Mutex::new(None)),
        }
    }

    fn allowed(&self, host: &str) -> bool {
        if self.allowlist.is_empty() {
            return true;
        }
        // Allow exact host match or suffix match (e.g. "api.openai.com" covers subdomains).
        self.allowlist
            .iter()
            .any(|h| host == h || host.ends_with(&format!(".{h}")))
    }

    fn emit(&self, ev: CaptureEvent) {
        // Best-effort; if nobody is listening, drop it.
        let _ = self.tx.send(ev);
    }
}

impl HttpHandler for RecordingHandler {
    async fn should_intercept(&mut self, _ctx: &HttpContext, req: &Request<Body>) -> bool {
        // For CONNECT (authority-form) requests the host is on the URI itself;
        // for absolute-form and plain HTTP we may need the Host header.
        let host = req
            .uri()
            .host()
            .map(|s| s.to_owned())
            .or_else(|| {
                req.headers()
                    .get(http::header::HOST)
                    .and_then(|v| v.to_str().ok())
                    .map(|s| s.split(':').next().unwrap_or(s).to_owned())
            })
            .unwrap_or_default();
        let ok = self.allowed(&host);
        if !ok {
            debug!("skip (not in allowlist): {host}");
        }
        ok
    }

    async fn handle_request(
        &mut self,
        _ctx: &HttpContext,
        req: Request<Body>,
    ) -> RequestOrResponse {
        // CONNECT requests are the TLS tunnel setup that hudsucker intercepts
        // to perform the MITM. We don't want to surface them as user-visible
        // flows — the decrypted request that follows is what users care about.
        if req.method() == http::Method::CONNECT {
            return RequestOrResponse::Request(req);
        }

        let (parts, body) = req.into_parts();

        let uri = parts.uri.clone();
        let host = uri.host().unwrap_or("").to_string();
        let port = uri.port_u16().unwrap_or_else(|| {
            match uri.scheme().cloned().unwrap_or(Scheme::HTTPS).as_str() {
                "http" => 80,
                _ => 443,
            }
        });
        let scheme = uri
            .scheme_str()
            .map(|s| s.to_owned())
            .unwrap_or_else(|| "https".to_owned());
        let path = uri
            .path_and_query()
            .map(|p| p.as_str().to_owned())
            .unwrap_or_else(|| "/".to_owned());
        let method = parts.method.to_string();
        let http_version = format!("{:?}", parts.version);

        let id = Uuid::new_v4().to_string();
        let started = Instant::now();
        *self.flow.lock().await = Some(FlowScratch {
            id: id.clone(),
            started,
        });

        self.emit(CaptureEvent::FlowStart {
            id: id.clone(),
            ts: rfc3339_now(),
            method,
            scheme,
            host,
            port,
            path,
            url: uri.to_string(),
            http_version,
        });
        self.emit(CaptureEvent::RequestHead {
            id: id.clone(),
            headers: headers_to_map(&parts.headers),
        });

        // Buffer the body, emit, and hand a fresh body to the upstream.
        let (bytes, truncated) = match collect_capped(body).await {
            Ok(b) => b,
            Err(e) => {
                warn!("request body collect failed: {e}");
                return RequestOrResponse::Response(Response::new(Body::empty()));
            }
        };
        self.emit(CaptureEvent::RequestBody {
            id,
            body_b64: STANDARD.encode(&bytes),
            truncated,
            byte_len: bytes.len(),
        });

        let new_req = Request::from_parts(parts, Body::from(Full::new(bytes)));
        RequestOrResponse::Request(new_req)
    }

    async fn handle_response(&mut self, _ctx: &HttpContext, res: Response<Body>) -> Response<Body> {
        let (id, started) = match self.flow.lock().await.as_ref() {
            Some(f) => (f.id.clone(), f.started),
            None => return res, // unlikely — response without prior request
        };

        let (parts, body) = res.into_parts();
        self.emit(CaptureEvent::ResponseHead {
            id: id.clone(),
            status: parts.status.as_u16(),
            http_version: format!("{:?}", parts.version),
            headers: headers_to_map(&parts.headers),
        });

        let (bytes, truncated) = match collect_capped(body).await {
            Ok(b) => b,
            Err(e) => {
                warn!("response body collect failed: {e}");
                self.emit(CaptureEvent::FlowEnd {
                    id,
                    duration_ms: started.elapsed().as_millis() as u64,
                    error: Some(e.to_string()),
                });
                return Response::from_parts(parts, Body::empty());
            }
        };
        self.emit(CaptureEvent::ResponseBody {
            id: id.clone(),
            body_b64: STANDARD.encode(&bytes),
            truncated,
            byte_len: bytes.len(),
        });
        self.emit(CaptureEvent::FlowEnd {
            id,
            duration_ms: started.elapsed().as_millis() as u64,
            error: None,
        });

        Response::from_parts(parts, Body::from(Full::new(bytes)))
    }

    async fn handle_error(
        &mut self,
        _ctx: &HttpContext,
        err: UpstreamError,
    ) -> Response<Body> {
        if let Some(f) = self.flow.lock().await.as_ref() {
            self.emit(CaptureEvent::FlowEnd {
                id: f.id.clone(),
                duration_ms: f.started.elapsed().as_millis() as u64,
                error: Some(err.to_string()),
            });
        }
        let msg = format!("reflex-capture upstream error: {err}");
        Response::builder()
            .status(502)
            .body(Body::from(Full::new(Bytes::from(msg))))
            .expect("valid response")
    }
}

/// Collect a body, clipped to `MAX_BODY`. Returns `(bytes, truncated)`.
async fn collect_capped(body: Body) -> anyhow::Result<(Bytes, bool)> {
    let collected = body
        .collect()
        .await
        .map_err(|e| anyhow!("body collect: {e}"))?;
    let full = collected.to_bytes();
    if full.len() > MAX_BODY {
        Ok((full.slice(0..MAX_BODY), true))
    } else {
        Ok((full, false))
    }
}

fn headers_to_map(h: &http::HeaderMap) -> Headers {
    let mut out = Headers::new();
    for (k, v) in h.iter() {
        let val = v.to_str().unwrap_or("<binary>").to_owned();
        out.insert(k.as_str().to_owned(), val);
    }
    out
}

fn rfc3339_now() -> String {
    // chrono is pulled in transitively; keeps formatting simple.
    let now: chrono::DateTime<chrono::Utc> = SystemTime::now().into();
    now.to_rfc3339()
}
