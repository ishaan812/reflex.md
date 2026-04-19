//! Codex CLI session source.
//!
//! Codex writes one JSONL file per session under
//! `~/.codex/sessions/YYYY/MM/DD/rollout-<iso>-<uuid>.jsonl`. The first
//! line is a `session_meta` record with session id + system prompt; the
//! rest are `response_item` (conversation content), `event_msg`
//! (task_started / task_completed / …) and `turn_context` (per-turn
//! config). We mirror the Claude Code source's tail+offset pattern.

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

pub const SOURCE_NAME: &str = "codex";

#[derive(Debug, Clone)]
pub struct CodexConfig {
    /// Root containing the YYYY/MM/DD hierarchy. Default: `~/.codex/sessions`.
    pub sessions_dir: PathBuf,
    pub poll_ms: u64,
    pub backfill_recent_minutes: u32,
}

impl Default for CodexConfig {
    fn default() -> Self {
        Self {
            sessions_dir: dirs::home_dir()
                .unwrap_or_default()
                .join(".codex")
                .join("sessions"),
            poll_ms: 1500,
            backfill_recent_minutes: 0,
        }
    }
}

pub async fn run(
    cfg: CodexConfig,
    state_path: PathBuf,
    tx: broadcast::Sender<CaptureEvent>,
) -> Result<()> {
    info!(
        "codex source: scanning {} every {}ms (backfill={}m)",
        cfg.sessions_dir.display(),
        cfg.poll_ms,
        cfg.backfill_recent_minutes
    );

    let hw = HighWater::load(&state_path);
    let key = format!("{}:offsets", SOURCE_NAME);
    let mut offsets: BTreeMap<String, u64> = hw
        .cursors
        .get(&key)
        .and_then(|s| serde_json::from_str(s).ok())
        .unwrap_or_default();
    let mut first_run = offsets.is_empty();

    // For session_meta parsing we want session id + model per file.
    let mut per_file_meta: BTreeMap<String, FileMeta> = BTreeMap::new();

    let mut interval = tokio::time::interval(Duration::from_millis(cfg.poll_ms.max(250)));
    interval.set_missed_tick_behavior(tokio::time::MissedTickBehavior::Delay);

    loop {
        interval.tick().await;

        if !cfg.sessions_dir.exists() {
            debug!("codex sessions dir not present yet");
            continue;
        }

        let files = match walk_jsonl(&cfg.sessions_dir, 4) {
            Ok(v) => v,
            Err(e) => {
                warn!("codex: scan failed: {e}");
                continue;
            }
        };

        for file in &files {
            if first_run {
                if cfg.backfill_recent_minutes > 0
                    && !recently_modified(file, cfg.backfill_recent_minutes)
                {
                    if let Ok(meta) = std::fs::metadata(file) {
                        offsets.insert(file.to_string_lossy().into_owned(), meta.len());
                    }
                    continue;
                }
                if cfg.backfill_recent_minutes == 0 {
                    if let Ok(meta) = std::fs::metadata(file) {
                        offsets
                            .entry(file.to_string_lossy().into_owned())
                            .or_insert(meta.len());
                    }
                    continue;
                }
            }

            let key = file.to_string_lossy().into_owned();
            let cur = offsets.get(&key).copied().unwrap_or(0);

            let file_clone = file.clone();
            let meta = per_file_meta.entry(key.clone()).or_default().clone();

            let new = tokio::task::spawn_blocking(move || {
                read_new(&file_clone, cur, &meta)
            })
            .await
            .map_err(|e| anyhow::anyhow!("join: {e}"))?;

            let (events, new_offset, updated_meta) = match new {
                Ok(x) => x,
                Err(e) => {
                    debug!("codex: read error on {}: {e}", file.display());
                    continue;
                }
            };

            if let Some(m) = updated_meta {
                per_file_meta.insert(key.clone(), m);
            }

            for ev in events {
                let _ = tx.send(ev);
            }

            if new_offset != cur {
                offsets.insert(key, new_offset);
            }
        }

        first_run = false;

        let mut hw = HighWater::load(&state_path);
        if let Ok(s) = serde_json::to_string(&offsets) {
            hw.cursors.insert(format!("{}:offsets", SOURCE_NAME), s);
        }
        if let Err(e) = hw.save(&state_path) {
            warn!("codex: failed to save offsets: {e}");
        }
    }
}

#[derive(Debug, Default, Clone)]
struct FileMeta {
    session_id: Option<String>,
    model: Option<String>,
}

fn walk_jsonl(root: &Path, max_depth: usize) -> Result<Vec<PathBuf>> {
    let mut out = Vec::new();
    walk_into(root, max_depth, &mut out)
        .with_context(|| format!("walking {root:?}"))?;
    Ok(out)
}

fn walk_into(dir: &Path, depth: usize, out: &mut Vec<PathBuf>) -> Result<()> {
    if depth == 0 {
        return Ok(());
    }
    for entry in std::fs::read_dir(dir)? {
        let entry = entry?;
        let path = entry.path();
        let ft = entry.file_type()?;
        if ft.is_dir() {
            let _ = walk_into(&path, depth - 1, out);
        } else if path.extension().map(|e| e == "jsonl").unwrap_or(false) {
            out.push(path);
        }
    }
    Ok(())
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

fn read_new(
    path: &Path,
    from: u64,
    existing_meta: &FileMeta,
) -> Result<(Vec<CaptureEvent>, u64, Option<FileMeta>)> {
    let mut f = std::fs::File::open(path)?;
    let total_len = f.metadata()?.len();
    if total_len < from {
        // Truncation/rotation: restart from 0.
        f.seek(SeekFrom::Start(0))?;
    } else {
        f.seek(SeekFrom::Start(from))?;
    }
    let mut reader = BufReader::new(f);
    let mut events = Vec::new();
    let mut read = if total_len < from { 0 } else { from };
    let mut meta = existing_meta.clone();
    let mut meta_changed = false;
    let mut buf = String::new();

    loop {
        buf.clear();
        let n = reader.read_line(&mut buf)?;
        if n == 0 {
            break;
        }
        if !buf.ends_with('\n') {
            break;
        }
        read += n as u64;
        let line = buf.trim_end();
        if line.is_empty() {
            continue;
        }

        let v: Value = match serde_json::from_str(line) {
            Ok(v) => v,
            Err(_) => continue,
        };

        let ty = v.get("type").and_then(|t| t.as_str()).unwrap_or("");
        let ts = v
            .get("timestamp")
            .and_then(|x| x.as_str())
            .unwrap_or_default()
            .to_owned();

        match ty {
            "session_meta" => {
                if let Some(payload) = v.get("payload") {
                    if let Some(id) = payload.get("id").and_then(|x| x.as_str()) {
                        meta.session_id = Some(id.to_owned());
                        meta_changed = true;
                    }
                    if let Some(model) = payload.get("model").and_then(|x| x.as_str()) {
                        meta.model = Some(model.to_owned());
                        meta_changed = true;
                    }
                }
            }

            "turn_context" => {
                if let Some(payload) = v.get("payload") {
                    if let Some(m) = payload.get("model").and_then(|x| x.as_str()) {
                        meta.model = Some(m.to_owned());
                        meta_changed = true;
                    }
                }
            }

            "response_item" => {
                let Some(payload) = v.get("payload") else {
                    continue;
                };
                let inner_type = payload.get("type").and_then(|x| x.as_str()).unwrap_or("");
                let role = payload
                    .get("role")
                    .and_then(|x| x.as_str())
                    .map(ToOwned::to_owned);
                let session_id = meta.session_id.clone().unwrap_or_default();

                match inner_type {
                    "message" => {
                        if let Some(Value::Array(items)) = payload.get("content") {
                            for (i, item) in items.iter().enumerate() {
                                let item_type =
                                    item.get("type").and_then(|x| x.as_str()).unwrap_or("");
                                let text = match item_type {
                                    "input_text" | "output_text" | "text" => item
                                        .get("text")
                                        .and_then(|x| x.as_str())
                                        .unwrap_or("")
                                        .to_owned(),
                                    _ => serde_json::to_string(item).unwrap_or_default(),
                                };
                                let entry_id = format!("line-{read}#{i}");
                                events.push(mk_entry(
                                    &session_id,
                                    &entry_id,
                                    None,
                                    &ts,
                                    "message",
                                    role.as_deref(),
                                    meta.model.clone(),
                                    text,
                                    item.clone(),
                                ));
                            }
                        }
                    }
                    "reasoning" => {
                        let text = payload
                            .get("content")
                            .map(value_to_text)
                            .unwrap_or_default();
                        events.push(mk_entry(
                            &session_id,
                            &format!("line-{read}"),
                            None,
                            &ts,
                            "reasoning",
                            role.as_deref(),
                            meta.model.clone(),
                            text,
                            payload.clone(),
                        ));
                    }
                    "function_call" | "tool_call" => {
                        let name = payload
                            .get("name")
                            .and_then(|x| x.as_str())
                            .unwrap_or("unknown");
                        let args = payload
                            .get("arguments")
                            .map(|x| match x {
                                Value::String(s) => s.clone(),
                                v => serde_json::to_string(v).unwrap_or_default(),
                            })
                            .unwrap_or_default();
                        events.push(mk_entry(
                            &session_id,
                            &format!("line-{read}"),
                            None,
                            &ts,
                            &format!("tool_call:{name}"),
                            Some("assistant"),
                            meta.model.clone(),
                            args,
                            payload.clone(),
                        ));
                    }
                    "function_call_output" | "tool_result" => {
                        let text = payload
                            .get("output")
                            .map(value_to_text)
                            .unwrap_or_default();
                        events.push(mk_entry(
                            &session_id,
                            &format!("line-{read}"),
                            None,
                            &ts,
                            "tool_result",
                            Some("tool"),
                            meta.model.clone(),
                            text,
                            payload.clone(),
                        ));
                    }
                    _ => {
                        // Ignore unknown inner types (file-search etc.).
                    }
                }
            }

            "event_msg" => {
                // Surface task started / completed / errored as kind=system.
                if let Some(payload) = v.get("payload") {
                    let subtype = payload
                        .get("type")
                        .and_then(|x| x.as_str())
                        .unwrap_or("event");
                    let session_id = meta.session_id.clone().unwrap_or_default();
                    events.push(mk_entry(
                        &session_id,
                        &format!("line-{read}"),
                        None,
                        &ts,
                        &format!("event:{subtype}"),
                        Some("system"),
                        None,
                        String::new(),
                        payload.clone(),
                    ));
                }
            }

            _ => {}
        }
    }

    Ok((events, read, if meta_changed { Some(meta) } else { None }))
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

fn value_to_text(v: &Value) -> String {
    match v {
        Value::String(s) => s.clone(),
        Value::Array(arr) => arr
            .iter()
            .map(value_to_text)
            .collect::<Vec<_>>()
            .join("\n"),
        Value::Object(obj) => {
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
