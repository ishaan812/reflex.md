// Canonical cross-source turn model — the unit the memory/rating layer
// operates on. Any source (opencode, claude-code, codex, network flows)
// normalizes into `Turn[]` so downstream code never has to know the
// origin format.

export type TurnRole = "user" | "assistant" | "tool" | "system";
export type TurnKind =
  | "message"
  | "reasoning"
  | "tool_call"
  | "tool_result"
  | "error";

export interface TurnTokens {
  input?: number;
  output?: number;
  cached?: number;
}

export interface TurnTool {
  name: string;
  /** Arguments passed to the tool (parsed when possible). */
  args?: unknown;
  /** Output returned by the tool, if any. */
  output?: string;
  /** Whether the tool call resulted in an error. */
  errored?: boolean;
  /** Error message extracted from tool output / downstream turns. */
  error?: string;
}

export interface Turn {
  // Identity
  session_id: string;
  source: string;          // "opencode" | "claude-code" | "codex" | "network:<host>"
  source_entry_id: string; // stable id inside the source
  source_parent_id?: string | null;

  // Normalized content
  ts: string;                // RFC3339
  role: TurnRole;
  kind: TurnKind;
  text: string;              // primary content (may be empty)
  model?: string | null;
  tool?: TurnTool;           // when kind = tool_call | tool_result
  tokens?: TurnTokens;
  latency_ms?: number;

  // Metadata
  truncated?: boolean;
  byte_len?: number;
  raw_kind?: string;         // original source-native kind (for debugging)
}

// ---------- Rating types -------------------------------------------------

export interface Mistake {
  /** Index into the session's `Turn[]`. */
  at_turn_index: number;
  tool_name: string;
  /** JSON-serialized args (truncated). */
  args_preview: string;
  error: string;
  /** Index of the turn that fixed it, if we can identify one. */
  resolved_at?: number;
}

export interface RetryCluster {
  tool_name: string;
  /** Turn indices of each retry in order. */
  indices: number[];
  /** Whether the final call succeeded. */
  resolved: boolean;
  /** Short summary of what changed between retries. */
  delta?: string;
}

export interface Correction {
  at_turn_index: number;
  /** The user's correction text (trimmed). */
  phrase: string;
  /** Optional inferred target of the correction. */
  target?: string;
}

export interface Reversal {
  at_turn_index: number;
  file_path: string;
  /** Short description of the change-and-revert. */
  description: string;
}

export interface SessionRating {
  session_id: string;
  source: string;
  /** 0..100 where 100 = flawless, 0 = ruinous. */
  score: number;
  evaluated_at: string;

  // Signal breakdowns
  mistakes: Mistake[];
  retries: RetryCluster[];
  corrections: Correction[];
  reversals: Reversal[];

  // Aggregates
  turn_count: number;
  tool_call_count: number;
  tool_error_count: number;
  user_turn_count: number;
  assistant_turn_count: number;
  wall_time_ms: number;
  /** Per-model token accounting when available. */
  tokens_by_model: Record<string, TurnTokens>;
}
