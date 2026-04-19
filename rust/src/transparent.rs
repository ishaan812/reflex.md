//! Transparent-mode entry point.
//!
//! Apps like Bun-compiled binaries (`opencode`), Go clients, and macOS
//! NetworkExtension-backed desktop apps frequently ignore `HTTPS_PROXY` and
//! even the system-wide proxy. To capture them we combine:
//!
//!   1. `pf` rules that redirect outbound TCP :443 from this host to
//!      `127.0.0.1:<transparent_port>`  (see `scripts/install-hooks.sh`)
//!   2. This module, which receives those redirected flows, peeks the SNI
//!      from the TLS ClientHello, opens a regular connection to the
//!      **already-running hudsucker HTTP proxy**, issues a synthetic
//!      `CONNECT <sni>:443` so hudsucker does its normal MITM, then pipes
//!      bytes bidirectionally.
//!
//! This way all the existing TLS/HTTP plumbing (CA, handler, event stream,
//! the renderer) keeps working. The transparent layer only adds a minimal
//! TCP↔TCP shuttle in front of hudsucker.

use anyhow::{anyhow, Context, Result};
use std::net::SocketAddr;
use tls_parser::{
    parse_tls_extensions, parse_tls_plaintext, TlsExtension, TlsMessage, TlsMessageHandshake,
};
use tokio::{
    io::{AsyncReadExt, AsyncWriteExt},
    net::{TcpListener, TcpStream},
};
use tracing::{info, warn};

/// Bind the transparent listener on `127.0.0.1:port` (port=0 → OS-assigned).
pub async fn bind(port: u16) -> Result<(TcpListener, u16)> {
    let addr: SocketAddr = ([127, 0, 0, 1], port).into();
    let listener = TcpListener::bind(addr)
        .await
        .with_context(|| format!("binding transparent listener on {addr}"))?;
    let port = listener.local_addr()?.port();
    Ok((listener, port))
}

/// Accept connections forever and shuttle them into `hudsucker_addr`.
pub async fn serve(listener: TcpListener, hudsucker_addr: SocketAddr) -> Result<()> {
    info!(
        "transparent listener on {}, relaying into hudsucker at {}",
        listener.local_addr().expect("listener addr"),
        hudsucker_addr
    );
    loop {
        let (client, peer) = match listener.accept().await {
            Ok(p) => p,
            Err(e) => {
                warn!("transparent accept failed: {e}");
                continue;
            }
        };
        tokio::spawn(async move {
            if let Err(e) = handle(client, peer, hudsucker_addr).await {
                // One line per failure is enough; don't hide it at debug.
                info!("transparent flow from {peer} ended: {e:#}");
            }
        });
    }
}

async fn handle(client: TcpStream, peer: SocketAddr, hudsucker_addr: SocketAddr) -> Result<()> {
    // Step 1: peek the first chunk without consuming — we need the TLS
    // ClientHello intact so hudsucker can parse it after we hand the socket
    // through.
    let sni = peek_sni(&client).await.with_context(|| {
        format!("extracting SNI from TLS ClientHello (client={peer})")
    })?;
    // Promote to info so operators can see what's being redirected without
    // enabling debug on everything.
    info!("transparent flow {peer} → SNI '{sni}'");

    // Step 2: open a connection to our own hudsucker proxy.
    let mut upstream = TcpStream::connect(hudsucker_addr)
        .await
        .with_context(|| format!("connecting to hudsucker at {hudsucker_addr}"))?;

    // Step 3: synthesize a standard HTTP proxy CONNECT. Hudsucker will reply
    // with a `200 Connection established`, then MITM anything that follows.
    let connect = format!(
        "CONNECT {sni}:443 HTTP/1.1\r\nHost: {sni}:443\r\nUser-Agent: reflex-transparent/0.1\r\n\r\n"
    );
    upstream
        .write_all(connect.as_bytes())
        .await
        .context("writing synthetic CONNECT to hudsucker")?;

    // Step 4: read (and discard) hudsucker's CONNECT response headers so the
    // upstream read side is aligned with the start of the client's TLS data.
    // We stop as soon as we see `\r\n\r\n`. Bounded to 4 KiB.
    consume_http_headers(&mut upstream)
        .await
        .context("reading hudsucker CONNECT response")?;

    // Step 5: pipe the client's TLS bytes ↔ hudsucker's stream. Hudsucker
    // will terminate TLS, emit events via the shared handler, and open its
    // own connection to the real origin.
    let (mut cr, mut cw) = client.into_split();
    let (mut ur, mut uw) = upstream.into_split();

    let c2u = async {
        let _ = tokio::io::copy(&mut cr, &mut uw).await;
        let _ = uw.shutdown().await;
    };
    let u2c = async {
        let _ = tokio::io::copy(&mut ur, &mut cw).await;
        let _ = cw.shutdown().await;
    };
    tokio::join!(c2u, u2c);
    Ok(())
}

/// Peek up to 4 KiB (MSG_PEEK) and parse a TLS ClientHello to extract SNI.
/// We don't consume the bytes — the socket is handed to hudsucker with the
/// ClientHello still queued.
async fn peek_sni(stream: &TcpStream) -> Result<String> {
    // Loop because MSG_PEEK may return short reads during a fragmented
    // ClientHello. Cap at a few attempts so we never spin.
    let mut buf = vec![0u8; 4096];
    for _ in 0..6 {
        let n = stream.peek(&mut buf).await?;
        if n == 0 {
            return Err(anyhow!("client closed before ClientHello"));
        }
        match extract_sni(&buf[..n]) {
            Ok(sni) => return Ok(sni),
            Err(SniError::NeedMore) => {
                tokio::task::yield_now().await;
                continue;
            }
            Err(SniError::NotTls) => return Err(anyhow!("not a TLS ClientHello")),
            Err(SniError::NoSni) => return Err(anyhow!("TLS ClientHello had no SNI extension")),
        }
    }
    Err(anyhow!("gave up waiting for full ClientHello"))
}

#[derive(Debug)]
enum SniError {
    NeedMore,
    NotTls,
    NoSni,
}

fn extract_sni(buf: &[u8]) -> Result<String, SniError> {
    let (_, record) = match parse_tls_plaintext(buf) {
        Ok(x) => x,
        Err(e) if e.is_incomplete() => return Err(SniError::NeedMore),
        Err(_) => return Err(SniError::NotTls),
    };
    for msg in record.msg {
        let TlsMessage::Handshake(TlsMessageHandshake::ClientHello(ch)) = msg else {
            continue;
        };
        let Some(ext_bytes) = ch.ext else {
            return Err(SniError::NoSni);
        };
        let (_, exts) = match parse_tls_extensions(ext_bytes) {
            Ok(x) => x,
            Err(e) if e.is_incomplete() => return Err(SniError::NeedMore),
            Err(_) => return Err(SniError::NoSni),
        };
        for e in exts {
            if let TlsExtension::SNI(list) = e {
                for (_, name) in list {
                    if let Ok(s) = std::str::from_utf8(name) {
                        return Ok(s.to_owned());
                    }
                }
            }
        }
        return Err(SniError::NoSni);
    }
    Err(SniError::NotTls)
}

/// Read from `s` until we see `\r\n\r\n` or hit the safety cap.
async fn consume_http_headers(s: &mut TcpStream) -> Result<()> {
    let mut buf = [0u8; 512];
    let mut total: Vec<u8> = Vec::with_capacity(512);
    loop {
        let n = s.read(&mut buf).await?;
        if n == 0 {
            return Err(anyhow!("upstream closed before header end"));
        }
        total.extend_from_slice(&buf[..n]);
        if windowed_match(&total, b"\r\n\r\n") {
            return Ok(());
        }
        if total.len() > 4096 {
            return Err(anyhow!("CONNECT response exceeded 4 KiB without terminator"));
        }
    }
}

fn windowed_match(hay: &[u8], needle: &[u8]) -> bool {
    hay.windows(needle.len()).any(|w| w == needle)
}
