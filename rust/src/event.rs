//! Wire event schema shared with the Electron shell.
//!
//! Every event is a JSON object tagged by `type`. The Electron side's
//! `electron/src/shared/types.ts` must stay in sync with this module.

use serde::{Deserialize, Serialize};
use std::collections::BTreeMap;

pub type Headers = BTreeMap<String, String>;

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(tag = "type", rename_all = "snake_case")]
pub enum CaptureEvent {
    /// Emitted once on startup so the shell knows where to find the CA.
    SidecarReady {
        proxy_port: u16,
        ws_port: u16,
        /// 0 if transparent mode is disabled.
        transparent_port: u16,
        ca_cert_path: String,
        ca_fingerprint_sha256: String,
    },

    /// A new flow has begun. A flow id ties requests and responses together.
    FlowStart {
        id: String,
        ts: String,
        method: String,
        scheme: String,
        host: String,
        port: u16,
        path: String,
        url: String,
        http_version: String,
    },

    /// Request headers (sent immediately after FlowStart).
    RequestHead { id: String, headers: Headers },

    /// Request body bytes (base64). May be chunked in the future; MVP sends one chunk.
    RequestBody {
        id: String,
        body_b64: String,
        truncated: bool,
        byte_len: usize,
    },

    /// Response status line + headers.
    ResponseHead {
        id: String,
        status: u16,
        http_version: String,
        headers: Headers,
    },

    /// Response body bytes (base64, decoded if compressed).
    ResponseBody {
        id: String,
        body_b64: String,
        truncated: bool,
        byte_len: usize,
    },

    /// Flow finished (success or error).
    FlowEnd {
        id: String,
        duration_ms: u64,
        error: Option<String>,
    },

    /// A new turn / message surfaced by a non-network source (file watcher,
    /// on-disk SQLite tail, etc.). These exist because many AI CLIs
    /// cert-pin their traffic so we can't MITM them — but they write their
    /// conversations to local session stores which we can read directly.
    SessionEntry {
        /// Unique id for this specific event emission (uuid v4).
        id: String,
        /// Which source produced it: "opencode" | "claude-code" | "codex" | ...
        source: String,
        /// Source-native session identifier (ties turns together).
        session_id: String,
        /// Source-native message id inside the session (for de-dup on restart).
        entry_id: String,
        /// Optional parent message id (for threading).
        parent_entry_id: Option<String>,
        /// RFC3339 timestamp.
        ts: String,
        /// "message" | "tool_call" | "tool_result" | "error" | other source-specific tag.
        kind: String,
        /// "user" | "assistant" | "tool" | "system" — when meaningful.
        role: Option<String>,
        /// Model identifier if known (e.g. "claude-opus-4-7").
        model: Option<String>,
        /// Primary textual content (prompt, response, tool input, tool output, …).
        content: String,
        /// Byte count of `content` before any truncation (for UI sizing).
        byte_len: usize,
        /// Raw source-specific payload passed through verbatim.
        metadata: serde_json::Value,
    },
}
