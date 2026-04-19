//! Non-network capture sources.
//!
//! The network interceptor sees every HTTP request and response, but it
//! misses anything where the client cert-pins (ChatGPT.app, Claude.app,
//! some Apple services) or rolls its own HTTP stack in a way that ignores
//! our proxy (Bun-compiled `opencode`). For those we reach for a parallel
//! capture path: the AI tools themselves persist their sessions to disk,
//! usually either as a SQLite database (opencode, Codex) or JSONL files
//! (Claude Code). By reading those stores directly we get the **same**
//! conversational content as the API traffic, already decrypted.
//!
//! Each source runs in its own tokio task, maintains a high-water mark of
//! the last entry it emitted, polls (or file-watches) for new entries, and
//! pushes them into the shared event broadcast channel as
//! `CaptureEvent::SessionEntry`.

pub mod claude_code;
pub mod codex;
pub mod opencode;

use crate::event::CaptureEvent;
use serde::{Deserialize, Serialize};
use std::path::PathBuf;
use tokio::sync::broadcast;

pub use claude_code::ClaudeCodeConfig;
pub use codex::CodexConfig;

/// Configuration for the set of enabled sources.
#[derive(Debug, Clone, Default)]
pub struct SourceSet {
    pub opencode: Option<OpencodeConfig>,
    pub claude_code: Option<ClaudeCodeConfig>,
    pub codex: Option<CodexConfig>,
}

#[derive(Debug, Clone)]
pub struct OpencodeConfig {
    /// Path to `opencode.db`. Defaults to `$HOME/.local/share/opencode/opencode.db`.
    pub db_path: PathBuf,
    /// Poll interval in milliseconds.
    pub poll_ms: u64,
    /// On first run (no saved cursor), how many minutes of recent history
    /// to backfill. 0 means "don't backfill, start fresh at current time".
    pub backfill_recent_minutes: u32,
}

impl Default for OpencodeConfig {
    fn default() -> Self {
        let db = dirs::home_dir()
            .unwrap_or_default()
            .join(".local")
            .join("share")
            .join("opencode")
            .join("opencode.db");
        Self {
            db_path: db,
            poll_ms: 1500,
            backfill_recent_minutes: 0,
        }
    }
}

/// Persistent per-source high-water mark, written atomically to disk so
/// restart doesn't re-emit already-captured entries.
#[derive(Debug, Clone, Default, Serialize, Deserialize)]
pub struct HighWater {
    /// Map from source name → last-seen monotonic cursor (string to allow
    /// sources that key off uuids or epoch-ms both).
    pub cursors: std::collections::BTreeMap<String, String>,
}

impl HighWater {
    pub fn load(path: &std::path::Path) -> Self {
        std::fs::read_to_string(path)
            .ok()
            .and_then(|s| serde_json::from_str(&s).ok())
            .unwrap_or_default()
    }

    pub fn save(&self, path: &std::path::Path) -> anyhow::Result<()> {
        let tmp = path.with_extension("tmp");
        let data = serde_json::to_string_pretty(self)?;
        std::fs::write(&tmp, data)?;
        std::fs::rename(&tmp, path)?;
        Ok(())
    }
}

/// Spawn every enabled source. `state_path` is the on-disk location for
/// the high-water file; pick something inside the sidecar's data dir.
pub fn spawn_all(
    set: SourceSet,
    state_path: PathBuf,
    tx: broadcast::Sender<CaptureEvent>,
) -> Vec<tokio::task::JoinHandle<()>> {
    let mut handles = Vec::new();
    let hw = HighWater::load(&state_path);

    if let Some(cfg) = set.opencode {
        let tx = tx.clone();
        let sp = state_path.clone();
        let saved_cursor = hw
            .cursors
            .get(opencode::SOURCE_NAME)
            .cloned()
            .and_then(|s| s.parse::<i64>().ok());
        handles.push(tokio::spawn(async move {
            if let Err(e) = opencode::run(cfg, saved_cursor, sp, tx).await {
                tracing::error!("opencode source task exited: {e:#}");
            }
        }));
    }

    if let Some(cfg) = set.claude_code {
        let tx = tx.clone();
        let sp = state_path.clone();
        handles.push(tokio::spawn(async move {
            if let Err(e) = claude_code::run(cfg, sp, tx).await {
                tracing::error!("claude-code source task exited: {e:#}");
            }
        }));
    }

    if let Some(cfg) = set.codex {
        let tx = tx.clone();
        let sp = state_path.clone();
        handles.push(tokio::spawn(async move {
            if let Err(e) = codex::run(cfg, sp, tx).await {
                tracing::error!("codex source task exited: {e:#}");
            }
        }));
    }

    handles
}
