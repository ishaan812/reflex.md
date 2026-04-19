// Wire event schema. MUST stay in sync with rust/src/event.rs.

export type Headers = Record<string, string>;

export type CaptureEvent =
  | {
      type: "sidecar_ready";
      proxy_port: number;
      ws_port: number;
      /** 0 when transparent mode is disabled. */
      transparent_port: number;
      ca_cert_path: string;
      ca_fingerprint_sha256: string;
    }
  | {
      type: "flow_start";
      id: string;
      ts: string;
      method: string;
      scheme: string;
      host: string;
      port: number;
      path: string;
      url: string;
      http_version: string;
    }
  | {
      type: "request_head";
      id: string;
      headers: Headers;
    }
  | {
      type: "request_body";
      id: string;
      body_b64: string;
      truncated: boolean;
      byte_len: number;
    }
  | {
      type: "response_head";
      id: string;
      status: number;
      http_version: string;
      headers: Headers;
    }
  | {
      type: "response_body";
      id: string;
      body_b64: string;
      truncated: boolean;
      byte_len: number;
    }
  | {
      type: "flow_end";
      id: string;
      duration_ms: number;
      error: string | null;
    }
  | {
      type: "session_entry";
      id: string;
      source: string;
      session_id: string;
      entry_id: string;
      parent_entry_id: string | null;
      ts: string;
      kind: string;
      role: string | null;
      model: string | null;
      content: string;
      byte_len: number;
      metadata: Record<string, unknown>;
    };

// Domain types surfaced to the renderer.
export interface FlowSummary {
  id: string;
  ts: string;
  method: string;
  host: string;
  path: string;
  url: string;
  status: number | null;
  duration_ms: number | null;
  request_bytes: number;
  response_bytes: number;
  error: string | null;
}

export interface FlowDetail extends FlowSummary {
  scheme: string;
  port: number;
  http_version: string;
  request_headers: Headers;
  response_headers: Headers;
  /** base64 */
  request_body: string | null;
  /** base64 */
  response_body: string | null;
  request_truncated: boolean;
  response_truncated: boolean;
}

// --- Session (file-tail sources) domain types --------------------------

export interface SessionSummary {
  session_id: string;
  source: string;
  /** Most recent entry timestamp (used for the list ordering). */
  last_ts: string;
  /** First entry timestamp (session start). */
  first_ts: string;
  /** Total number of entries captured for this session. */
  entry_count: number;
  /** Model stamped on the most recent assistant entry, if any. */
  model: string | null;
  /** Best-guess project or working directory from metadata, if any. */
  project: string | null;
  /** First user prompt snippet, for quick scanning. */
  first_user_text: string | null;
}

export interface SessionEntry {
  id: string;
  source: string;
  session_id: string;
  entry_id: string;
  parent_entry_id: string | null;
  ts: string;
  kind: string;
  role: string | null;
  model: string | null;
  content: string;
  byte_len: number;
  metadata: Record<string, unknown>;
}

export interface SessionDetail extends SessionSummary {
  entries: SessionEntry[];
}

// Bridge surface exposed to the renderer via preload/contextBridge.
export interface ReflexBridge {
  listFlows(limit?: number): Promise<FlowSummary[]>;
  getFlow(id: string): Promise<FlowDetail | null>;
  listSessions(limit?: number): Promise<SessionSummary[]>;
  getSession(sessionId: string): Promise<SessionDetail | null>;
  /** Subscribe to live flow summaries; returns an unsubscribe fn. */
  onFlow(cb: (flow: FlowSummary) => void): () => void;
  /** Subscribe to live session summaries (emitted when a session gets a new entry). */
  onSession(cb: (session: SessionSummary) => void): () => void;
  /** Capture subsystem status for the status bar. */
  getStatus(): Promise<CaptureStatus>;
}

export interface CaptureStatus {
  sidecarRunning: boolean;
  proxyPort: number | null;
  wsPort: number | null;
  transparentPort: number | null;
  caCertPath: string | null;
  caFingerprintSha256: string | null;
  lastError: string | null;
}
