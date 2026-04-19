//! Local WebSocket server — Electron shell is the only expected client.
//!
//! We accept connections on 127.0.0.1:<port> and forward every event from
//! the broadcast channel to every connected client as a newline-free JSON
//! text frame. Backpressure: if a client lags, we drop it (broadcast Lagged).
//!
//! To avoid racing the subscriber-after-send problem with tokio
//! `broadcast`, we keep an in-memory ring buffer of the most recent events
//! and replay it to every newly-connecting WS client before attaching
//! them to the live broadcast.

use anyhow::{Context, Result};
use futures_util::SinkExt;
use std::{collections::VecDeque, net::SocketAddr, sync::Arc};
use tokio::{
    net::TcpListener,
    sync::{broadcast, Mutex},
};
use tokio_tungstenite::tungstenite::Message;
use tracing::{debug, info, warn};

use crate::event::CaptureEvent;

/// How many recent events to retain for replay to newly-connecting clients.
/// Sized to cover a few minutes of live capture plus a session-source burst.
const REPLAY_BUFFER: usize = 4096;

#[derive(Clone, Default)]
pub struct Replay {
    inner: Arc<Mutex<VecDeque<CaptureEvent>>>,
}

impl Replay {
    pub fn new() -> Self {
        Self::default()
    }

    pub async fn push(&self, ev: CaptureEvent) {
        let mut g = self.inner.lock().await;
        if g.len() == REPLAY_BUFFER {
            g.pop_front();
        }
        g.push_back(ev);
    }

    pub async fn snapshot(&self) -> Vec<CaptureEvent> {
        let g = self.inner.lock().await;
        g.iter().cloned().collect()
    }
}

/// Bind to `127.0.0.1:port` (port=0 → OS-assigned) and return the actual port.
pub async fn bind(port: u16) -> Result<(TcpListener, u16)> {
    let addr: SocketAddr = ([127, 0, 0, 1], port).into();
    let listener = TcpListener::bind(addr)
        .await
        .with_context(|| format!("binding WS server on {addr}"))?;
    let port = listener.local_addr()?.port();
    Ok((listener, port))
}

/// Run the WS accept loop. Returns only when the listener errors or is dropped.
pub async fn serve(
    listener: TcpListener,
    events: broadcast::Sender<CaptureEvent>,
    replay: Replay,
) -> Result<()> {
    info!(
        "WS server listening on {}",
        listener.local_addr().expect("listener addr")
    );
    loop {
        let (stream, peer) = match listener.accept().await {
            Ok(p) => p,
            Err(e) => {
                warn!("WS accept failed: {e}");
                continue;
            }
        };
        let rx = events.subscribe();
        let replay = replay.clone();
        tokio::spawn(async move {
            if let Err(e) = handle_client(stream, peer, rx, replay).await {
                debug!("WS client {peer} ended: {e}");
            }
        });
    }
}

async fn handle_client(
    stream: tokio::net::TcpStream,
    peer: SocketAddr,
    mut rx: broadcast::Receiver<CaptureEvent>,
    replay: Replay,
) -> Result<()> {
    let ws = tokio_tungstenite::accept_async(stream)
        .await
        .context("ws handshake")?;
    info!("WS client connected: {peer}");
    let (mut sink, _stream) = ws.split_sink_and_stream();

    // 1. Flush the replay buffer first so this client catches up on recent history.
    let snap = replay.snapshot().await;
    debug!("WS client {peer}: replaying {} buffered events", snap.len());
    for ev in snap {
        let json = serde_json::to_string(&ev).expect("event serializes");
        if sink.send(Message::Text(json.into())).await.is_err() {
            return Ok(());
        }
    }

    // 2. Attach to the live feed.
    loop {
        match rx.recv().await {
            Ok(ev) => {
                let json = serde_json::to_string(&ev).expect("event serializes");
                if sink.send(Message::Text(json.into())).await.is_err() {
                    break;
                }
            }
            Err(broadcast::error::RecvError::Lagged(n)) => {
                warn!("WS client {peer} lagged, dropping {n} events");
                continue;
            }
            Err(broadcast::error::RecvError::Closed) => break,
        }
    }

    info!("WS client disconnected: {peer}");
    Ok(())
}

// Small convenience: futures_util's split for WebSocketStream.
trait SplitExt {
    type Sink;
    type Stream;
    fn split_sink_and_stream(self) -> (Self::Sink, Self::Stream);
}

impl<S> SplitExt for tokio_tungstenite::WebSocketStream<S>
where
    S: tokio::io::AsyncRead + tokio::io::AsyncWrite + Unpin,
{
    type Sink = futures_util::stream::SplitSink<Self, Message>;
    type Stream = futures_util::stream::SplitStream<Self>;

    fn split_sink_and_stream(self) -> (Self::Sink, Self::Stream) {
        use futures_util::StreamExt;
        self.split()
    }
}
