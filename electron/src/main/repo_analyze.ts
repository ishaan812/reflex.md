// Cross-session analyzer: given all per-session judgments for one repo,
// second-pass Gemini to distill patterns that TRULY recur (across sessions,
// not just within one). Produces a `RepoInsight` + a `context_md` that is
// paste-ready for `<repo>/AGENTS_CONTEXT.md` (or CLAUDE.md / AGENTS.md).

import type { SessionJudgment, RepoInsight, JudgeIssue } from "@shared/judge";

import { loadConfig } from "./config";

const GEMINI_ENDPOINT =
  "https://generativelanguage.googleapis.com/v1beta/models";

/** How many per-session judgments we cram into the analyzer prompt. */
const MAX_JUDGMENTS = 25;
const MAX_PROMPT_CHARS = 120_000;

export async function analyzeRepo(
  repo: string,
  judgments: SessionJudgment[],
  opts: { model?: string } = {},
): Promise<RepoInsight> {
  const cfg = loadConfig();
  const apiKey = cfg.gemini_api_key;
  if (!apiKey) {
    throw new Error(
      "no gemini_api_key in ~/.reflex/config.json — set it first",
    );
  }
  const model = opts.model ?? cfg.gemini_model ?? "gemini-2.5-flash";

  if (judgments.length === 0) {
    throw new Error(`no judgments available for repo ${repo}`);
  }

  // Sort oldest→newest so the model can see progression / regression.
  const sorted = [...judgments].sort((a, b) =>
    a.judged_at.localeCompare(b.judged_at),
  );
  const selected = sorted.slice(-MAX_JUDGMENTS);

  const prompt = buildPrompt({ repo, judgments: selected });
  if (prompt.length > MAX_PROMPT_CHARS) {
    // Shouldn't happen with MAX_JUDGMENTS cap, but belt-and-braces.
    throw new Error(
      `repo prompt too large (${prompt.length} chars) — reduce MAX_JUDGMENTS`,
    );
  }

  const url = `${GEMINI_ENDPOINT}/${encodeURIComponent(model)}:generateContent?key=${encodeURIComponent(apiKey)}`;
  const res = await fetch(url, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({
      contents: [{ role: "user", parts: [{ text: prompt }] }],
      generationConfig: {
        temperature: 0.2,
        responseMimeType: "application/json",
      },
    }),
  });
  if (!res.ok) {
    const msg = await res.text().catch(() => "");
    throw new Error(
      `gemini failed: ${res.status} ${res.statusText} — ${msg.slice(0, 400)}`,
    );
  }

  const data = (await res.json()) as GeminiResponse;
  const raw =
    data.candidates?.[0]?.content?.parts?.map((p) => p.text).join("") ?? "";
  if (!raw) {
    throw new Error("gemini returned empty response");
  }
  const parsed = safeParse(raw);

  const score_avg =
    selected.reduce((sum, j) => sum + (j.score ?? 0), 0) / selected.length;

  const insight: RepoInsight = {
    repo,
    session_count: selected.length,
    score_avg: Math.round(score_avg * 10) / 10,
    judge: model,
    evaluated_at: new Date().toISOString(),

    summary: String(parsed.summary ?? "").slice(0, 500),
    recurring_issues: (parsed.recurring_issues ?? [])
      .slice(0, 20)
      .map(sanitizeIssue),
    recurring_user_patterns: stringArr(parsed.recurring_user_patterns),
    recurring_agent_patterns: stringArr(parsed.recurring_agent_patterns),
    actionable_advice: stringArr(parsed.actionable_advice),

    context_md:
      typeof parsed.context_md === "string"
        ? parsed.context_md.trim()
        : buildFallbackMd({
            repo,
            summary: String(parsed.summary ?? ""),
            actionable_advice: stringArr(parsed.actionable_advice),
            recurring_user_patterns: stringArr(parsed.recurring_user_patterns),
            recurring_agent_patterns: stringArr(parsed.recurring_agent_patterns),
          }),

    tokens: {
      prompt: data.usageMetadata?.promptTokenCount,
      completion: data.usageMetadata?.candidatesTokenCount,
    },
  };

  return insight;
}

// ------------------------- Prompt building ---------------------------------

function buildPrompt(ctx: {
  repo: string;
  judgments: SessionJudgment[];
}): string {
  const blocks = ctx.judgments.map((j, i) => {
    const issues = j.issues
      .map(
        (iss) =>
          `      - [${iss.severity}${iss.recurring ? " recurring" : ""}] ${iss.title}: ${truncate(iss.description, 300)}`,
      )
      .join("\n");
    const strengths = bullets(j.strengths);
    const usr = bullets(j.user_patterns);
    const agt = bullets(j.agent_patterns);
    const adv = bullets(j.actionable_advice);
    return [
      `--- session ${i + 1}/${ctx.judgments.length} — ${j.source} — ${j.session_id.slice(0, 14)} — score ${j.score}/100 — ${j.judged_at.slice(0, 19)} ---`,
      `  summary: ${truncate(j.summary, 400)}`,
      issues ? `  issues:\n${issues}` : `  issues: (none)`,
      strengths ? `  strengths:\n${strengths}` : "",
      usr ? `  user_patterns:\n${usr}` : "",
      agt ? `  agent_patterns:\n${agt}` : "",
      adv ? `  actionable_advice:\n${adv}` : "",
    ]
      .filter(Boolean)
      .join("\n");
  });

  return [
    "You are synthesising cross-session patterns for AI coding agent sessions that all happened in the SAME repository.",
    `Repo path: ${ctx.repo}`,
    "",
    "You will receive per-session judgments (each already has its own issues/patterns/advice). Your job:",
    "  1. Identify which issues TRULY recur — they must appear across MULTIPLE sessions, not just multiple times within one session.",
    "  2. Distil the user patterns to the ones the USER repeatedly does (across sessions).",
    "  3. Distil the agent patterns to things the agent keeps getting wrong in THIS repo.",
    "  4. Produce actionable advice specific to working on this repo.",
    "  5. Produce a short Markdown context file that a human (or agent) would paste into the repo's AGENTS.md / CLAUDE.md so future sessions avoid the same mistakes.",
    "",
    "Respond with EXACTLY this JSON (no preamble, no fences):",
    "{",
    `  "summary": "one or two sentence headline for this repo's agent interactions",`,
    `  "recurring_issues": [{`,
    `    "title": "short",`,
    `    "severity": "low" | "med" | "high",`,
    `    "description": "specific — reference concrete tools/paths/phrases from across sessions",`,
    `    "recurring": true`,
    `  }],`,
    `  "recurring_user_patterns": ["things the user keeps doing wrong in this repo"],`,
    `  "recurring_agent_patterns": ["things the agent keeps doing wrong in this repo"],`,
    `  "actionable_advice": ["prioritised, concrete advice to write into the agent's context"],`,
    `  "context_md": "# Repo context for AI agents\\n\\n…well-structured markdown meant to be pasted directly into AGENTS.md; keep it under 500 words; start with a Summary, then Project notes, then Avoid patterns, then Preferred patterns"`,
    "}",
    "",
    "Rules:",
    "- Be specific. Reference tool names, file paths, or exact phrases that appeared.",
    "- The context_md should be useful even to an agent who has never worked in this repo before. Focus on stable, non-trivial things.",
    "- Never fabricate. If only one session is available, summarise it briefly but don't invent patterns.",
    "- Do NOT wrap the JSON in markdown fences.",
    "",
    "=== SESSION JUDGMENTS ===",
    ...blocks,
    "=== END ===",
  ].join("\n");
}

function buildFallbackMd(ctx: {
  repo: string;
  summary: string;
  actionable_advice: string[];
  recurring_user_patterns: string[];
  recurring_agent_patterns: string[];
}): string {
  const lines = [
    `# Reflex · cross-session context for \`${ctx.repo}\``,
    "",
    "## Summary",
    ctx.summary || "_(no cross-session summary yet)_",
    "",
  ];
  if (ctx.actionable_advice.length) {
    lines.push("## Do this", "");
    for (const a of ctx.actionable_advice) lines.push(`- ${a}`);
    lines.push("");
  }
  if (ctx.recurring_agent_patterns.length) {
    lines.push("## Avoid (agent patterns)", "");
    for (const a of ctx.recurring_agent_patterns) lines.push(`- ${a}`);
    lines.push("");
  }
  if (ctx.recurring_user_patterns.length) {
    lines.push("## Note (user tendencies)", "");
    for (const a of ctx.recurring_user_patterns) lines.push(`- ${a}`);
    lines.push("");
  }
  return lines.join("\n");
}

// ------------------------- Helpers ----------------------------------------

interface GeminiResponse {
  candidates?: Array<{
    content?: { parts?: Array<{ text?: string }> };
  }>;
  usageMetadata?: {
    promptTokenCount?: number;
    candidatesTokenCount?: number;
  };
}

interface RawInsight {
  summary?: string;
  recurring_issues?: Array<Partial<JudgeIssue>>;
  recurring_user_patterns?: unknown[];
  recurring_agent_patterns?: unknown[];
  actionable_advice?: unknown[];
  context_md?: string;
}

function safeParse(s: string): RawInsight {
  const trimmed = s
    .replace(/^\s*```(?:json)?\s*/i, "")
    .replace(/\s*```\s*$/, "")
    .trim();
  try {
    return JSON.parse(trimmed) as RawInsight;
  } catch {
    const m = trimmed.match(/\{[\s\S]*\}/);
    if (m) return JSON.parse(m[0]) as RawInsight;
    throw new Error("unparseable JSON: " + trimmed.slice(0, 400));
  }
}

function sanitizeIssue(raw: Partial<JudgeIssue>): JudgeIssue {
  const severity: JudgeIssue["severity"] =
    raw.severity === "high" || raw.severity === "med" || raw.severity === "low"
      ? raw.severity
      : "med";
  return {
    title: String(raw.title ?? "").slice(0, 200),
    severity,
    description: String(raw.description ?? "").slice(0, 1500),
    recurring: true, // by definition in this output
  };
}

function stringArr(v: unknown): string[] {
  if (!Array.isArray(v)) return [];
  return v
    .map((x) => (typeof x === "string" ? x : JSON.stringify(x)))
    .map((s) => s.trim())
    .filter(Boolean)
    .slice(0, 20);
}

function bullets(items: string[]): string {
  return items.map((s) => `      - ${truncate(s, 300)}`).join("\n");
}

function truncate(s: string, n: number): string {
  return s.length > n ? s.slice(0, n) + "…" : s;
}
