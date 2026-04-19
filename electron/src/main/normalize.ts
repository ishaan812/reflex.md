// Normalize heterogeneous session_entries rows → canonical Turn[].
//
// Each source has its own quirks. The rules here encode only *structural*
// knowledge of each source; downstream code (rating, UI threading) never
// has to reference source-specific shapes.

import type { SessionEntry } from "@shared/types";
import type { Turn, TurnKind, TurnRole, TurnTool, TurnTokens } from "@shared/turn";

/**
 * Convert a bag of captured entries for a single session into a canonical
 * list of Turn objects, in chronological order.
 *
 * Callers usually pass one session's entries at a time so adjacency signals
 * (tool_call → tool_result linking, retry clusters) behave correctly.
 */
export function normalizeEntries(entries: SessionEntry[]): Turn[] {
  // Sort by ts then insertion id to stabilize.
  const ordered = [...entries].sort((a, b) => {
    const cmp = a.ts.localeCompare(b.ts);
    return cmp !== 0 ? cmp : a.id.localeCompare(b.id);
  });

  const turns: Turn[] = [];
  // For opencode: track the most recent message row so subsequent parts can
  // inherit its role/model (opencode splits them across tables).
  let lastOpencodeMsgHeader: {
    role: TurnRole;
    model?: string | null;
    entry_id: string;
  } | null = null;

  for (const e of ordered) {
    if (e.source === "opencode") {
      // The message rows from opencode carry role/model but empty content.
      // We don't emit them; their role/model is inherited by subsequent
      // parts that reference them via parent_entry_id.
      if (e.kind === "message" && !e.content && e.role) {
        lastOpencodeMsgHeader = {
          role: e.role as TurnRole,
          model: e.model,
          entry_id: e.entry_id,
        };
        continue;
      }

      // Skip pure step markers — they're progress noise.
      if (e.kind === "step-start" || e.kind === "step-finish") continue;

      const inherited = lastOpencodeMsgHeader;

      if (e.kind === "message") {
        turns.push(mkMessage(e, inherited?.role ?? "assistant", inherited?.model));
      } else if (e.kind === "reasoning") {
        turns.push(mkReasoning(e, inherited?.model));
      } else if (e.kind.startsWith("tool_call:")) {
        turns.push(mkToolCall(e, inherited?.model));
      } else if (e.kind === "patch") {
        // Patches are artifacts of tool calls; surface as tool_result.
        turns.push(mkToolResult(e, "patch"));
      }
      continue;
    }

    if (e.source === "claude-code") {
      if (e.kind === "system") continue; // housekeeping

      if (e.kind === "message") {
        turns.push(mkMessage(e, (e.role ?? "assistant") as TurnRole, e.model));
      } else if (e.kind === "reasoning") {
        turns.push(mkReasoning(e, e.model));
      } else if (e.kind.startsWith("tool_call:")) {
        turns.push(mkToolCall(e, e.model));
      } else if (e.kind === "tool_result") {
        turns.push(mkToolResult(e, null));
      }
      continue;
    }

    if (e.source === "codex") {
      if (e.kind.startsWith("event:")) continue; // task_started / task_completed noise

      if (e.kind === "message") {
        turns.push(mkMessage(e, (e.role ?? "assistant") as TurnRole, e.model));
      } else if (e.kind === "reasoning") {
        turns.push(mkReasoning(e, e.model));
      } else if (e.kind.startsWith("tool_call:")) {
        turns.push(mkToolCall(e, e.model));
      } else if (e.kind === "tool_result") {
        turns.push(mkToolResult(e, null));
      }
      continue;
    }

    // Unknown source — pass through as a best-guess message turn.
    turns.push(mkMessage(e, (e.role ?? "system") as TurnRole, e.model));
  }

  // Second pass: link tool_result turns to their originating tool_call so
  // the rating engine can see errors. Heuristic: nearest preceding
  // tool_call of matching name in the same session.
  linkToolResults(turns);

  return turns;
}

// ---------- Builders ---------------------------------------------------

function mkMessage(
  e: SessionEntry,
  role: TurnRole,
  model: string | null | undefined,
): Turn {
  return base(e, "message", role, model);
}

function mkReasoning(e: SessionEntry, model: string | null | undefined): Turn {
  return base(e, "reasoning", "assistant", model);
}

function mkToolCall(e: SessionEntry, model: string | null | undefined): Turn {
  const toolName = e.kind.slice("tool_call:".length);
  let args: unknown = undefined;
  try {
    args = e.content ? JSON.parse(e.content) : undefined;
  } catch {
    args = e.content; // pass string as-is
  }
  const t = base(e, "tool_call", "assistant", model);
  t.tool = { name: toolName, args };
  return t;
}

function mkToolResult(e: SessionEntry, fallbackTool: string | null): Turn {
  const t = base(e, "tool_result", "tool", null);
  const name =
    (e.metadata as Record<string, unknown> | undefined)?.["tool"] &&
    typeof (e.metadata as Record<string, unknown>)["tool"] === "string"
      ? ((e.metadata as Record<string, unknown>)["tool"] as string)
      : fallbackTool ?? "unknown";
  const errored = detectError(e.content);
  t.tool = {
    name,
    output: e.content,
    errored,
    error: errored ? extractErrorLine(e.content) : undefined,
  };
  return t;
}

function base(
  e: SessionEntry,
  kind: TurnKind,
  role: TurnRole,
  model: string | null | undefined,
): Turn {
  return {
    session_id: e.session_id,
    source: e.source,
    source_entry_id: e.entry_id,
    source_parent_id: e.parent_entry_id ?? null,
    ts: e.ts,
    role,
    kind,
    text: e.content,
    model: model ?? null,
    byte_len: e.byte_len,
    raw_kind: e.kind,
  };
}

// ---------- Tool linking -----------------------------------------------

function linkToolResults(turns: Turn[]): void {
  for (let i = 0; i < turns.length; i++) {
    const t = turns[i];
    if (t.kind !== "tool_result") continue;
    const name = t.tool?.name;
    if (!name || name === "unknown") continue;

    // Walk back to find the most recent matching tool_call without a result.
    for (let j = i - 1; j >= 0; j--) {
      const c = turns[j];
      if (
        c.kind === "tool_call" &&
        c.tool?.name === name &&
        !(c.tool as TurnTool & { _linked?: boolean })._linked
      ) {
        const tool = c.tool!;
        (tool as TurnTool & { _linked?: boolean })._linked = true;
        c.tool = {
          ...tool,
          output: t.tool?.output ?? tool.output,
          errored: t.tool?.errored ?? tool.errored,
          error: t.tool?.error ?? tool.error,
        };
        break;
      }
    }
  }
}

// ---------- Error heuristics ------------------------------------------

/**
 * Cheap detector for "this tool output looks like an error". Intentionally
 * high-recall; the rating layer trims down.
 */
function detectError(output: string): boolean {
  if (!output) return false;
  const head = output.slice(0, 2048).toLowerCase();
  if (/(^|\W)(error|exception|traceback|stack ?trace|fatal):/i.test(head))
    return true;
  if (/panic!/i.test(head)) return true;
  if (/command ?not ?found/i.test(head)) return true;
  if (/permission denied/i.test(head)) return true;
  if (/no such file or directory/i.test(head)) return true;
  if (/\berror\s*:/i.test(head) && /(line|at )\b/i.test(head)) return true;
  if (/exit(ed)? (code|status)\s*[:=]?\s*[1-9]/i.test(head)) return true;
  if (/failed (with|to)/i.test(head) && head.includes("error")) return true;
  return false;
}

function extractErrorLine(output: string): string {
  const head = output.slice(0, 4096);
  // Prefer the first line containing "error" / "failed" / "exception".
  for (const ln of head.split(/\r?\n/)) {
    if (/(error|failed|exception|traceback|panic)/i.test(ln) && ln.trim().length) {
      return ln.trim().slice(0, 300);
    }
  }
  return head.split(/\r?\n/)[0]?.slice(0, 300) ?? "";
}

/** Public helper — useful in tests / debug. */
export function isErrorText(s: string): boolean {
  return detectError(s);
}

/** Helper: rough token estimate when a source didn't record tokens. */
export function estimateTokens(text: string): TurnTokens {
  return { input: Math.ceil(text.length / 4) };
}
