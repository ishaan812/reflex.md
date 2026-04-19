//! Reflex capture sidecar.
//!
//! Spawned by the Electron shell. Responsibilities:
//!   1. Ensure a local CA exists (or generate one)
//!   2. Start an HTTP/S MITM proxy (hudsucker)
//!   3. Expose a WebSocket on 127.0.0.1 where the Electron shell subscribes
//!      to live capture events
//!   4. Print a single `sidecar_ready` JSON line on stdout so the shell knows
//!      the ports/fingerprint/CA path without racing on the WS dial

mod ca;
mod event;
mod mitm;
mod sources;
mod transparent;
mod ws;

use anyhow::{Context, Result};
use clap::Parser;
use hudsucker::{certificate_authority::RcgenAuthority, rustls::crypto::aws_lc_rs, Proxy};
use std::{collections::HashSet, net::SocketAddr, path::PathBuf};
use tokio::sync::broadcast;
use tracing::{error, info};
use tracing_subscriber::{prelude::*, EnvFilter};

use crate::event::CaptureEvent;

/// Reflex capture sidecar — MITM proxy + WebSocket event stream.
#[derive(Parser, Debug)]
#[command(version, about)]
struct Args {
    /// TCP port for the MITM proxy. Use 0 for OS-assigned.
    #[arg(long, env = "REFLEX_PROXY_PORT", default_value_t = 8888)]
    proxy_port: u16,

    /// TCP port for the local WebSocket event stream.
    #[arg(long, env = "REFLEX_WS_PORT", default_value_t = 0)]
    ws_port: u16,

    /// TCP port for the transparent TLS listener (pf rules redirect :443 here).
    /// Use 0 to disable transparent mode.
    #[arg(long, env = "REFLEX_TRANSPARENT_PORT", default_value_t = 8889)]
    transparent_port: u16,

    /// Directory for CA material + runtime state.
    #[arg(long, env = "REFLEX_DATA_DIR")]
    data_dir: Option<PathBuf>,

    /// Host allowlist. Empty = capture everything (dev only).
    /// Accepts repeated flag or comma-separated env value.
    #[arg(
        long = "allow-host",
        env = "REFLEX_ALLOW_HOSTS",
        value_delimiter = ',',
        num_args = 0..,
    )]
    allow_hosts: Vec<String>,

    /// Comma-separated list of session sources to enable.
    /// Valid values: "opencode" (more to come: "claude-code", "codex").
    #[arg(
        long = "sources",
        env = "REFLEX_SOURCES",
        value_delimiter = ',',
        num_args = 0..,
    )]
    sources: Vec<String>,

    /// Override the home dir used to resolve source paths — primarily for
    /// running the sidecar under a dedicated user (e.g. `_reflex`) while
    /// still reading session data from the real user's home.
    #[arg(long, env = "REFLEX_SOURCES_HOME")]
    sources_home: Option<PathBuf>,

    /// On first run (no saved cursor) backfill this many minutes of
    /// recent history. Default 0 = start from "now", only emit new entries.
    #[arg(long, env = "REFLEX_BACKFILL_MINUTES", default_value_t = 0)]
    backfill_recent_minutes: u32,
}

fn default_data_dir() -> PathBuf {
    // ~/Library/Application Support/Reflex/capture
    let base = dirs::data_dir().unwrap_or_else(|| PathBuf::from("."));
    base.join("Reflex").join("capture")
}

#[tokio::main]
async fn main() -> Result<()> {
    init_tracing();
    let args = Args::parse();

    // rustls 0.23 needs a default crypto provider to be installed once.
    let _ = aws_lc_rs::default_provider().install_default();

    let data_dir = args.data_dir.unwrap_or_else(default_data_dir);
    let loaded = ca::ensure_ca(&data_dir).context("ensuring CA")?;

    // Broadcast channel: producers = hudsucker handler clones + source tasks.
    // Consumers = WS clients, plus a drain task that feeds a replay buffer
    // so late-joining clients still see recent events.
    let (tx, _rx0) = broadcast::channel::<CaptureEvent>(1024);
    let replay = ws::Replay::new();
    {
        let replay = replay.clone();
        let mut rx = tx.subscribe();
        tokio::spawn(async move {
            loop {
                match rx.recv().await {
                    Ok(ev) => replay.push(ev).await,
                    Err(tokio::sync::broadcast::error::RecvError::Lagged(_)) => continue,
                    Err(tokio::sync::broadcast::error::RecvError::Closed) => break,
                }
            }
        });
    }

    // WS server first so we know the bound port for the ready event.
    let (ws_listener, ws_port) = ws::bind(args.ws_port)
        .await
        .context("binding WS server")?;

    // Build the proxy. Pre-bind so we know the real port even if caller passed 0.
    let proxy_addr: SocketAddr = ([127, 0, 0, 1], args.proxy_port).into();
    let proxy_listener = tokio::net::TcpListener::bind(proxy_addr)
        .await
        .with_context(|| format!("binding proxy on {proxy_addr}"))?;
    let bound_proxy_port = proxy_listener.local_addr()?.port();

    let allowlist: HashSet<String> = args.allow_hosts.into_iter().collect();
    info!(
        "starting proxy on 127.0.0.1:{bound_proxy_port}; {} host(s) allowed",
        if allowlist.is_empty() {
            "all".into()
        } else {
            allowlist.len().to_string()
        }
    );

    let handler = mitm::RecordingHandler::new(tx.clone(), allowlist);
    let ca_auth = RcgenAuthority::new(loaded.issuer, 1_000, aws_lc_rs::default_provider());

    let proxy = Proxy::builder()
        .with_listener(proxy_listener)
        .with_ca(ca_auth)
        .with_rustls_connector(aws_lc_rs::default_provider())
        .with_http_handler(handler)
        .with_graceful_shutdown(shutdown_signal())
        .build()
        .context("building proxy")?;

    // Optionally bring up the transparent TLS listener.
    let transparent_bound = if args.transparent_port == 0 {
        None
    } else {
        let (listener, port) = transparent::bind(args.transparent_port)
            .await
            .context("binding transparent listener")?;
        Some((listener, port))
    };
    let transparent_port_reported = transparent_bound.as_ref().map(|(_, p)| *p).unwrap_or(0);

    // Announce readiness — Electron's bootstrap reads this from stdout.
    let ready = CaptureEvent::SidecarReady {
        proxy_port: bound_proxy_port,
        ws_port,
        transparent_port: transparent_port_reported,
        ca_cert_path: loaded.cert_path.to_string_lossy().into_owned(),
        ca_fingerprint_sha256: loaded.fingerprint_sha256.clone(),
    };
    println!("{}", serde_json::to_string(&ready)?);
    // Also push it into the broadcast channel so late-connecting WS clients see it.
    let _ = tx.send(ready);

    // Spin up non-network sources (file watchers / SQLite tails) in parallel.
    let mut _source_handles = spawn_sources(
        &args.sources,
        args.sources_home.as_deref(),
        args.backfill_recent_minutes,
        &data_dir,
        tx.clone(),
    );

    // Run proxy + WS + (optional) transparent server concurrently.
    let ws_task = tokio::spawn(ws::serve(ws_listener, tx.clone(), replay.clone()));
    let proxy_task = tokio::spawn(async move {
        if let Err(e) = proxy.start().await {
            error!("proxy error: {e}");
        }
    });
    let transparent_task = transparent_bound.map(|(listener, _port)| {
        let hudsucker_addr: SocketAddr = ([127, 0, 0, 1], bound_proxy_port).into();
        tokio::spawn(async move {
            if let Err(e) = transparent::serve(listener, hudsucker_addr).await {
                error!("transparent listener error: {e}");
            }
        })
    });

    tokio::select! {
        _ = proxy_task => {},
        _ = ws_task => {},
        _ = wait_opt(transparent_task) => {},
    }
    Ok(())
}

fn spawn_sources(
    enabled: &[String],
    sources_home_override: Option<&std::path::Path>,
    backfill_recent_minutes: u32,
    data_dir: &std::path::Path,
    tx: tokio::sync::broadcast::Sender<CaptureEvent>,
) -> Vec<tokio::task::JoinHandle<()>> {
    use sources::{ClaudeCodeConfig, CodexConfig, OpencodeConfig, SourceSet};

    let want = |name: &str| {
        enabled.iter().any(|s| {
            let s = s.to_ascii_lowercase();
            s == name || s.replace('_', "-") == name
        })
    };
    let mut set = SourceSet::default();

    let home = sources_home_override
        .map(|p| p.to_path_buf())
        .or_else(dirs::home_dir);

    if want("opencode") {
        let mut cfg = OpencodeConfig::default();
        if let Some(h) = &home {
            cfg.db_path = h.join(".local/share/opencode/opencode.db");
        }
        cfg.backfill_recent_minutes = backfill_recent_minutes;
        info!(
            "enabling opencode source at {} (backfill={}m)",
            cfg.db_path.display(),
            backfill_recent_minutes
        );
        set.opencode = Some(cfg);
    }

    if want("claude-code") {
        let mut cfg = ClaudeCodeConfig::default();
        if let Some(h) = &home {
            cfg.projects_dir = h.join(".claude/projects");
        }
        cfg.backfill_recent_minutes = backfill_recent_minutes;
        info!(
            "enabling claude-code source at {} (backfill={}m)",
            cfg.projects_dir.display(),
            backfill_recent_minutes
        );
        set.claude_code = Some(cfg);
    }

    if want("codex") {
        let mut cfg = CodexConfig::default();
        if let Some(h) = &home {
            cfg.sessions_dir = h.join(".codex/sessions");
        }
        cfg.backfill_recent_minutes = backfill_recent_minutes;
        info!(
            "enabling codex source at {} (backfill={}m)",
            cfg.sessions_dir.display(),
            backfill_recent_minutes
        );
        set.codex = Some(cfg);
    }

    // No sources enabled? Return early.
    if set.opencode.is_none() && set.claude_code.is_none() && set.codex.is_none() {
        return Vec::new();
    }

    let state_path = data_dir.join("sources-highwater.json");
    sources::spawn_all(set, state_path, tx)
}

/// Awaits a JoinHandle if present, otherwise never resolves.
async fn wait_opt<T>(h: Option<tokio::task::JoinHandle<T>>) {
    match h {
        Some(h) => {
            let _ = h.await;
        }
        None => std::future::pending::<()>().await,
    }
}

async fn shutdown_signal() {
    let _ = tokio::signal::ctrl_c().await;
    info!("shutdown signal received");
}

fn init_tracing() {
    let filter = EnvFilter::try_from_env("REFLEX_LOG")
        .unwrap_or_else(|_| EnvFilter::new("info,hudsucker=warn,hyper=warn,rustls=warn"));
    tracing_subscriber::registry()
        .with(filter)
        .with(tracing_subscriber::fmt::layer().with_writer(std::io::stderr))
        .init();
}
