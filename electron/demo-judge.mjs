#!/usr/bin/env node
// Standalone demo that replicates what the app does when you click
// "Judge with Gemini". Reads a session from the Reflex SQLite DB,
// composes a compact transcript, asks Gemini to analyze, and prints
// the resulting verdict. Writes the verdict back into session_judgments.
//
// Run:
//   node scripts/demo-judge.mjs [session_id]
// If no session_id is given, picks the lowest-scoring session in the DB.

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

const MAX_TRANSCRIPT_CHARS = 60_000;

function loadConfig() {
  return JSON.parse(fs.readFileSync(CONFIG_PATH, "utf8"));
}

function pickSession(db, argId) {
  if (argId) {
    const row = db
      .prepare(
        "SELECT session_id, source FROM session_entries WHERE session_id = ? LIMIT 1",
      )
      .get(argId);
    if (!row) throw new Error("session not found: " + argId);
    return row;
  }
  const row = db
    .prepare(
      `SELECT session_id, source FROM session_ratings
        ORDER BY score ASC, entry_count DESC LIMIT 1`,
    )
    .get();
  if (!row) throw new Error("no sessions rated yet");
  return row;
}

function loadEntries(db, sessionId) {
  return db
    .prepare(
      `SELECT source, entry_id, parent_entry_id, ts, kind, role, model, content
         FROM session_entries WHERE session_id = ? ORDER BY ts ASC, id ASC`,
    )
    .all(sessionId);
}

// Rough clone of normalize.ts — just enough to render a useful transcript.
function entriesToTurns(entries) {
  const turns = [];
  let opencodeHeader = null;
  for (const e of entries) {
    if (e.source === "opencode") {
      if (e.kind === "message" && !e.content && e.role) {
        opencodeHeader = { role: e.role, model: e.model };
        continue;
      }
      if (e.kind === "step-start" || e.kind === "step-finish") continue;
      const role = opencodeHeader?.role ?? "assistant";
      const model = opencodeHeader?.model ?? null;
      if (e.kind === "message") turns.push({ role, kind: "message", model, ts: e.ts, content: e.content });
      else if (e.kind === "reasoning") turns.push({ role: "assistant", kind: "reasoning", model, ts: e.ts, content: e.content });
      else if (e.kind.startsWith("tool_call:")) {
        let args;
        try { args = JSON.parse(e.content); } catch { args = e.content; }
        turns.push({ role: "assistant", kind: "tool_call", model, ts: e.ts, tool: { name: e.kind.slice(10), args } });
      } else if (e.kind === "patch") {
        turns.push({ role: "tool", kind: "tool_result", ts: e.ts, tool: { name: "patch", output: e.content } });
      }
      continue;
    }
    if (e.source === "claude-code" || e.source === "codex") {
      if (e.kind === "system" || e.kind.startsWith("event:")) continue;
      if (e.kind === "message") turns.push({ role: e.role ?? "assistant", kind: "message", model: e.model, ts: e.ts, content: e.content });
      else if (e.kind === "reasoning") turns.push({ role: "assistant", kind: "reasoning", model: e.model, ts: e.ts, content: e.content });
      else if (e.kind.startsWith("tool_call:")) {
        let args;
        try { args = JSON.parse(e.content); } catch { args = e.content; }
        turns.push({ role: "assistant", kind: "tool_call", model: e.model, ts: e.ts, tool: { name: e.kind.slice(10), args } });
      } else if (e.kind === "tool_result") {
        turns.push({ role: "tool", kind: "tool_result", ts: e.ts, tool: { output: e.content } });
      }
    }
  }
  // detect errors in tool_result outputs, propagate to the latest tool_call with same name
  for (let i = 0; i < turns.length; i++) {
    if (turns[i].kind !== "tool_result") continue;
    const out = turns[i].tool?.output ?? "";
    const errored = /error|failed|exception|traceback|panic|denied|not found/i.test(out.slice(0, 1000));
    if (errored && turns[i].tool) turns[i].tool.errored = true;
  }
  return turns;
}

function buildTranscript(turns) {
  const lines = [];
  let used = 0;
  for (const t of turns) {
    const line = renderTurn(t);
    if (used + line.length > MAX_TRANSCRIPT_CHARS) {
      lines.push(`[…truncated, ${turns.length - lines.length} turns remaining…]`);
      break;
    }
    lines.push(line);
    used += line.length + 1;
  }
  return lines.join("\n");
}

function renderTurn(t) {
  const head = `[${t.kind}|${t.role ?? "?"}${t.model ? `|${t.model}` : ""}]`;
  if (t.kind === "tool_call" && t.tool) {
    const args = JSON.stringify(t.tool.args ?? null);
    return `${head} tool=${t.tool.name}${t.tool.errored ? " ERROR" : ""} args=${args.slice(0, 400)}`;
  }
  if (t.kind === "tool_result" && t.tool) {
    const out = (t.tool.output ?? "").slice(0, 600).replace(/\s+/g, " ");
    return `${head} output=${out}`;
  }
  return `${head} ${(t.content ?? "").slice(0, 4000).replace(/\r/g, "")}`;
}

function buildPrompt({ source, repo, transcript }) {
  return [
    "You are a post-mortem reviewer for AI coding agent sessions.",
    `Source: ${source}. Repo: ${repo ?? "unknown"}.`,
    "",
    'Read the transcript and produce a JSON object with fields: score (0-100), summary, strengths (string[]), issues (array of {title, severity "low"|"med"|"high", description, recurring boolean}), user_patterns (string[]), agent_patterns (string[]), actionable_advice (string[]), repo.',
    "",
    "Rules:",
    "- Be specific; reference tool names, files, phrases from the transcript.",
    "- user_patterns = things the USER keeps doing that hurt results.",
    "- agent_patterns = things the AGENT keeps doing wrong.",
    "- Output ONLY the JSON object — no markdown fences, no preamble.",
    "",
    "=== TRANSCRIPT ===",
    transcript,
    "=== END TRANSCRIPT ===",
  ].join("\n");
}

function inferRepo(turns) {
  for (const t of turns) {
    const args = t.tool?.args;
    if (!args || typeof args !== "object") continue;
    for (const k of ["cwd", "workdir", "root"]) {
      if (typeof args[k] === "string") return args[k];
    }
    const p = args.file_path ?? args.path;
    if (typeof p === "string") {
      const parts = p.split("/").filter(Boolean);
      const w = parts.findIndex((s) => s.toLowerCase() === "work");
      if (w >= 0 && parts.length > w + 1) return "/" + parts.slice(0, w + 2).join("/");
    }
  }
  return null;
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

function parseVerdict(raw) {
  const t = raw.replace(/^\s*```(?:json)?\s*/i, "").replace(/\s*```\s*$/, "").trim();
  try { return JSON.parse(t); } catch {}
  const m = t.match(/\{[\s\S]*\}/);
  if (m) return JSON.parse(m[0]);
  throw new Error("unparseable JSON: " + t.slice(0, 300));
}

async function main() {
  const cfg = loadConfig();
  const key = cfg.gemini_api_key;
  const model = cfg.gemini_model ?? "gemini-2.5-flash";
  if (!key) throw new Error("no gemini_api_key in config.json");

  const db = new DatabaseSync(DB_PATH);
  const picked = pickSession(db, process.argv[2]);
  console.log(`→ judging ${picked.source}/${picked.session_id}`);

  const entries = loadEntries(db, picked.session_id);
  const turns = entriesToTurns(entries);
  const repo = inferRepo(turns);
  console.log(`  ${turns.length} turns, ${entries.length} entries, inferred repo: ${repo}`);

  const prompt = buildPrompt({ source: picked.source, repo, transcript: buildTranscript(turns) });
  console.log(`  prompt ${prompt.length} chars; calling ${model}…`);
  const { text, usage } = await callGemini(key, model, prompt);
  const v = parseVerdict(text);

  const verdict = {
    session_id: picked.session_id,
    source: picked.source,
    judge: model,
    judged_at: new Date().toISOString(),
    score: Math.round(Math.max(0, Math.min(100, v.score ?? 0))),
    summary: String(v.summary ?? ""),
    strengths: Array.isArray(v.strengths) ? v.strengths.map(String) : [],
    issues: (v.issues ?? []).map((i) => ({
      title: String(i.title ?? ""),
      severity: ["low", "med", "high"].includes(i.severity) ? i.severity : "med",
      description: String(i.description ?? ""),
      recurring: !!i.recurring,
    })),
    user_patterns: Array.isArray(v.user_patterns) ? v.user_patterns.map(String) : [],
    agent_patterns: Array.isArray(v.agent_patterns) ? v.agent_patterns.map(String) : [],
    actionable_advice: Array.isArray(v.actionable_advice) ? v.actionable_advice.map(String) : [],
    repo: v.repo ?? repo ?? null,
    tokens: { prompt: usage.promptTokenCount, completion: usage.candidatesTokenCount },
  };

  db.prepare(
    `INSERT OR REPLACE INTO session_judgments
      (session_id, source, judge, judged_at, score, entry_count, verdict)
     VALUES (?, ?, ?, ?, ?, ?, ?)`,
  ).run(
    verdict.session_id,
    verdict.source,
    verdict.judge,
    verdict.judged_at,
    verdict.score,
    entries.length,
    JSON.stringify(verdict),
  );

  console.log("\n=============== VERDICT ===============");
  console.log(`score:   ${verdict.score}/100   (${model})`);
  console.log(`summary: ${verdict.summary}`);
  console.log(`tokens:  prompt=${verdict.tokens.prompt}  completion=${verdict.tokens.completion}`);
  if (verdict.repo) console.log(`repo:    ${verdict.repo}`);
  console.log("\nStrengths:");
  verdict.strengths.forEach((s, i) => console.log(`  ${i + 1}. ${s}`));
  console.log("\nIssues:");
  verdict.issues.forEach((i, idx) =>
    console.log(`  ${idx + 1}. [${i.severity}${i.recurring ? " recurring" : ""}] ${i.title}\n     ${i.description}`),
  );
  console.log("\nUser patterns:");
  verdict.user_patterns.forEach((s, i) => console.log(`  ${i + 1}. ${s}`));
  console.log("\nAgent patterns:");
  verdict.agent_patterns.forEach((s, i) => console.log(`  ${i + 1}. ${s}`));
  console.log("\nActionable advice:");
  verdict.actionable_advice.forEach((s, i) => console.log(`  ${i + 1}. ${s}`));
  console.log("=======================================\n");
}

main().catch((e) => {
  console.error("error:", e);
  process.exit(1);
});
