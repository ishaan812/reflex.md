//! Claude Code session source.
//!
//! Claude Code (Anthropic's CLI) persists each session as a JSONL file at
//! `~/.claude/projects/<project-slug>/<session-uuid>.jsonl`. One line
//! per entry; common `.type` values:
//!
//!   - `"user"`      — user message; `.message.content` is either a
//!                     string, or an array containing `tool_result` items
//!   - `"assistant"` — assistant message; `.message.content` is an array
//!                     of `{type: "text" | "thinking" | "tool_use", …}`
//!   - `"system"`    — metadata (turn_duration, etc.)
//!   - `"permission-mode"`, `"last-prompt"`, `"file-history-snapshot"`,
//!     `"message"`, `"skill_listing"`, `"deferred_tools_delta"` — housekeeping
//!
//! This source:
//!   1. Periodically scans the projects directory for JSONL files
//!   2. Tracks a byte offset per file and reads only newly-appended lines
//!   3. Emits one `SessionEntry` per line, expanding `assistant.content`
//!      arrays into per-item entries (text vs tool_use vs thinking)

use anyhow::{Context, Result};
use serde_json::Value;
use std::{
    collections::BTreeMap,
    io::{BufRead, BufReader, Seek, SeekFrom},
    path::{Path, PathBuf},
    time::Duration,
};
use tokio::sync::broadcast;
use tracing::{debug, info, warn};
use uuid::Uuid;

use super::HighWater;
use crate::event::CaptureEvent;

pub const SOURCE_NAME: &str = "claude-code";

#[derive(Debug, Clone)]
pub struct ClaudeCodeConfig {
    /// Root dir containing projects. Default: `~/.claude/projects`.
    pub projects_dir: PathBuf,
    pub poll_ms: u64,
    /// On first run, skip files that haven't been modified in the last N
    /// minutes (0 = read everything, which can be a lot).
    pub backfill_recent_minutes: u32,
}

impl Default for ClaudeCodeConfig {
    fn default() -> Self {
        Self {
            projects_dir: dirs::home_dir()
                .unwrap_or_default()
                .join(".claude")
                .join("projects"),
            poll_ms: 1500,
            backfill_recent_minutes: 0,
        }
    }
}

/// Per-file read position. Persisted via HighWater so we resume cleanly.
#[derive(Default, Clone)]
struct FileOffsets(BTreeMap<String, u64>);

impl FileOffsets {
    fn from_hw(hw: &HighWater) -> Self {
        let key = format!("{}:offsets", SOURCE_NAME);
        hw.cursors
            .get(&key)
            .and_then(|s| serde_json::from_str::<BTreeMap<String, u64>>(s).ok())
            .map(FileOffsets)
            .unwrap_or_default()
    }

    fn store(&self, hw: &mut HighWater) {
        let key = format!("{}:offsets", SOURCE_NAME);
        if let Ok(s) = serde_json::to_string(&self.0) {
            hw.cursors.insert(key, s);
        }
    }
}

pub async fn run(
    cfg: ClaudeCodeConfig,
    state_path: PathBuf,
    tx: broadcast::Sender<CaptureEvent>,
) -> Result<()> {
    info!(
        "claude-code source: scanning {} every {}ms (backfill={}m)",
        cfg.projects_dir.display(),
        cfg.poll_ms,
        cfg.backfill_recent_minutes
    );

    let mut offsets = FileOffsets::from_hw(&HighWater::load(&state_path));
    let mut first_run = offsets.0.is_empty();

    let mut interval = tokio::time::interval(Duration::from_millis(cfg.poll_ms.max(250)));
    interval.set_missed_tick_behavior(tokio::time::MissedTickBehavior::Delay);

    loop {
        interval.tick().await;

        if !cfg.projects_dir.exists() {
            debug!("claude-code projects dir not present yet");
            continue;
        }

        // Enumerate all .jsonl files under projects_dir.
        let files = match list_jsonl(&cfg.projects_dir) {
            Ok(v) => v,
            Err(e) => {
                warn!("claude-code: scan failed: {e}");
                continue;
            }
        };

        for file in &files {
            // On first run we may skip files that haven't been touched recently.
            if first_run && cfg.backfill_recent_minutes > 0 {
                if !recently_modified(file, cfg.backfill_recent_minutes) {
                    // Set offset to current file size so future appends are picked up.
                    if let Ok(meta) = std::fs::metadata(file) {
                        offsets.0.insert(file.to_string_lossy().into_owned(), meta.len());
                    }
                    continue;
                }
            } else if first_run {
                // No backfill: start from EOF for existing files
                if let Ok(meta) = std::fs::metadata(file) {
                    offsets.0.entry(file.to_string_lossy().into_owned())
                        .or_insert(meta.len());
                }
            }

            let key = file.to_string_lossy().into_owned();
            let cur_offset = offsets.0.get(&key).copied().unwrap_or(0);

            let file_clone = file.clone();
            let new_events = tokio::task::spawn_blocking(move || {
                read_new_lines(&file_clone, cur_offset)
            })
            .await
            .map_err(|e| anyhow::anyhow!("join: {e}"))?;

            let (events, new_offset) = match new_events {
                Ok(x) => x,
                Err(e) => {
                    debug!("claude-code: read error for {}: {e}", file.display());
                    continue;
                }
            };

            for ev in events {
                let _ = tx.send(ev);
            }

            if new_offset != cur_offset {
                offsets.0.insert(key, new_offset);
            }
        }

        first_run = false;

        // Persist offsets
        let mut hw = HighWater::load(&state_path);
        offsets.store(&mut hw);
        if let Err(e) = hw.save(&state_path) {
            warn!("claude-code: failed to save offsets: {e}");
        }
    }
}

fn list_jsonl(root: &Path) -> Result<Vec<PathBuf>> {
    let mut out = Vec::new();
    for entry in std::fs::read_dir(root).with_context(|| format!("reading {root:?}"))? {
        let entry = entry?;
        let path = entry.path();
        if path.is_dir() {
            // Recurse one level — Claude Code uses project dirs that contain the .jsonl files.
            if let Ok(rd) = std::fs::read_dir(&path) {
                for inner in rd.flatten() {
                    let p = inner.path();
                    if p.extension().map(|e| e == "jsonl").unwrap_or(false) {
                        out.push(p);
                    }
                }
            }
        } else if path.extension().map(|e| e == "jsonl").unwrap_or(false) {
            out.push(path);
        }
    }
    Ok(out)
}

fn recently_modified(p: &Path, minutes: u32) -> bool {
    let meta = match std::fs::metadata(p) {
        Ok(m) => m,
        Err(_) => return false,
    };
    let modified = match meta.modified() {
        Ok(t) => t,
        Err(_) => return false,
    };
    let cutoff = std::time::SystemTime::now() - Duration::from_secs((minutes as u64) * 60);
    modified > cutoff
}

/// Read all newly-appended lines from `path` starting at byte offset `from`.
/// Returns (events, new offset).
fn read_new_lines(path: &Path, from: u64) -> Result<(Vec<CaptureEvent>, u64)> {
    let mut f = std::fs::File::open(path).with_context(|| format!("open {path:?}"))?;
    let total_len = f.metadata()?.len();
    if total_len < from {
        // File was truncated or rotated; restart from 0.
        debug!(
            "claude-code: {} appears truncated ({} < {}) — restarting from 0",
            path.display(),
            total_len,
            from
        );
        f.seek(SeekFrom::Start(0))?;
    } else {
        f.seek(SeekFrom::Start(from))?;
    }
    let mut reader = BufReader::new(f);
    let mut events = Vec::new();
    let mut read = if total_len < from { 0 } else { from };

    let mut buf = String::new();
    loop {
        buf.clear();
        let n = reader.read_line(&mut buf)?;
        if n == 0 {
            break;
        }
        // A partial line at EOF should be left for the next poll.
        if !buf.ends_with('\n') {
            // Don't advance `read` past the start of this partial line.
            break;
        }
        read += n as u64;

        let line = buf.trim_end();
        if line.is_empty() {
            continue;
        }
        if let Some(mut evs) = parse_line(line, path) {
            events.append(&mut evs);
        }
    }

    Ok((events, read))
}

/// Parse a JSONL line into zero-or-more `SessionEntry`s.
/// Zero when the line type isn't content we care about.
/// More than one when a single assistant message contains multiple content
/// parts (text + tool_use, etc.) and we want each surfaced individually.
fn parse_line(line: &str, _path: &Path) -> Option<Vec<CaptureEvent>> {
    let v: Value = serde_json::from_str(line).ok()?;
    let ty = v.get("type").and_then(|t| t.as_str()).unwrap_or("");

    // Only content-bearing types are interesting for the memory layer.
    if !matches!(ty, "user" | "assistant" | "system") {
        return None;
    }

    let timestamp = v
        .get("timestamp")
        .and_then(|x| x.as_str())
        .unwrap_or_default()
        .to_owned();
    let session_id = v
        .get("sessionId")
        .and_then(|x| x.as_str())
        .unwrap_or("unknown")
        .to_owned();
    let uuid = v
        .get("uuid")
        .and_then(|x| x.as_str())
        .unwrap_or_else(|| "")
        .to_owned();
    let parent_uuid = v
        .get("parentUuid")
        .and_then(|x| x.as_str())
        .map(ToOwned::to_owned);

    let mut out = Vec::new();

    match ty {
        "user" => {
            // `.message.content` may be a string or an array (tool results).
            let content = v.pointer("/message/content");
            if let Some(Value::String(s)) = content {
                out.push(mk_entry(
                    &session_id,
                    &uuid,
                    parent_uuid.as_deref(),
                    &timestamp,
                    "message",
                    Some("user"),
                    None,
                    s.clone(),
                    v.clone(),
                ));
            } else if let Some(Value::Array(items)) = content {
                for (i, item) in items.iter().enumerate() {
                    let kind = item
                        .get("type")
                        .and_then(|t| t.as_str())
                        .unwrap_or("message");
                    let text = match kind {
                        "tool_result" => item
                            .get("content")
                            .map(value_to_text)
                            .unwrap_or_default(),
                        "text" => item
                            .get("text")
                            .and_then(|t| t.as_str())
                            .map(|s| s.to_owned())
                            .unwrap_or_default(),
                        _ => serde_json::to_string(item).unwrap_or_default(),
                    };
                    let entry_id = if items.len() == 1 {
                        uuid.clone()
                    } else {
                        format!("{uuid}#{i}")
                    };
                    out.push(mk_entry(
                        &session_id,
                        &entry_id,
                        parent_uuid.as_deref(),
                        &timestamp,
                        if kind == "tool_result" {
                            "tool_result"
                        } else {
                            "message"
                        },
                        Some("user"),
                        None,
                        text,
                        item.clone(),
                    ));
                }
            }
        }

        "assistant" => {
            let model = v
                .pointer("/message/model")
                .and_then(|x| x.as_str())
                .map(ToOwned::to_owned);
            // `.message.content` is always an array of typed items.
            if let Some(Value::Array(items)) = v.pointer("/message/content") {
                for (i, item) in items.iter().enumerate() {
                    let t = item.get("type").and_then(|t| t.as_str()).unwrap_or("text");
                    let (kind, text) = match t {
                        "text" => (
                            "message".to_owned(),
                            item.get("text")
                                .and_then(|x| x.as_str())
                                .unwrap_or("")
                                .to_owned(),
                        ),
                        "thinking" => (
                            "reasoning".to_owned(),
                            item.get("thinking")
                                .and_then(|x| x.as_str())
                                .unwrap_or("")
                                .to_owned(),
                        ),
                        "tool_use" => {
                            let name = item
                                .get("name")
                                .and_then(|x| x.as_str())
                                .unwrap_or("unknown");
                            let input = item.get("input").cloned().unwrap_or(Value::Null);
                            (
                                format!("tool_call:{name}"),
                                serde_json::to_string(&input).unwrap_or_default(),
                            )
                        }
                        other => (other.to_owned(), String::new()),
                    };
                    let entry_id = if items.len() == 1 {
                        uuid.clone()
                    } else {
                        format!("{uuid}#{i}")
                    };
                    out.push(mk_entry(
                        &session_id,
                        &entry_id,
                        parent_uuid.as_deref(),
                        &timestamp,
                        &kind,
                        Some("assistant"),
                        model.clone(),
                        text,
                        item.clone(),
                    ));
                }
            }
        }

        "system" => {
            // Surface metadata entries for the memory layer (durations etc.).
            let content = serde_json::to_string(&v).unwrap_or_default();
            out.push(mk_entry(
                &session_id,
                &uuid,
                parent_uuid.as_deref(),
                &timestamp,
                "system",
                Some("system"),
                None,
                content,
                v.clone(),
            ));
        }

        _ => unreachable!(),
    }

    Some(out)
}

#[allow(clippy::too_many_arguments)]
fn mk_entry(
    session_id: &str,
    entry_id: &str,
    parent_entry_id: Option<&str>,
    ts: &str,
    kind: &str,
    role: Option<&str>,
    model: Option<String>,
    content: String,
    metadata: Value,
) -> CaptureEvent {
    let byte_len = content.len();
    let content = if byte_len > 64 * 1024 {
        let mut s = content;
        s.truncate(64 * 1024);
        s.push_str(&format!("… (+{} bytes)", byte_len - 64 * 1024));
        s
    } else {
        content
    };
    CaptureEvent::SessionEntry {
        id: Uuid::new_v4().to_string(),
        source: SOURCE_NAME.to_owned(),
        session_id: session_id.to_owned(),
        entry_id: entry_id.to_owned(),
        parent_entry_id: parent_entry_id.map(ToOwned::to_owned),
        ts: ts.to_owned(),
        kind: kind.to_owned(),
        role: role.map(ToOwned::to_owned),
        model,
        content,
        byte_len,
        metadata,
    }
}

/// Reduce a JSON value to a best-effort text representation (for
/// tool_result contents that are sometimes strings, sometimes objects).
fn value_to_text(v: &Value) -> String {
    match v {
        Value::String(s) => s.clone(),
        Value::Array(arr) => arr
            .iter()
            .map(value_to_text)
            .collect::<Vec<_>>()
            .join("\n"),
        Value::Object(obj) => {
            // If it looks like an Anthropic tool_result inner, prefer .text / .content
            if let Some(text) = obj.get("text").and_then(|x| x.as_str()) {
                return text.to_owned();
            }
            if let Some(inner) = obj.get("content") {
                return value_to_text(inner);
            }
            serde_json::to_string(v).unwrap_or_default()
        }
        _ => serde_json::to_string(v).unwrap_or_default(),
    }
}
