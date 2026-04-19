#!/usr/bin/env node
// Standalone demo: cross-session repo analysis.
//   node demo-repo.mjs            → analyze the repo with the most judgments
//   node demo-repo.mjs /some/path → analyze a specific repo

import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { DatabaseSync } from "node:sqlite";

const CONFIG_PATH = path.join(os.homedir(), ".reflex", "config.json");
const DB_PATH = path.join(
  os.homedir(),
  "Library",
  "Application Support",
  "reflex-desktop",
  "reflex",
  "flows.db",
);
const MAX_JUDGMENTS = 25;

function cfg() {
  return JSON.parse(fs.readFileSync(CONFIG_PATH, "utf8"));
}

function pickRepo(db, argRepo) {
  if (argRepo) return argRepo;
  const row = db
    .prepare(
      `SELECT json_extract(verdict, '$.repo') AS repo, COUNT(*) AS n
         FROM session_judgments
         WHERE json_extract(verdict, '$.repo') IS NOT NULL
         GROUP BY repo
         ORDER BY n DESC LIMIT 1`,
    )
    .get();
  if (!row) throw new Error("no judged sessions in DB yet");
  return row.repo;
}

function loadJudgments(db, repo) {
  const rows = db
    .prepare(
      `SELECT verdict FROM session_judgments
         WHERE json_extract(verdict, '$.repo') = ?
         ORDER BY judged_at ASC`,
    )
    .all(repo);
  return rows.map((r) => JSON.parse(r.verdict));
}

function buildPrompt(repo, judgments) {
  const blocks = judgments.map((j, i) => {
    const issues = (j.issues ?? [])
      .map(
        (iss) =>
          `      - [${iss.severity}${iss.recurring ? " recurring" : ""}] ${iss.title}: ${truncate(iss.description, 300)}`,
      )
      .join("\n");
    const bullets = (arr) => (arr ?? []).map((s) => `      - ${truncate(s, 300)}`).join("\n");
    return [
      `--- session ${i + 1}/${judgments.length} — ${j.source} — ${j.session_id.slice(0, 14)} — score ${j.score}/100 — ${(j.judged_at ?? "").slice(0, 19)} ---`,
      `  summary: ${truncate(j.summary ?? "", 400)}`,
      issues ? `  issues:\n${issues}` : `  issues: (none)`,
      (j.strengths ?? []).length ? `  strengths:\n${bullets(j.strengths)}` : "",
      (j.user_patterns ?? []).length ? `  user_patterns:\n${bullets(j.user_patterns)}` : "",
      (j.agent_patterns ?? []).length ? `  agent_patterns:\n${bullets(j.agent_patterns)}` : "",
      (j.actionable_advice ?? []).length ? `  actionable_advice:\n${bullets(j.actionable_advice)}` : "",
    ].filter(Boolean).join("\n");
  });

  return [
    "You are synthesising cross-session patterns for AI coding agent sessions that all happened in the SAME repository.",
    `Repo path: ${repo}`,
    "",
    "You will receive per-session judgments. Identify which issues TRULY recur across MULTIPLE sessions (not just within one). Distil user/agent patterns. Produce repo-specific advice.",
    "",
    "Respond with EXACTLY this JSON (no preamble, no fences):",
    "{",
    '  "summary": "1-2 sentence headline for this repo",',
    '  "recurring_issues": [{"title":"","severity":"low|med|high","description":"","recurring":true}],',
    '  "recurring_user_patterns": ["…"],',
    '  "recurring_agent_patterns": ["…"],',
    '  "actionable_advice": ["…"],',
    '  "context_md": "# Repo context for AI agents\\n\\n… well-structured markdown to paste into AGENTS.md; under 500 words; Summary → Project notes → Avoid patterns → Preferred patterns"',
    "}",
    "",
    "=== SESSION JUDGMENTS ===",
    ...blocks,
    "=== END ===",
  ].join("\n");
}

async function callGemini(key, model, prompt) {
  const url = `https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(model)}:generateContent?key=${encodeURIComponent(key)}`;
  const res = await fetch(url, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({
      contents: [{ role: "user", parts: [{ text: prompt }] }],
      generationConfig: { temperature: 0.2, responseMimeType: "application/json" },
    }),
  });
  if (!res.ok) throw new Error(`gemini: ${res.status} ${await res.text()}`);
  const data = await res.json();
  const text = data.candidates?.[0]?.content?.parts?.map((p) => p.text).join("") ?? "";
  return { text, usage: data.usageMetadata ?? {} };
}

function parseJson(s) {
  const t = s.replace(/^\s*```(?:json)?\s*/i, "").replace(/\s*```\s*$/, "").trim();
  try { return JSON.parse(t); } catch {}
  const m = t.match(/\{[\s\S]*\}/);
  if (m) return JSON.parse(m[0]);
  throw new Error("unparseable JSON: " + t.slice(0, 300));
}

function truncate(s, n) { return s.length > n ? s.slice(0, n) + "…" : s; }

async function main() {
  const c = cfg();
  if (!c.gemini_api_key) throw new Error("no gemini_api_key in config.json");
  const model = c.gemini_model ?? "gemini-2.5-flash";

  const db = new DatabaseSync(DB_PATH);
  const repo = pickRepo(db, process.argv[2]);
  const judgments = loadJudgments(db, repo).slice(-MAX_JUDGMENTS);
  console.log(`→ analyzing ${judgments.length} sessions for ${repo}`);

  const prompt = buildPrompt(repo, judgments);
  console.log(`  prompt ${prompt.length} chars; calling ${model}…`);

  const { text, usage } = await callGemini(c.gemini_api_key, model, prompt);
  const v = parseJson(text);

  const insight = {
    repo,
    session_count: judgments.length,
    score_avg: Math.round((judgments.reduce((s, j) => s + (j.score ?? 0), 0) / judgments.length) * 10) / 10,
    judge: model,
    evaluated_at: new Date().toISOString(),
    summary: String(v.summary ?? ""),
    recurring_issues: (v.recurring_issues ?? []).map((x) => ({
      title: String(x.title ?? ""),
      severity: ["low","med","high"].includes(x.severity) ? x.severity : "med",
      description: String(x.description ?? ""),
      recurring: true,
    })),
    recurring_user_patterns: (v.recurring_user_patterns ?? []).map(String),
    recurring_agent_patterns: (v.recurring_agent_patterns ?? []).map(String),
    actionable_advice: (v.actionable_advice ?? []).map(String),
    context_md: typeof v.context_md === "string" ? v.context_md.trim() : "",
    tokens: { prompt: usage.promptTokenCount, completion: usage.candidatesTokenCount },
  };

  db.prepare(
    `INSERT OR REPLACE INTO repo_insights
      (repo, session_count, score_avg, judge, evaluated_at, insight)
     VALUES (?, ?, ?, ?, ?, ?)`,
  ).run(
    insight.repo, insight.session_count, insight.score_avg,
    insight.judge, insight.evaluated_at, JSON.stringify(insight),
  );

  console.log("\n=============== REPO INSIGHT ===============");
  console.log(`repo:    ${insight.repo}`);
  console.log(`sessions: ${insight.session_count} · avg score ${insight.score_avg}/100`);
  console.log(`judge:   ${insight.judge}  (tokens: ${insight.tokens.prompt}/${insight.tokens.completion})`);
  console.log(`\nSummary:\n  ${insight.summary}`);
  if (insight.recurring_issues.length) {
    console.log("\nRecurring issues:");
    insight.recurring_issues.forEach((iss, i) => console.log(`  ${i+1}. [${iss.severity}] ${iss.title}\n     ${iss.description}`));
  }
  if (insight.recurring_user_patterns.length) {
    console.log("\nRecurring user patterns:");
    insight.recurring_user_patterns.forEach((s, i) => console.log(`  ${i+1}. ${s}`));
  }
  if (insight.recurring_agent_patterns.length) {
    console.log("\nRecurring agent patterns:");
    insight.recurring_agent_patterns.forEach((s, i) => console.log(`  ${i+1}. ${s}`));
  }
  if (insight.actionable_advice.length) {
    console.log("\nActionable advice:");
    insight.actionable_advice.forEach((s, i) => console.log(`  ${i+1}. ${s}`));
  }
  console.log("\n----- AGENTS_CONTEXT.md (paste into repo) -----");
  console.log(insight.context_md);
  console.log("============================================\n");
}

main().catch((e) => { console.error("error:", e); process.exit(1); });
