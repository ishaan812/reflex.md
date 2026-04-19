import type { NormalizedEvent } from "../types.js";
import { normalizeClaudeCodeEvent } from "./claudeCode.js";

/**
 * Normalize a raw event stream from entire-cli's `full.jsonl` into Reflex's
 * 7-kind normalized event model. Agent string is the `agent` field from the
 * per-session `metadata.json` (e.g. "Claude Code", "Codex", "Gemini CLI").
 *
 * Currently implemented: Claude Code. Any other agent gets a passthrough
 * adapter that emits `{ kind: "raw", raw }` for each line — the drawer still
 * renders these, and friction falls back to prompt.txt-driven signals.
 */
export function normalizeEvents(
  agent: string | null | undefined,
  events: unknown[],
): NormalizedEvent[] {
  const isClaudeCode = (agent ?? "").trim().toLowerCase() === "claude code";
  const out: NormalizedEvent[] = [];
  for (const e of events) {
    if (isClaudeCode) {
      for (const norm of normalizeClaudeCodeEvent(e)) out.push(norm);
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
