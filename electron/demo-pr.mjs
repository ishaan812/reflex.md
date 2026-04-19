#!/usr/bin/env node
// Open a PR against a GitHub repo using the Reflex-generated cross-session
// insight for that repo. Pure-fetch (no Octokit). Mirrors main/github.ts.
//
//   node demo-pr.mjs [/path/to/local/repo]

import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { DatabaseSync } from "node:sqlite";

const CONFIG = path.join(os.homedir(), ".reflex", "config.json");
const DB = path.join(
  os.homedir(),
  "Library/Application Support/reflex-desktop/reflex/flows.db",
);

const CANDIDATES = [
  "AGENTS.md",
  "CLAUDE.md",
  ".github/copilot-instructions.md",
  ".cursor/rules",
  "CODEX.md",
  "AGENT.md",
];

const START = "<!-- reflex:context:start -->";
const END = "<!-- reflex:context:end -->";

const cfg = JSON.parse(fs.readFileSync(CONFIG, "utf8"));
const tok = cfg.github_token;
if (!tok) { console.error("no github_token in config"); process.exit(1); }

async function gh(method, url, body) {
  const res = await fetch("https://api.github.com" + url, {
    method,
    headers: {
      accept: "application/vnd.github+json",
      "x-github-api-version": "2022-11-28",
      authorization: "Bearer " + tok,
      "user-agent": "reflex-demo/0.1",
      ...(body ? { "content-type": "application/json" } : {}),
    },
    body: body ? JSON.stringify(body) : undefined,
  });
  if (res.status === 204) return;
  const data = await res.json().catch(() => ({}));
  if (!res.ok) {
    const err = new Error(data.message ?? `${method} ${url}: ${res.status}`);
    err.status = res.status;
    err.body = data;
    throw err;
  }
  return data;
}

function parseRemote(url) {
  let m = url.match(/github\.com[:/]{1}([^/]+)\/([^/\s]+?)(?:\.git)?$/);
  return m ? { owner: m[1], repo: m[2] } : null;
}

function detect(localPath) {
  const cfg = fs.readFileSync(path.join(localPath, ".git", "config"), "utf8");
  const m = cfg.match(/\[remote "origin"\][\s\S]*?url\s*=\s*([^\s]+)/);
  return m ? parseRemote(m[1]) : null;
}

function renderBlock(insight) {
  const meta = [
    `> Refreshed ${new Date(insight.evaluated_at).toISOString().slice(0, 19)}Z`,
    `> Based on ${insight.session_count} Reflex-judged session${insight.session_count === 1 ? "" : "s"}, avg score ${insight.score_avg}/100`,
    `> Judge: ${insight.judge}`,
  ].join("\n");
  return [START, "", meta, "", insight.context_md.trim(), "", END, ""].join("\n");
}

function merge(existing, insight) {
  const block = renderBlock(insight);
  if (!existing.trim()) return { body: block.trimStart(), action: "created" };
  if (existing.includes(START) && existing.includes(END)) {
    const before = existing.slice(0, existing.indexOf(START));
    const afterIdx = existing.indexOf(END) + END.length;
    const after = existing.slice(afterIdx);
    return { body: before.replace(/\s+$/, "") + "\n\n" + block + after, action: "replaced-reflex-block" };
  }
  const spacer = existing.endsWith("\n") ? "\n" : "\n\n";
  return { body: existing + spacer + block, action: "updated" };
}

function prBody(insight, action, target) {
  const actionText = {
    created: `Created \`${target}\` with the initial Reflex-derived context block.`,
    updated: `Appended a Reflex-derived context block to \`${target}\`.`,
    "replaced-reflex-block": `Refreshed the existing Reflex block inside \`${target}\`.`,
  }[action];
  const lines = [
    `**Summary**: ${insight.summary}`,
    "",
    actionText,
    "",
    `This PR was opened by Reflex after analyzing **${insight.session_count}** past AI-agent session(s) in this repo (average score **${insight.score_avg}/100**, evaluated with \`${insight.judge}\`).`,
    "",
  ];
  if (insight.recurring_agent_patterns?.length) {
    lines.push(`### Recurring agent patterns (across sessions)`);
    for (const p of insight.recurring_agent_patterns.slice(0, 8)) lines.push(`- ${p}`);
    lines.push("");
  }
  if (insight.recurring_user_patterns?.length) {
    lines.push(`### Recurring user patterns`);
    for (const p of insight.recurring_user_patterns.slice(0, 8)) lines.push(`- ${p}`);
    lines.push("");
  }
  if (insight.actionable_advice?.length) {
    lines.push(`### Actionable advice baked into the context`);
    for (const a of insight.actionable_advice.slice(0, 10)) lines.push(`- ${a}`);
    lines.push("");
  }
  lines.push(
    "---",
    "<sub>The block between `<!-- reflex:context:start -->` and `<!-- reflex:context:end -->` will be refreshed in place on future PRs. Edit outside that block freely.</sub>",
  );
  return lines.join("\n");
}

async function main() {
  const localRepo = process.argv[2] ?? "/Users/bhavya_gor/work/main-reflex";
  const remote = detect(localRepo);
  if (!remote) throw new Error("no github remote in " + localRepo);
  console.log(`target repo: ${remote.owner}/${remote.repo}`);

  // Fetch insight from DB
  const db = new DatabaseSync(DB);
  // Each clone's judgments use its own local path as repo; find insight that matches
  // the inferred repo path (which our judge.ts stores in insight.repo).
  // We cache insights under the local path (what the user passed to analyze).
  const row = db.prepare("SELECT insight FROM repo_insights WHERE repo = ?").get(localRepo);
  if (!row) throw new Error(`no insight for ${localRepo}; run analyze first`);
  const insight = JSON.parse(row.insight);
  console.log(`insight: ${insight.session_count} sessions, ${insight.score_avg}/100, ${insight.context_md.length} chars`);

  // 1. default branch
  const repoInfo = await gh("GET", `/repos/${remote.owner}/${remote.repo}`);
  const defaultBranch = repoInfo.default_branch;
  console.log(`default branch: ${defaultBranch}`);

  // 2. find target file
  let target = null, existingSha, existingContent = "";
  for (const c of CANDIDATES) {
    try {
      const f = await gh("GET", `/repos/${remote.owner}/${remote.repo}/contents/${encodeURIComponent(c)}?ref=${encodeURIComponent(defaultBranch)}`);
      if (f.type === "file") {
        target = c;
        existingSha = f.sha;
        if (f.content && f.encoding === "base64") existingContent = Buffer.from(f.content, "base64").toString("utf8");
        break;
      }
    } catch (e) {
      if (e.status !== 404) throw e;
    }
  }
  if (!target) target = "AGENTS.md";
  console.log(`target file: ${target}  (${existingSha ? "exists" : "will be created"})`);

  // 3. merge body
  const { body, action } = merge(existingContent, insight);
  console.log(`action: ${action}, new body ${body.length} chars`);

  // 4. branch
  const branch = "reflex/agent-context";
  const baseRef = await gh("GET", `/repos/${remote.owner}/${remote.repo}/git/refs/heads/${encodeURIComponent(defaultBranch)}`);
  const baseSha = baseRef.object.sha;
  let branchExists = true;
  try {
    await gh("GET", `/repos/${remote.owner}/${remote.repo}/git/refs/heads/${encodeURIComponent(branch)}`);
  } catch (e) { if (e.status === 404) branchExists = false; else throw e; }
  if (!branchExists) {
    await gh("POST", `/repos/${remote.owner}/${remote.repo}/git/refs`, { ref: `refs/heads/${branch}`, sha: baseSha });
    console.log(`created branch ${branch}`);
  } else {
    console.log(`branch ${branch} already exists; updating`);
  }

  // File sha on branch
  let branchFileSha = existingSha;
  try {
    const f = await gh("GET", `/repos/${remote.owner}/${remote.repo}/contents/${encodeURIComponent(target)}?ref=${encodeURIComponent(branch)}`);
    branchFileSha = f.sha;
  } catch (e) { if (e.status !== 404) throw e; }

  // 5. commit
  const msg = `chore(agents): refresh Reflex-derived context (${insight.session_count} sessions, avg ${insight.score_avg}/100)`;
  await gh("PUT", `/repos/${remote.owner}/${remote.repo}/contents/${encodeURIComponent(target)}`, {
    branch,
    message: msg,
    content: Buffer.from(body, "utf8").toString("base64"),
    sha: branchFileSha,
    committer: { name: "Reflex", email: "reflex@localhost" },
    author: { name: "Reflex", email: "reflex@localhost" },
  });
  console.log(`committed: ${msg}`);

  // 6. open PR
  const title = `Refresh agent context from ${insight.session_count} Reflex-judged session${insight.session_count === 1 ? "" : "s"}`;
  const body2 = prBody(insight, action, target);
  let prUrl, prNum;
  try {
    const pr = await gh("POST", `/repos/${remote.owner}/${remote.repo}/pulls`, {
      head: branch, base: defaultBranch, title, body: body2, draft: false,
    });
    prUrl = pr.html_url; prNum = pr.number;
  } catch (e) {
    if (e.status !== 422) throw e;
    const list = await gh("GET", `/repos/${remote.owner}/${remote.repo}/pulls?head=${encodeURIComponent(remote.owner + ":" + branch)}&state=open`);
    if (!list.length) throw e;
    prUrl = list[0].html_url; prNum = list[0].number;
    await gh("PATCH", `/repos/${remote.owner}/${remote.repo}/pulls/${prNum}`, { title, body: body2 });
  }

  console.log("\n========================================");
  console.log(`✓ PR #${prNum}: ${prUrl}`);
  console.log(`  branch: ${branch}`);
  console.log(`  target: ${target}`);
  console.log(`  action: ${action}`);
  console.log("========================================\n");
}

main().catch((e) => { console.error("error:", e.message); if (e.body) console.error("body:", JSON.stringify(e.body, null, 2)); process.exit(1); });
