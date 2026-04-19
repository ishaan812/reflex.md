import type { CorrectionCluster, CorrectionSignal, TranscriptEvent } from "./types.js";

const NEGATION_RE =
  /\b(no|don'?t|stop|wait|revert|that'?s wrong|not (?:that|like)|instead|actually|undo|rollback|please don'?t)\b/i;

const STOPWORDS = new Set([
  "the", "a", "an", "to", "of", "in", "is", "it", "that", "this", "and", "or",
  "no", "not", "dont", "don't", "for", "on", "be", "do", "with", "at", "i",
  "you", "we", "me", "my", "your", "our", "please", "can", "will", "should",
  "would", "could", "use", "using",
]);

export function detectCorrections(events: TranscriptEvent[]): CorrectionSignal[] {
  const out: CorrectionSignal[] = [];
  for (let i = 0; i < events.length; i++) {
    const e = events[i] as any;
    if (e.type === "user_prompt" && typeof e.text === "string" && NEGATION_RE.test(e.text)) {
      out.push({ kind: "explicit", intensity: 1, text: e.text, ts: e.ts });
    }
    if (e.type === "tool_call" && typeof e.exit_code === "number" && e.exit_code !== 0) {
      // look forward for a same-tool call within 60s
      const baseTs = new Date(e.ts).getTime();
      for (let j = i + 1; j < events.length; j++) {
        const n = events[j] as any;
        if (n.type !== "tool_call") continue;
        const dt = new Date(n.ts).getTime() - baseTs;
        if (dt < 0 || dt > 60_000) break;
        if (n.tool_name === e.tool_name) {
          out.push({
            kind: "tool_retry",
            intensity: 2,
            text: `${e.tool_name} retry after non-zero exit`,
            ts: e.ts,
          });
          break;
        }
      }
    }
  }
  return out;
}

export function scoreSession(events: TranscriptEvent[]): number {
  const prompts = events.filter((e: any) => e.type === "user_prompt").length || 1;
  const corrections = detectCorrections(events);
  const total = corrections.reduce((a, c) => a + c.intensity, 0);
  return total / prompts;
}

export function clusterCorrections(all: CorrectionSignal[]): CorrectionCluster[] {
  const byKey = new Map<string, CorrectionCluster>();
  for (const c of all) {
    const tokens = c.text
      .toLowerCase()
      .replace(/[^a-z0-9\s]/g, " ")
      .split(/\s+/)
      .filter((t) => t && !STOPWORDS.has(t) && t.length > 1);
    const key = tokens.slice(0, 5).sort().join(" ") || "(empty)";
    const entry = byKey.get(key) ?? { key, count: 0, samples: [], totalIntensity: 0 };
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
