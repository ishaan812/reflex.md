// Gemini-powered session judge.
//
// Takes a normalized Turn[] for one session, composes a compact transcript,
// asks Gemini to analyze it, and returns a structured `SessionJudgment`.
//
// Uses raw fetch to avoid pulling in the full @google/generative-ai SDK;
// Gemini's REST API is small and stable enough.

import type { Turn } from "@shared/turn";
import type { JudgeIssue, SessionJudgment } from "@shared/judge";

import { loadConfig } from "./config";

const GEMINI_ENDPOINT =
  "https://generativelanguage.googleapis.com/v1beta/models";

/** Estimated chars-per-turn when deciding what to send vs drop. */
const MAX_TRANSCRIPT_CHARS = 60_000; // ~20k tokens of context

export async function judgeSessionWithGemini(
  sessionId: string,
  source: string,
  turns: Turn[],
  opts: { model?: string } = {},
): Promise<SessionJudgment> {
  const cfg = loadConfig();
  const apiKey = cfg.gemini_api_key;
  if (!apiKey) {
    throw new Error(
      "no gemini_api_key in ~/.reflex/config.json — set it first",
    );
  }
  const model = opts.model ?? cfg.gemini_model ?? "gemini-2.5-flash";

  const transcript = buildTranscript(turns);
  const repo = inferRepo(turns);
  const prompt = buildPrompt({ source, repo, transcript });

  const url = `${GEMINI_ENDPOINT}/${encodeURIComponent(model)}:generateContent?key=${encodeURIComponent(apiKey)}`;

  const body = {
    contents: [
      {
        role: "user",
        parts: [{ text: prompt }],
      },
    ],
    generationConfig: {
      temperature: 0.2,
      responseMimeType: "application/json",
    },
  };

  const res = await fetch(url, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  });

  if (!res.ok) {
    const msg = await res.text().catch(() => "");
    throw new Error(
      `gemini request failed: ${res.status} ${res.statusText} — ${msg.slice(0, 400)}`,
    );
  }

  const data = (await res.json()) as GeminiResponse;
  const raw =
    data.candidates?.[0]?.content?.parts?.map((p) => p.text).join("") ?? "";

  if (!raw) {
    throw new Error("gemini response empty — " + JSON.stringify(data).slice(0, 400));
  }

  const parsed = safeParseVerdict(raw);

  const verdict: SessionJudgment = {
    session_id: sessionId,
    source,
    judge: model,
    judged_at: new Date().toISOString(),
    score: clamp(parsed.score ?? 0, 0, 100),
    summary: String(parsed.summary ?? "").slice(0, 500),
    strengths: stringArr(parsed.strengths),
    issues: (parsed.issues ?? []).slice(0, 20).map(sanitizeIssue),
    user_patterns: stringArr(parsed.user_patterns),
    agent_patterns: stringArr(parsed.agent_patterns),
    actionable_advice: stringArr(parsed.actionable_advice),
    repo: repo ?? parsed.repo ?? null,
    tokens: {
      prompt: data.usageMetadata?.promptTokenCount,
      completion: data.usageMetadata?.candidatesTokenCount,
    },
    raw: raw.slice(0, 12_000),
  };

  return verdict;
}

// --- Transcript + prompt building -----------------------------------------

function buildTranscript(turns: Turn[]): string {
  const out: string[] = [];
  let used = 0;
  for (const t of turns) {
    const line = renderTurn(t);
    if (used + line.length > MAX_TRANSCRIPT_CHARS) {
      out.push(
        `[…truncated, ${turns.length - out.length} turns remaining…]`,
      );
      break;
    }
    out.push(line);
    used += line.length + 1;
  }
  return out.join("\n");
}

function renderTurn(t: Turn): string {
  const head = `[${t.kind}|${t.role ?? "?"}${t.model ? `|${t.model}` : ""}]`;
  const ts = t.ts ? ` (${t.ts})` : "";
  if (t.kind === "tool_call" && t.tool) {
    const args = shortJson(t.tool.args);
    const status = t.tool.errored ? " ERROR" : "";
    return `${head}${ts} tool=${t.tool.name}${status} args=${args}`;
  }
  if (t.kind === "tool_result" && t.tool) {
    const status = t.tool.errored ? "ERROR" : "ok";
    const preview = t.text.slice(0, 600).replace(/\s+/g, " ");
    return `${head}${ts} tool=${t.tool.name} status=${status} output=${preview}`;
  }
  // text content
  const body = t.text.slice(0, 4000).replace(/\r/g, "");
  return `${head}${ts} ${body}`;
}

function buildPrompt(ctx: {
  source: string;
  repo: string | null;
  transcript: string;
}): string {
  return [
    "You are a post-mortem reviewer for AI coding agent sessions.",
    `Source: ${ctx.source}. Repo: ${ctx.repo ?? "unknown"}.`,
    "",
    "Read the transcript below and produce a JSON object with exactly these fields:",
    "",
    `{`,
    `  "score": integer 0..100,  // 100 = flawless, 0 = ruinous`,
    `  "summary": "one-sentence headline describing how this session went",`,
    `  "strengths": ["…things the agent/user did well"],`,
    `  "issues": [`,
    `     {`,
    `       "title": "short title",`,
    `       "severity": "low" | "med" | "high",`,
    `       "description": "specific, concrete description",`,
    `       "recurring": true|false  // pattern that appears multiple times in THIS session`,
    `     }`,
    `  ],`,
    `  "user_patterns": [`,
    `    "…things the USER keeps doing that make agent results worse (e.g. vague prompts, changing requirements mid-task, ignoring error output, skipping context)"`,
    `  ],`,
    `  "agent_patterns": [`,
    `    "…things the AGENT keeps doing wrong (e.g. retrying a failed tool with identical args, editing files without reading them, using deprecated APIs, declaring done before verifying)"`,
    `  ],`,
    `  "actionable_advice": [`,
    `    "Prioritised list of concrete, specific advice for future sessions in this repo. Max 8 items."`,
    `  ],`,
    `  "repo": "${ctx.repo ?? ""}"`,
    `}`,
    "",
    "Rules:",
    "- Be specific. Reference tool names, file paths, or phrases from the transcript.",
    "- Do NOT hedge (avoid 'perhaps', 'might', 'could'); state the issue directly.",
    "- If the session is short / trivial / without problems, return a high score and empty issues[].",
    "- Output ONLY the JSON object. No preamble, no markdown fences.",
    "",
    "=== TRANSCRIPT ===",
    ctx.transcript,
    "=== END TRANSCRIPT ===",
  ].join("\n");
}

// --- Helpers --------------------------------------------------------------

interface GeminiResponse {
  candidates?: Array<{
    content?: { parts?: Array<{ text?: string }> };
    finishReason?: string;
  }>;
  usageMetadata?: {
    promptTokenCount?: number;
    candidatesTokenCount?: number;
  };
}

interface RawVerdict {
  score?: number;
  summary?: string;
  strengths?: unknown[];
  issues?: Array<Partial<JudgeIssue>>;
  user_patterns?: unknown[];
  agent_patterns?: unknown[];
  actionable_advice?: unknown[];
  repo?: string | null;
}

function safeParseVerdict(s: string): RawVerdict {
  // Gemini sometimes wraps JSON in ```json fences even with responseMimeType set.
  const trimmed = s
    .replace(/^\s*```(?:json)?\s*/i, "")
    .replace(/\s*```\s*$/i, "")
    .trim();
  try {
    return JSON.parse(trimmed) as RawVerdict;
  } catch {
    // Try to recover the first { … } block
    const m = trimmed.match(/\{[\s\S]*\}/);
    if (m) {
      try {
        return JSON.parse(m[0]) as RawVerdict;
      } catch {
        // fall through
      }
    }
    throw new Error(`gemini returned unparseable JSON: ${trimmed.slice(0, 500)}`);
  }
}

function stringArr(v: unknown): string[] {
  if (!Array.isArray(v)) return [];
  return v
    .map((x) => (typeof x === "string" ? x : JSON.stringify(x)))
    .map((s) => s.trim())
    .filter(Boolean)
    .slice(0, 20);
}

function sanitizeIssue(raw: Partial<JudgeIssue>): JudgeIssue {
  const severity: JudgeIssue["severity"] =
    raw.severity === "high" || raw.severity === "med" || raw.severity === "low"
      ? raw.severity
      : "med";
  return {
    title: String(raw.title ?? "").slice(0, 200),
    severity,
    description: String(raw.description ?? "").slice(0, 2000),
    recurring: !!raw.recurring,
    at_turn_index:
      typeof raw.at_turn_index === "number" ? raw.at_turn_index : undefined,
  };
}

function shortJson(v: unknown): string {
  try {
    const s = typeof v === "string" ? v : JSON.stringify(v);
    return s.length > 400 ? s.slice(0, 400) + "…" : s;
  } catch {
    return String(v);
  }
}

function clamp(n: number, lo: number, hi: number): number {
  return Math.max(lo, Math.min(hi, Math.round(n)));
}

function inferRepo(turns: Turn[]): string | null {
  // Look for a cwd in any tool_call arguments or in metadata-like fields.
  for (const t of turns) {
    const args = t.tool?.args as Record<string, unknown> | undefined;
    if (args) {
      for (const key of ["cwd", "workdir", "workingDir", "root", "repo"]) {
        const v = args[key];
        if (typeof v === "string" && v.length) return v;
      }
      const p = args["file_path"] ?? args["path"];
      if (typeof p === "string") {
        return deriveRepoFromPath(p);
      }
    }
  }
  return null;
}

function deriveRepoFromPath(p: string): string | null {
  // Heuristic: repo root is the first path component under ~/work or similar.
  const parts = p.split("/").filter(Boolean);
  const w = parts.findIndex((seg) => seg.toLowerCase() === "work");
  if (w >= 0 && parts.length > w + 1) return "/" + parts.slice(0, w + 2).join("/");
  return null;
}
