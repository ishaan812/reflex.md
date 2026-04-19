import type { NormalizedEvent } from "../types.js";
import { normalizeClaudeCodeEvent } from "./claudeCode.js";
import { normalizeOpenCodeMessage } from "./openCode.js";

/**
 * Normalize a raw event stream from entire-cli's `full.jsonl` into Reflex's
 * 7-kind normalized event model. Agent string is the `agent` field from the
 * per-session `metadata.json` (e.g. "Claude Code", "OpenCode", "Codex").
 *
 * Implemented adapters:
 *   - Claude Code  — JSONL transcript (one JSON object per line)
 *   - OpenCode     — single JSON with { info, messages[] }, each message has parts[]
 *
 * Any unrecognised agent gets a passthrough adapter that emits `{ kind: "raw", raw }`
 * for each entry — the drawer still renders these, and friction falls back to
 * prompt.txt-driven signals.
 */
export function normalizeEvents(
  agent: string | null | undefined,
  events: unknown[],
): NormalizedEvent[] {
  const agentLower = (agent ?? "").trim().toLowerCase();
  const out: NormalizedEvent[] = [];
  for (const e of events) {
    if (agentLower === "claude code") {
      for (const norm of normalizeClaudeCodeEvent(e)) out.push(norm);
    } else if (agentLower === "opencode") {
      for (const norm of normalizeOpenCodeMessage(e)) out.push(norm);
    } else {
      out.push(rawPassthrough(e));
    }
  }
  return out;
}

function rawPassthrough(e: unknown): NormalizedEvent {
  const ts =
    (e as any)?.timestamp ?? (e as any)?.ts ?? (e as any)?.time ?? undefined;
  return { kind: "raw", ts, raw: e };
}
