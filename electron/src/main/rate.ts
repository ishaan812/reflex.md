// Rate a single session's Turn[] — produce mistakes, retries, corrections,
// reversals, and an aggregate 0..100 score.
//
// Heuristic-driven, transparent, small. The goal is to produce actionable
// signals an agent can read on startup ("you tried `rg -U` and it failed
// three times; use a different approach"), not to be a clever ML model.

import type {
  Correction,
  Mistake,
  RetryCluster,
  Reversal,
  SessionRating,
  Turn,
  TurnTokens,
} from "@shared/turn";

export function rateSession(turns: Turn[]): SessionRating | null {
  if (turns.length === 0) return null;

  const first = turns[0];
  const session_id = first.session_id;
  const source = first.source;

  // Aggregates
  const user_turns = turns.filter((t) => t.role === "user" && t.kind === "message");
  const assistant_turns = turns.filter(
    (t) => t.role === "assistant" && t.kind === "message",
  );
  const tool_calls = turns.filter((t) => t.kind === "tool_call");
  const tool_errors = tool_calls.filter((t) => t.tool?.errored);

  const mistakes = detectMistakes(turns);
  const retries = detectRetries(turns);
  const corrections = detectCorrections(turns);
  const reversals = detectReversals(turns);

  const tokens_by_model = aggregateTokens(turns);
  const wall_time_ms = wallTime(turns);

  const score = computeScore({
    turnCount: turns.length,
    toolCallCount: tool_calls.length,
    toolErrorCount: tool_errors.length,
    retryCount: retries.length,
    correctionCount: corrections.length,
    reversalCount: reversals.length,
    unresolvedMistakes: mistakes.filter((m) => m.resolved_at === undefined).length,
  });

  return {
    session_id,
    source,
    score,
    evaluated_at: new Date().toISOString(),
    mistakes,
    retries,
    corrections,
    reversals,
    turn_count: turns.length,
    tool_call_count: tool_calls.length,
    tool_error_count: tool_errors.length,
    user_turn_count: user_turns.length,
    assistant_turn_count: assistant_turns.length,
    wall_time_ms,
    tokens_by_model,
  };
}

// ---------- Detectors --------------------------------------------------

function detectMistakes(turns: Turn[]): Mistake[] {
  const out: Mistake[] = [];
  for (let i = 0; i < turns.length; i++) {
    const t = turns[i];
    if (t.kind !== "tool_call" || !t.tool?.errored) continue;
    const name = t.tool.name;
    const args_preview = serializeArgs(t.tool.args);
    const err = t.tool.error ?? "(unknown error)";

    // Look forward for a resolver: the next successful same-tool call
    // whose args look materially different, OR an explicit "fixed" phrase.
    let resolved_at: number | undefined;
    for (let j = i + 1; j < turns.length; j++) {
      const u = turns[j];
      if (
        u.kind === "tool_call" &&
        u.tool?.name === name &&
        !u.tool.errored &&
        serializeArgs(u.tool.args) !== args_preview
      ) {
        resolved_at = j;
        break;
      }
      if (
        u.kind === "message" &&
        u.role === "assistant" &&
        /(\bfixed\b|now works|resolved|got it working)/i.test(u.text)
      ) {
        resolved_at = j;
        break;
      }
    }

    out.push({
      at_turn_index: i,
      tool_name: name,
      args_preview,
      error: err.slice(0, 400),
      resolved_at,
    });
  }
  return out;
}

function detectRetries(turns: Turn[]): RetryCluster[] {
  const clusters: RetryCluster[] = [];
  const seen = new Set<number>();

  for (let i = 0; i < turns.length; i++) {
    if (seen.has(i)) continue;
    const a = turns[i];
    if (a.kind !== "tool_call") continue;
    const name = a.tool?.name;
    if (!name) continue;

    // Look for rapid-fire same-tool calls after a.
    const indices: number[] = [i];
    for (let j = i + 1; j < turns.length && j < i + 10; j++) {
      const b = turns[j];
      // Allow intervening tool_result / reasoning turns
      if (b.kind === "tool_call") {
        if (b.tool?.name === name) {
          indices.push(j);
        } else {
          break; // different tool → new chain
        }
      } else if (
        b.kind === "message" &&
        b.role === "user"
      ) {
        break; // user re-entered
      }
    }
    if (indices.length >= 2) {
      for (const k of indices) seen.add(k);
      const last = turns[indices[indices.length - 1]];
      clusters.push({
        tool_name: name,
        indices,
        resolved: !(last.tool?.errored ?? false),
        delta: describeDelta(
          turns[indices[0]].tool?.args,
          turns[indices[indices.length - 1]].tool?.args,
        ),
      });
    }
  }
  return clusters;
}

const CORRECTION_PATTERNS = [
  /^(no|nope|nah)[,.\s!?]/i,
  /^(wait|hold on|stop)[,.\s!?]/i,
  /that('s| is) (wrong|not right|incorrect)/i,
  /(actually[,.\s]|instead[,.\s]|please )/i,
  /(don'?t|do not) (do|use|run)/i,
  /try (again|different|another)/i,
  /(not what i|that isn'?t what)/i,
  /undo that/i,
  /revert/i,
];

function detectCorrections(turns: Turn[]): Correction[] {
  const out: Correction[] = [];
  for (let i = 0; i < turns.length; i++) {
    const t = turns[i];
    if (t.role !== "user" || t.kind !== "message") continue;
    const text = t.text.trim();
    if (text.length < 3) continue;
    const head = text.slice(0, 400);
    for (const pat of CORRECTION_PATTERNS) {
      if (pat.test(head)) {
        out.push({
          at_turn_index: i,
          phrase: head.slice(0, 200),
        });
        break;
      }
    }
  }
  return out;
}

/**
 * A reversal = assistant writes/edits a file, then later writes/edits the
 * same file to undo / substantially change the earlier work.
 *
 * Heuristic: track file_path args across Write/Edit tool_calls; if the
 * same path appears twice with the second call's args materially shorter
 * or containing "revert" / "undo" in surrounding context, flag it.
 */
function detectReversals(turns: Turn[]): Reversal[] {
  const seenPaths = new Map<string, number[]>();
  for (let i = 0; i < turns.length; i++) {
    const t = turns[i];
    if (t.kind !== "tool_call") continue;
    const nm = t.tool?.name?.toLowerCase() ?? "";
    if (!["write", "edit", "str_replace", "multiedit"].some((x) => nm.includes(x))) {
      continue;
    }
    const path = extractPath(t.tool?.args);
    if (!path) continue;
    const arr = seenPaths.get(path) ?? [];
    arr.push(i);
    seenPaths.set(path, arr);
  }

  const out: Reversal[] = [];
  for (const [path, indices] of seenPaths) {
    if (indices.length < 2) continue;
    const last = indices[indices.length - 1];
    // Naive description
    out.push({
      at_turn_index: last,
      file_path: path,
      description: `${indices.length} edits to ${path}`,
    });
  }
  return out;
}

// ---------- Scoring ----------------------------------------------------

function computeScore(x: {
  turnCount: number;
  toolCallCount: number;
  toolErrorCount: number;
  retryCount: number;
  correctionCount: number;
  reversalCount: number;
  unresolvedMistakes: number;
}): number {
  if (x.turnCount === 0) return 100;

  // Start at 100, subtract penalties.
  let s = 100;
  const errRate = x.toolCallCount ? x.toolErrorCount / x.toolCallCount : 0;
  s -= Math.min(30, errRate * 60);
  s -= Math.min(20, x.retryCount * 3);
  s -= Math.min(20, x.correctionCount * 4);
  s -= Math.min(15, x.reversalCount * 3);
  s -= Math.min(25, x.unresolvedMistakes * 5);
  return Math.max(0, Math.round(s));
}

// ---------- Helpers ----------------------------------------------------

function wallTime(turns: Turn[]): number {
  if (turns.length < 2) return 0;
  const first = new Date(turns[0].ts).getTime();
  const last = new Date(turns[turns.length - 1].ts).getTime();
  if (!isFinite(first) || !isFinite(last)) return 0;
  return Math.max(0, last - first);
}

function aggregateTokens(turns: Turn[]): Record<string, TurnTokens> {
  const by: Record<string, TurnTokens> = {};
  for (const t of turns) {
    if (!t.tokens) continue;
    const key = t.model ?? "unknown";
    const acc = by[key] ?? {};
    if (t.tokens.input) acc.input = (acc.input ?? 0) + t.tokens.input;
    if (t.tokens.output) acc.output = (acc.output ?? 0) + t.tokens.output;
    if (t.tokens.cached) acc.cached = (acc.cached ?? 0) + t.tokens.cached;
    by[key] = acc;
  }
  return by;
}

function serializeArgs(args: unknown): string {
  if (args === undefined || args === null) return "";
  try {
    const s = typeof args === "string" ? args : JSON.stringify(args);
    return s.length > 200 ? s.slice(0, 200) + "…" : s;
  } catch {
    return String(args);
  }
}

function describeDelta(a: unknown, b: unknown): string | undefined {
  if (a === undefined || b === undefined) return undefined;
  const A = serializeArgs(a);
  const B = serializeArgs(b);
  if (A === B) return "args identical";
  // Find common prefix length, then first divergent char.
  let i = 0;
  while (i < A.length && i < B.length && A[i] === B[i]) i++;
  return `diverged at char ${i}`;
}

function extractPath(args: unknown): string | null {
  if (!args || typeof args !== "object") return null;
  const o = args as Record<string, unknown>;
  for (const key of ["file_path", "filepath", "path", "filePath", "file"]) {
    const v = o[key];
    if (typeof v === "string" && v.length) return v;
  }
  return null;
}
