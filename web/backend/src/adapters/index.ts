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
 *
 * Matching is intentionally lenient: we collapse whitespace, underscores,
 * hyphens and version suffixes so "Claude Code", "claude-code", "Claude_Code",
 * "Claude Code 1.2.3", "ClaudeCode", "claude code cli" all normalize to
 * "claudecode". Same treatment for OpenCode variants.
 */
export function normalizeEvents(
  agent: string | null | undefined,
  events: unknown[],
): NormalizedEvent[] {
  const canonical = canonicalAgent(agent);
  const out: NormalizedEvent[] = [];
  for (const e of events) {
    if (canonical === "claudecode") {
      for (const norm of normalizeClaudeCodeEvent(e)) out.push(norm);
    } else if (canonical === "opencode") {
      for (const norm of normalizeOpenCodeMessage(e)) out.push(norm);
    } else {
      out.push(rawPassthrough(e));
    }
  }
  return out;
}

/**
 * Normalize an agent name to its canonical key for adapter dispatch.
 * Exported for testing.
 */
export function canonicalAgent(agent: string | null | undefined): string {
  const raw = (agent ?? "").toLowerCase();
  // Strip anything that is not an ASCII letter or digit (including spaces,
  // hyphens, underscores, version suffixes, trailing "cli" noise).
  const compact = raw.replace(/[^a-z0-9]/g, "");
  if (compact.startsWith("claudecode")) return "claudecode";
  if (compact.startsWith("opencode")) return "opencode";
  return compact;
}

function rawPassthrough(e: unknown): NormalizedEvent {
  const ts =
    (e as any)?.timestamp ?? (e as any)?.ts ?? (e as any)?.time ?? undefined;
  return { kind: "raw", ts, raw: e };
}
