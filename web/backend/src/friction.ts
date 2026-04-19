import type {
  CorrectionCluster,
  CorrectionSignal,
  NormalizedEvent,
} from "./types.js";
import { normalizeEvents } from "./adapters/index.js";

const NEGATION_RE =
  /\b(no|don'?t|stop|wait|revert|that'?s wrong|not (?:that|like)|instead|actually|undo|rollback|please don'?t|that is wrong)\b/i;

const STOPWORDS = new Set([
  "the", "a", "an", "to", "of", "in", "is", "it", "that", "this", "and", "or",
  "no", "not", "dont", "don't", "for", "on", "be", "do", "with", "at", "i",
  "you", "we", "me", "my", "your", "our", "please", "can", "will", "should",
  "would", "could", "use", "using", "just", "so", "but", "then", "from",
]);

/**
 * Derive friction signals for a session.
 *
 * Primary signal: user messages (via the per-agent adapter, or split paragraphs
 * from `prompt.txt` if no adapter is available) that contain a negation.
 *
 * Secondary signal: tool_result with a non-zero exit_code followed within 60s
 * by another tool_call of the same tool (classic retry pattern).
 */
export function detectCorrections(
  agent: string | null | undefined,
  events: unknown[],
  prompt: string | null | undefined,
): CorrectionSignal[] {
  const normalized = normalizeEvents(agent, events);
  const out: CorrectionSignal[] = [];

  // Explicit corrections in user text
  const userTexts = collectUserTexts(normalized, prompt);
  for (const u of userTexts) {
    if (NEGATION_RE.test(u.text)) {
      out.push({
        kind: "explicit",
        intensity: 1,
        text: u.text.slice(0, 500),
        ts: u.ts,
      });
    }
  }

  // Tool retries: failed tool_result → same-tool tool_call within 60s
  for (let i = 0; i < normalized.length; i++) {
    const e = normalized[i];
    if (e.kind !== "tool_result" || !e.exitCode) continue;
    const baseTs = tsMs(e.ts);
    if (baseTs == null) continue;
    // Find the preceding tool_call of this tool (by toolUseId or by nearest earlier tool_call)
    const sourceCall = findPrecedingToolCall(normalized, i, e.toolUseId);
    if (!sourceCall) continue;
    for (let j = i + 1; j < normalized.length; j++) {
      const n = normalized[j];
      if (n.kind !== "tool_call" && n.kind !== "file_write") continue;
      const dt = tsMs(n.ts);
      if (dt == null) continue;
      // Non-monotonic timestamps are valid (Claude Code bundles tool_uses into
      // one assistant turn with identical ts; OpenCode can report out-of-order
      // completion times). Skip out-of-window entries without terminating the
      // scan.
      const delta = dt - baseTs;
      if (delta < 0) continue;
      if (delta > 60_000) break;
      if (n.toolName && sourceCall.toolName && n.toolName === sourceCall.toolName) {
        out.push({
          kind: "tool_retry",
          intensity: 2,
          text: `${n.toolName} retry after non-zero exit`,
          ts: e.ts,
        });
        break;
      }
    }
  }

  return out;
}

export function scoreSession(
  agent: string | null | undefined,
  events: unknown[],
  prompt: string | null | undefined,
): number {
  const normalized = normalizeEvents(agent, events);
  const userPromptCount = Math.max(
    normalized.filter((e) => e.kind === "user").length ||
      promptParagraphCount(prompt),
    1,
  );
  const signals = detectCorrections(agent, events, prompt);
  const total = signals.reduce((a, c) => a + c.intensity, 0);
  return total / userPromptCount;
}

export function clusterCorrections(
  all: CorrectionSignal[],
): CorrectionCluster[] {
  const byKey = new Map<string, CorrectionCluster>();
  for (const c of all) {
    const tokens = c.text
      .toLowerCase()
      .replace(/[^a-z0-9\s]/g, " ")
      .split(/\s+/)
      .filter((t) => t && !STOPWORDS.has(t) && t.length > 1);
    const key = tokens.slice(0, 5).sort().join(" ") || "(empty)";
    const entry =
      byKey.get(key) ??
      ({ key, count: 0, samples: [], totalIntensity: 0 } as CorrectionCluster);
    entry.count++;
    entry.totalIntensity += c.intensity;
    if (entry.samples.length < 3) entry.samples.push(c.text);
    byKey.set(key, entry);
  }
  return [...byKey.values()]
    .sort((a, b) => b.totalIntensity - a.totalIntensity || b.count - a.count)
    .slice(0, 5);
}

export function frictionColor(score: number): "green" | "amber" | "red" {
  if (score < 0.3) return "green";
  if (score < 0.8) return "amber";
  return "red";
}

/** Expose a normalized-event view to the API layer. */
export function normalizeForApi(
  agent: string | null | undefined,
  events: unknown[],
): NormalizedEvent[] {
  return normalizeEvents(agent, events);
}

// ---------- helpers ----------

function collectUserTexts(
  events: NormalizedEvent[],
  prompt: string | null | undefined,
): Array<{ text: string; ts?: string }> {
  const fromEvents = events
    .filter((e) => e.kind === "user" && typeof e.text === "string" && e.text.trim())
    .map((e) => ({ text: e.text!.trim(), ts: e.ts }));
  if (fromEvents.length) return fromEvents;
  // Fallback to prompt.txt (paragraph-split).
  if (prompt && prompt.trim()) {
    return prompt
      .split(/\n{2,}/)
      .map((p) => p.trim())
      .filter(Boolean)
      .map((text) => ({ text }));
  }
  return [];
}

function promptParagraphCount(prompt: string | null | undefined): number {
  if (!prompt || !prompt.trim()) return 0;
  return prompt.split(/\n{2,}/).filter((p) => p.trim()).length;
}

function tsMs(ts: string | undefined): number | null {
  if (!ts) return null;
  const t = new Date(ts).getTime();
  return Number.isFinite(t) ? t : null;
}

function findPrecedingToolCall(
  events: NormalizedEvent[],
  idx: number,
  toolUseId: string | undefined,
): NormalizedEvent | null {
  for (let k = idx - 1; k >= 0; k--) {
    const e = events[k];
    if (e.kind === "tool_call" || e.kind === "file_write" || e.kind === "todo") {
      if (toolUseId && e.toolUseId && e.toolUseId !== toolUseId) continue;
      return e;
    }
  }
  return null;
}
