//! opencode session source.
//!
//! opencode stores everything in a SQLite database at
//! `~/.local/share/opencode/opencode.db`. The relevant tables are:
//!
//!   `session(id TEXT PRIMARY KEY, slug TEXT, ...)`
//!   `message(id TEXT PRIMARY KEY, session_id TEXT, time_created INTEGER,
//!            data TEXT /* JSON: role, modelID, providerID, cost, tokens, … */)`
//!   `part(id TEXT PRIMARY KEY, message_id TEXT, session_id TEXT,
//!         time_created INTEGER,
//!         data TEXT /* JSON: type ("text"|"tool"|…), text|tool|state, … */)`
//!
//! A single assistant turn is one `message` row plus one or more `part`
//! rows linked by `message_id`. We poll both tables for entries newer
//! than our high-water mark, synthesize a `CaptureEvent::SessionEntry`
//! per (message, part), and emit them in `time_created` order so the
//! shell sees them chronologically.

use anyhow::{Context, Result};
use rusqlite::{Connection, OpenFlags};
use std::{path::PathBuf, time::Duration};
use tokio::sync::broadcast;
use tracing::{debug, info, warn};
use uuid::Uuid;

use super::{HighWater, OpencodeConfig};
use crate::event::CaptureEvent;

pub const SOURCE_NAME: &str = "opencode";

pub async fn run(
    cfg: OpencodeConfig,
    saved_cursor: Option<i64>,
    state_path: PathBuf,
    tx: broadcast::Sender<CaptureEvent>,
) -> Result<()> {
    // Derive the starting cursor:
    //   - if we have a persisted high-water from a previous run, resume there
    //   - otherwise, compute a sensible first-run cursor so we don't firehose
    //     the entire chat history on startup
    let mut cursor = match saved_cursor {
        Some(c) => {
            info!(
                "opencode source: resuming from saved cursor {} ({})",
                c,
                ms_to_rfc3339(c)
            );
            c
        }
        None => {
            let cur = first_run_cursor(&cfg).unwrap_or(0);
            info!(
                "opencode source: first run, starting at cursor {} ({}) \
                 — backfill_recent_minutes={}",
                cur,
                ms_to_rfc3339(cur),
                cfg.backfill_recent_minutes,
            );
            cur
        }
    };

    info!(
        "opencode source: polling {} every {}ms",
        cfg.db_path.display(),
        cfg.poll_ms,
    );

    let mut interval = tokio::time::interval(Duration::from_millis(cfg.poll_ms.max(250)));
    interval.set_missed_tick_behavior(tokio::time::MissedTickBehavior::Delay);

    loop {
        interval.tick().await;

        if !cfg.db_path.exists() {
            debug!("opencode db not found yet at {}", cfg.db_path.display());
            continue;
        }

        // Do the (blocking) SQLite work on a worker thread so we don't stall
        // the rest of the sidecar.
        let db_path = cfg.db_path.clone();
        let current = cursor;
        let query_result = tokio::task::spawn_blocking(move || {
            poll_once(&db_path, current)
        })
        .await
        .map_err(|e| anyhow::anyhow!("join error: {e}"))?;

        let (events, new_cursor) = match query_result {
            Ok(x) => x,
            Err(e) => {
                warn!("opencode poll error: {e:#}");
                continue;
            }
        };

        for ev in events {
            let _ = tx.send(ev);
        }

        if new_cursor > cursor {
            cursor = new_cursor;
            let mut hw = HighWater::load(&state_path);
            hw.cursors
                .insert(SOURCE_NAME.to_owned(), cursor.to_string());
            if let Err(e) = hw.save(&state_path) {
                warn!("failed to persist high-water mark: {e:#}");
            }
        }
    }
}

/// Blocking query. Returns the new events plus the new high-water cursor.
fn poll_once(db_path: &PathBuf, cursor: i64) -> Result<(Vec<CaptureEvent>, i64)> {
    // Open with flags that tolerate a live writer (opencode itself).
    // WAL mode is already on so multiple readers + one writer is fine.
    let conn = Connection::open_with_flags(
        db_path,
        OpenFlags::SQLITE_OPEN_READ_ONLY | OpenFlags::SQLITE_OPEN_NO_MUTEX,
    )
    .with_context(|| format!("opening {}", db_path.display()))?;

    // Be gentle in case the DB is in the middle of a checkpoint.
    conn.busy_timeout(Duration::from_millis(500))?;

    let mut events = Vec::new();
    let mut next_cursor = cursor;

    // --- messages ------------------------------------------------------
    //
    // Emit a header entry per message so the UI can group parts underneath.
    {
        let mut stmt = conn.prepare(
            "SELECT m.id,
                    m.session_id,
                    m.time_created,
                    m.data,
                    s.slug
             FROM message m
             LEFT JOIN session s ON s.id = m.session_id
             WHERE m.time_created > ?1
             ORDER BY m.time_created ASC
             LIMIT 500",
        )?;
        let rows = stmt.query_map([cursor], |row| {
            Ok(MessageRow {
                id: row.get::<_, String>(0)?,
                session_id: row.get::<_, String>(1)?,
                time_created: row.get::<_, i64>(2)?,
                data: row.get::<_, String>(3)?,
                slug: row.get::<_, Option<String>>(4)?,
            })
        })?;
        for row in rows {
            let row = row?;
            next_cursor = next_cursor.max(row.time_created);
            match message_row_to_event(&row) {
                Ok(ev) => events.push(ev),
                Err(e) => debug!("skip malformed message {}: {e}", row.id),
            }
        }
    }

    // --- parts ---------------------------------------------------------
    //
    // Parts can arrive after their parent message (streaming), so we also
    // emit new parts whose time_created > cursor. Each part is its own
    // SessionEntry (kind = message/tool_call/tool_result) so the shell
    // doesn't have to understand message+part shape.
    {
        let mut stmt = conn.prepare(
            "SELECT id, message_id, session_id, time_created, data
             FROM part
             WHERE time_created > ?1
             ORDER BY time_created ASC
             LIMIT 2000",
        )?;
        let rows = stmt.query_map([cursor], |row| {
            Ok(PartRow {
                id: row.get::<_, String>(0)?,
                message_id: row.get::<_, String>(1)?,
                session_id: row.get::<_, String>(2)?,
                time_created: row.get::<_, i64>(3)?,
                data: row.get::<_, String>(4)?,
            })
        })?;
        for row in rows {
            let row = row?;
            next_cursor = next_cursor.max(row.time_created);
            match part_row_to_event(&row) {
                Ok(ev) => events.push(ev),
                Err(e) => debug!("skip malformed part {}: {e}", row.id),
            }
        }
    }

    // Ensure strictly-increasing cursor semantics even on an empty tick.
    Ok((events, next_cursor.max(cursor)))
}

struct MessageRow {
    id: String,
    session_id: String,
    time_created: i64,
    data: String,
    slug: Option<String>,
}

struct PartRow {
    id: String,
    message_id: String,
    session_id: String,
    time_created: i64,
    data: String,
}

fn message_row_to_event(row: &MessageRow) -> Result<CaptureEvent> {
    let data: serde_json::Value = serde_json::from_str(&row.data)
        .with_context(|| format!("parsing message.data for {}", row.id))?;

    let role = data
        .get("role")
        .and_then(|v| v.as_str())
        .map(|s| s.to_owned());
    let model = data
        .get("modelID")
        .and_then(|v| v.as_str())
        .map(|s| s.to_owned());

    // Messages themselves don't carry user-visible text in opencode — parts
    // do. We still emit the message to give the UI a "turn started"
    // anchor, with `content` empty.
    let content = String::new();
    let ts = ms_to_rfc3339(row.time_created);

    let mut metadata = data.clone();
    if let Some(obj) = metadata.as_object_mut() {
        if let Some(slug) = &row.slug {
            obj.insert("_session_slug".into(), serde_json::Value::String(slug.clone()));
        }
    }

    Ok(CaptureEvent::SessionEntry {
        id: Uuid::new_v4().to_string(),
        source: SOURCE_NAME.to_owned(),
        session_id: row.session_id.clone(),
        entry_id: row.id.clone(),
        parent_entry_id: data
            .get("parentID")
            .and_then(|v| v.as_str())
            .map(|s| s.to_owned()),
        ts,
        kind: "message".to_owned(),
        role,
        model,
        content,
        byte_len: 0,
        metadata,
    })
}

fn part_row_to_event(row: &PartRow) -> Result<CaptureEvent> {
    let data: serde_json::Value = serde_json::from_str(&row.data)
        .with_context(|| format!("parsing part.data for {}", row.id))?;

    let part_type = data
        .get("type")
        .and_then(|v| v.as_str())
        .unwrap_or("unknown");

    // Figure out the kind + extract a best-effort human-readable content blob.
    let (kind, content) = match part_type {
        "text" => (
            "message".to_owned(),
            data.get("text")
                .and_then(|v| v.as_str())
                .map(|s| s.to_owned())
                .unwrap_or_default(),
        ),
        "tool" => {
            // Tool calls: `input` is the tool arguments; if state.status is
            // "completed" there will be a state.output too — we surface both
            // via metadata and the input as the visible content.
            let input_json = data
                .get("state")
                .and_then(|s| s.get("input"))
                .cloned()
                .unwrap_or_else(|| data.get("input").cloned().unwrap_or(serde_json::Value::Null));
            let content = match &input_json {
                serde_json::Value::String(s) => s.clone(),
                v => serde_json::to_string(v).unwrap_or_default(),
            };
            (format!("tool_call:{}", data.get("tool").and_then(|v| v.as_str()).unwrap_or("unknown")), content)
        }
        "reasoning" => (
            "reasoning".to_owned(),
            data.get("text")
                .and_then(|v| v.as_str())
                .map(|s| s.to_owned())
                .unwrap_or_default(),
        ),
        other => (other.to_owned(), String::new()),
    };

    let byte_len = content.len();
    let content = clip(content, 64 * 1024); // cap individual part at 64 KiB

    Ok(CaptureEvent::SessionEntry {
        id: Uuid::new_v4().to_string(),
        source: SOURCE_NAME.to_owned(),
        session_id: row.session_id.clone(),
        entry_id: row.id.clone(),
        parent_entry_id: Some(row.message_id.clone()),
        ts: ms_to_rfc3339(row.time_created),
        kind,
        role: None,  // parts don't carry role; the parent message does
        model: None,
        content,
        byte_len,
        metadata: data,
    })
}

/// First-run cursor policy. If the DB exists, use
/// `max(message.time_created) - backfill_recent_minutes*60*1000`. If the DB
/// doesn't exist yet, fall back to `now - backfill_recent_minutes*60*1000`.
fn first_run_cursor(cfg: &OpencodeConfig) -> Result<i64> {
    let backfill_ms = (cfg.backfill_recent_minutes as i64) * 60 * 1000;
    let now_ms = chrono::Utc::now().timestamp_millis();

    let max_in_db = (|| -> Result<Option<i64>> {
        if !cfg.db_path.exists() {
            return Ok(None);
        }
        let conn = Connection::open_with_flags(
            &cfg.db_path,
            OpenFlags::SQLITE_OPEN_READ_ONLY | OpenFlags::SQLITE_OPEN_NO_MUTEX,
        )?;
        conn.busy_timeout(Duration::from_millis(500))?;
        let v: Option<i64> = conn
            .query_row(
                "SELECT MAX(time_created) FROM message",
                [],
                |r| r.get::<_, Option<i64>>(0),
            )
            .unwrap_or(None);
        Ok(v)
    })()
    .unwrap_or(None);

    let base = max_in_db.unwrap_or(now_ms);
    Ok((base - backfill_ms).max(0))
}

fn ms_to_rfc3339(ms: i64) -> String {
    use chrono::{DateTime, Utc};
    DateTime::<Utc>::from_timestamp_millis(ms)
        .unwrap_or_else(Utc::now)
        .to_rfc3339()
}

fn clip(s: String, n: usize) -> String {
    if s.len() > n {
        let mut t = s;
        t.truncate(n);
        t.push_str(&format!("… (+{} bytes)", t.len()));
        t
    } else {
        s
    }
}
