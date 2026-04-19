// GitHub integration — opens a PR against a user's repo that updates their
// agent-context file (AGENTS.md / CLAUDE.md / etc.) with Reflex's distilled
// cross-session insight. Uses raw GitHub REST via fetch (no Octokit) to
// avoid ESM/CJS interop headaches inside electron-vite.
//
// Auth: user pastes a GitHub Personal Access Token (classic, `repo` scope)
// into ~/.reflex/config.json as `github_token`.

import fs from "node:fs";
import path from "node:path";

import type { RepoInsight, SessionJudgment } from "@shared/judge";
import { loadConfig, tokenForRepo } from "./config";

// Files we'll update (in priority order — first existing one wins).
// If none exist we create AGENTS.md at the repo root.
const CONTEXT_FILE_CANDIDATES = [
  "AGENTS.md",
  "CLAUDE.md",
  ".github/copilot-instructions.md",
  ".cursor/rules",
  "CODEX.md",
  "AGENT.md",
];

const REFLEX_BLOCK_START = "<!-- reflex:context:start -->";
const REFLEX_BLOCK_END = "<!-- reflex:context:end -->";

const GH = "https://api.github.com";
const UA = "reflex-capture/0.1";

export interface OpenPrResult {
  pr_url: string;
  pr_number: number;
  branch: string;
  target_file: string;
  action: "created" | "updated" | "replaced-reflex-block";
}

/**
 * Detect GitHub owner/repo by walking up from `localPath` until we find a
 * `.git/config` (so passing a subdirectory like `foo/electron` still
 * resolves to `foo`'s repo). Returns the first origin URL that parses as
 * a github remote.
 */
export function detectGitHubRemote(
  localPath: string,
): { owner: string; repo: string } | null {
  const root = findGitRoot(localPath);
  if (!root) return null;
  try {
    const body = fs.readFileSync(path.join(root, ".git", "config"), "utf8");
    const m = body.match(/\[remote "origin"\][\s\S]*?url\s*=\s*([^\s]+)/);
    if (!m) return null;
    return parseGitHubRemoteUrl(m[1]);
  } catch {
    return null;
  }
}

/** Walk up from `start` looking for a directory that contains `.git/config`. */
export function findGitRoot(start: string): string | null {
  let cur = path.resolve(start);
  // Guard against infinite loops on filesystems where parent(/) === /.
  for (let i = 0; i < 40; i++) {
    const cfg = path.join(cur, ".git", "config");
    try {
      if (fs.statSync(cfg).isFile()) return cur;
    } catch {
      // continue walking up
    }
    const parent = path.dirname(cur);
    if (parent === cur) return null;
    cur = parent;
  }
  return null;
}

export function parseGitHubRemoteUrl(
  url: string,
): { owner: string; repo: string } | null {
  let m = url.match(/github\.com[:/]{1}([^/]+)\/([^/\s]+?)(?:\.git)?$/);
  if (m) return { owner: m[1], repo: m[2] };
  m = url.match(/^git@github\.com:([^/]+)\/([^/\s]+?)(?:\.git)?$/);
  if (m) return { owner: m[1], repo: m[2] };
  return null;
}

// ------------------------- REST helpers ------------------------------------

/** Resolve a token. With no repo context, returns the default; with an
 *  `owner/repo` context, prefers a per-repo override. */
function token(ctx?: { owner?: string; repo?: string }): string {
  const tok = tokenForRepo(ctx?.owner, ctx?.repo, loadConfig());
  if (!tok) {
    const scope =
      ctx?.owner && ctx?.repo ? ` for ${ctx.owner}/${ctx.repo}` : "";
    throw new Error(
      `no GitHub token configured${scope} — open Settings and paste a PAT`,
    );
  }
  return tok;
}

interface GhErr {
  status: number;
  url: string;
  message: string;
  body?: unknown;
}

async function gh<T = unknown>(
  method: "GET" | "POST" | "PUT" | "PATCH" | "DELETE",
  url: string,
  body?: unknown,
): Promise<T> {
  // Pick the right PAT based on the owner/repo embedded in the path.
  const ctx = extractRepoCtxFromUrl(url);
  const res = await fetch(`${GH}${url}`, {
    method,
    headers: {
      accept: "application/vnd.github+json",
      "x-github-api-version": "2022-11-28",
      authorization: `Bearer ${token(ctx)}`,
      "user-agent": UA,
      ...(body ? { "content-type": "application/json" } : {}),
    },
    body: body ? JSON.stringify(body) : undefined,
  });
  if (res.status === 204) return undefined as T;
  const payload = (await res.json().catch(() => ({}))) as Record<
    string,
    unknown
  >;
  if (!res.ok) {
    const err: GhErr = {
      status: res.status,
      url,
      message:
        (payload.message as string) ??
        `github ${method} ${url} failed: ${res.status} ${res.statusText}`,
      body: payload,
    };
    const e = new Error(err.message) as Error & GhErr;
    e.status = err.status;
    e.url = err.url;
    e.body = err.body;
    throw e;
  }
  return payload as T;
}

/** Extract `{ owner, repo }` from a GitHub REST path. Returns undefined
 *  for endpoints that aren't repo-scoped (/user, /user/repos, …). */
function extractRepoCtxFromUrl(
  url: string,
): { owner: string; repo: string } | undefined {
  const m = url.match(/^\/repos\/([^/]+)\/([^/?#]+)/);
  if (!m) return undefined;
  return { owner: m[1], repo: m[2] };
}

// ------------------------- Main action -------------------------------------

export async function openPrForInsight(params: {
  localRepoPath: string;
  insight: RepoInsight;
}): Promise<OpenPrResult> {
  const { localRepoPath, insight } = params;

  const remote = detectGitHubRemote(localRepoPath);
  if (!remote) {
    throw new Error(
      `could not detect a GitHub origin in ${localRepoPath}/.git/config — is this a GitHub repo?`,
    );
  }
  const { owner, repo } = remote;

  // 1. Default branch
  const repoInfo = await gh<{ default_branch: string }>(
    "GET",
    `/repos/${owner}/${repo}`,
  );
  const defaultBranch = repoInfo.default_branch;

  // 2. Find existing context file (check each candidate)
  let target: string | null = null;
  let existingSha: string | undefined;
  let existingContent = "";
  for (const candidate of CONTEXT_FILE_CANDIDATES) {
    try {
      const file = await gh<{
        type: string;
        sha: string;
        encoding: string;
        content: string;
      }>(
        "GET",
        `/repos/${owner}/${repo}/contents/${encodeURIComponent(candidate)}?ref=${encodeURIComponent(defaultBranch)}`,
      );
      if (file.type === "file") {
        target = candidate;
        existingSha = file.sha;
        if (file.content && file.encoding === "base64") {
          existingContent = Buffer.from(file.content, "base64").toString("utf8");
        }
        break;
      }
    } catch (e) {
      const err = e as GhErr;
      if (err.status !== 404) throw e;
      // 404 → file doesn't exist, try next candidate
    }
  }
  if (!target) target = "AGENTS.md";

  // 3. Compose new body
  const { body: newBody, action } = mergeContextBlock(existingContent, insight);

  // 4. Ensure the reflex branch exists, off the default branch
  const branch = "reflex/agent-context";

  const baseRef = await gh<{ object: { sha: string } }>(
    "GET",
    `/repos/${owner}/${repo}/git/refs/heads/${encodeURIComponent(defaultBranch)}`,
  );
  const baseSha = baseRef.object.sha;

  let branchExists = true;
  try {
    await gh(
      "GET",
      `/repos/${owner}/${repo}/git/refs/heads/${encodeURIComponent(branch)}`,
    );
  } catch (e) {
    const err = e as GhErr;
    if (err.status === 404) branchExists = false;
    else throw e;
  }

  if (!branchExists) {
    await gh("POST", `/repos/${owner}/${repo}/git/refs`, {
      ref: `refs/heads/${branch}`,
      sha: baseSha,
    });
  }

  // The branch may already have a previous commit modifying `target`. We
  // need the file's current sha on the branch (not the default branch) so
  // the PUT succeeds. Re-fetch on the reflex branch.
  let branchFileSha = existingSha;
  try {
    const onBranch = await gh<{ sha: string }>(
      "GET",
      `/repos/${owner}/${repo}/contents/${encodeURIComponent(target)}?ref=${encodeURIComponent(branch)}`,
    );
    branchFileSha = onBranch.sha;
  } catch (e) {
    const err = e as GhErr;
    if (err.status !== 404) throw e;
    // file doesn't exist on branch yet — leave branchFileSha as-is (possibly undefined)
  }

  // 5. Commit via contents API (handles both create + update)
  const commitMsg = `chore(agents): refresh Reflex-derived context (${insight.session_count} sessions, avg ${insight.score_avg}/100)`;
  await gh("PUT", `/repos/${owner}/${repo}/contents/${encodeURIComponent(target)}`, {
    branch,
    message: commitMsg,
    content: Buffer.from(newBody, "utf8").toString("base64"),
    sha: branchFileSha,
    committer: { name: "Reflex", email: "reflex@localhost" },
    author: { name: "Reflex", email: "reflex@localhost" },
  });

  // 6. Open PR (or update existing)
  const prTitle = `Refresh agent context from ${insight.session_count} Reflex-judged session${insight.session_count === 1 ? "" : "s"}`;
  const prBody = buildPrBody(insight, action, target);

  let prUrl: string;
  let prNumber: number;

  try {
    const pr = await gh<{ html_url: string; number: number }>(
      "POST",
      `/repos/${owner}/${repo}/pulls`,
      {
        head: branch,
        base: defaultBranch,
        title: prTitle,
        body: prBody,
        draft: false,
      },
    );
    prUrl = pr.html_url;
    prNumber = pr.number;
  } catch (e) {
    const err = e as GhErr;
    // 422 = PR already exists on this branch
    if (err.status !== 422) throw e;
    const existing = await gh<
      Array<{ html_url: string; number: number }>
    >(
      "GET",
      `/repos/${owner}/${repo}/pulls?head=${encodeURIComponent(`${owner}:${branch}`)}&state=open`,
    );
    if (!existing.length) throw e;
    prUrl = existing[0].html_url;
    prNumber = existing[0].number;
    await gh("PATCH", `/repos/${owner}/${repo}/pulls/${prNumber}`, {
      title: prTitle,
      body: prBody,
    });
  }

  return {
    pr_url: prUrl,
    pr_number: prNumber,
    branch,
    target_file: target,
    action,
  };
}

// ------------------------- Body merging -----------------------------------

function mergeContextBlock(
  existing: string,
  insight: RepoInsight,
): { body: string; action: OpenPrResult["action"] } {
  const block = renderReflexBlock(insight);

  if (!existing.trim()) {
    return { body: block.trimStart(), action: "created" };
  }

  if (
    existing.includes(REFLEX_BLOCK_START) &&
    existing.includes(REFLEX_BLOCK_END)
  ) {
    const before = existing.slice(0, existing.indexOf(REFLEX_BLOCK_START));
    const afterIdx =
      existing.indexOf(REFLEX_BLOCK_END) + REFLEX_BLOCK_END.length;
    const after = existing.slice(afterIdx);
    const merged = before.replace(/\s+$/, "") + "\n\n" + block + after;
    return { body: merged, action: "replaced-reflex-block" };
  }

  const needsSpacer = !existing.endsWith("\n");
  const merged = existing + (needsSpacer ? "\n\n" : "\n") + block;
  return { body: merged, action: "updated" };
}

function renderReflexBlock(insight: RepoInsight): string {
  const trimmedMd = insight.context_md.trim();
  const meta = [
    `> Refreshed ${new Date(insight.evaluated_at).toISOString().slice(0, 19)}Z`,
    `> Based on ${insight.session_count} Reflex-judged session${insight.session_count === 1 ? "" : "s"}, avg score ${insight.score_avg}/100`,
    `> Judge: ${insight.judge}`,
  ].join("\n");

  return [
    REFLEX_BLOCK_START,
    "",
    meta,
    "",
    trimmedMd,
    "",
    REFLEX_BLOCK_END,
    "",
  ].join("\n");
}

function buildPrBody(
  insight: RepoInsight,
  action: OpenPrResult["action"],
  target: string,
): string {
  const actionText = {
    created: `Created \`${target}\` with the initial Reflex-derived context block.`,
    updated: `Appended a Reflex-derived context block to \`${target}\`.`,
    "replaced-reflex-block": `Refreshed the existing Reflex block inside \`${target}\`.`,
  }[action];

  const lines: string[] = [
    `**Summary**: ${insight.summary}`,
    "",
    actionText,
    "",
    `This PR was opened by Reflex after analyzing **${insight.session_count}** past AI-agent session(s) in this repo (average score **${insight.score_avg}/100**, evaluated with \`${insight.judge}\`).`,
    "",
  ];

  if (insight.recurring_agent_patterns.length) {
    lines.push(`### Recurring agent patterns (across sessions)`);
    for (const p of insight.recurring_agent_patterns.slice(0, 8)) {
      lines.push(`- ${p}`);
    }
    lines.push("");
  }

  if (insight.recurring_user_patterns.length) {
    lines.push(`### Recurring user patterns`);
    for (const p of insight.recurring_user_patterns.slice(0, 8)) {
      lines.push(`- ${p}`);
    }
    lines.push("");
  }

  if (insight.actionable_advice.length) {
    lines.push(`### Actionable advice baked into the context`);
    for (const a of insight.actionable_advice.slice(0, 10)) {
      lines.push(`- ${a}`);
    }
    lines.push("");
  }

  lines.push(
    "---",
    "<sub>The block between `<!-- reflex:context:start -->` and `<!-- reflex:context:end -->` will be refreshed in place on future PRs. Edit outside that block freely.</sub>",
  );
  return lines.join("\n");
}

// ------------------------- Single-session PR -----------------------------
//
// Opens a PR derived from a single SessionJudgment (rather than a
// cross-session RepoInsight). We synthesize a RepoInsight-shaped object
// from the judgment so we can reuse the merge+PR pipeline verbatim, and
// so the sentinel block in the target file has the same structure whether
// the source was 1 session or 20.

export async function openPrForJudgment(params: {
  localRepoPath: string;
  judgment: SessionJudgment;
}): Promise<OpenPrResult> {
  const insight = insightFromJudgment(params.judgment, params.localRepoPath);
  return openPrForInsight({ localRepoPath: params.localRepoPath, insight });
}

function insightFromJudgment(
  j: SessionJudgment,
  localRepoPath: string,
): RepoInsight {
  const recurringIssues = j.issues.filter((i) => i.recurring);
  // If nothing is explicitly flagged recurring in a single-session judge,
  // we still surface the non-low-severity issues so the PR has substance.
  const issues =
    recurringIssues.length > 0
      ? recurringIssues
      : j.issues.filter((i) => i.severity !== "low");

  return {
    repo: j.repo ?? localRepoPath,
    session_count: 1,
    score_avg: j.score,
    judge: j.judge,
    evaluated_at: j.judged_at,
    summary: j.summary,
    recurring_issues: issues,
    recurring_user_patterns: j.user_patterns,
    recurring_agent_patterns: j.agent_patterns,
    actionable_advice: j.actionable_advice,
    context_md: buildSessionContextMd(j, localRepoPath),
  };
}

/**
 * Render a compact, agent-readable markdown block derived from one
 * SessionJudgment. Kept short and specific — this is the body dropped
 * into the Reflex sentinel block of the target context file.
 */
// ------------------------- Team sync: shared judgments --------------------
//
// Mechanism: each teammate commits their own judgments into the repo under
// `.reflex/sessions/<judgment-id>.json`. When any Reflex client opens the
// repo, we pull the directory listing and render every teammate's
// judgments alongside our local ones. The repo itself is the team DB.

/** Current authenticated user. Used when stamping judgments with author. */
export async function currentGitHubUser(): Promise<{
  login: string;
  avatar_url: string;
} | null> {
  try {
    return await gh<{ login: string; avatar_url: string }>("GET", "/user");
  } catch {
    return null;
  }
}

export interface PushedJudgmentResult {
  committed_path: string;
  sha: string;
  html_url: string;
}

/**
 * Commit a compact summary of a SessionJudgment directly to the default
 * branch at `.reflex/sessions/<source>-<short>.json`. No PR — these are
 * lightweight per-session entries that a team accumulates over time.
 */
export async function pushJudgmentToRepo(params: {
  localRepoPath: string;
  judgment: SessionJudgment;
}): Promise<PushedJudgmentResult> {
  const { localRepoPath, judgment } = params;

  const remote = detectGitHubRemote(localRepoPath);
  if (!remote) throw new Error(`no github origin in ${localRepoPath}`);
  const { owner, repo } = remote;

  const repoInfo = await gh<{ default_branch: string }>(
    "GET",
    `/repos/${owner}/${repo}`,
  );
  const defaultBranch = repoInfo.default_branch;

  // Resolve current GitHub user to stamp the author field.
  const me = await currentGitHubUser();

  // Stable, short, human-scannable filename.
  const shortId = `${judgment.source}-${judgment.session_id.slice(0, 14)}`;
  const path = `.reflex/sessions/${shortId}.json`;

  // Strip unnecessary weight from the raw blob before committing.
  const payload = {
    v: 1,
    session_id: judgment.session_id,
    source: judgment.source,
    author_login: me?.login ?? null,
    author_avatar: me?.avatar_url ?? null,
    judge: judgment.judge,
    judged_at: judgment.judged_at,
    score: judgment.score,
    summary: judgment.summary,
    repo: judgment.repo ?? localRepoPath,
    issues: judgment.issues,
    strengths: judgment.strengths,
    user_patterns: judgment.user_patterns,
    agent_patterns: judgment.agent_patterns,
    actionable_advice: judgment.actionable_advice,
    tokens: judgment.tokens,
  };
  const body = JSON.stringify(payload, null, 2);

  // If the file exists, fetch its sha so we can update rather than create.
  let existingSha: string | undefined;
  try {
    const existing = await gh<{ sha: string }>(
      "GET",
      `/repos/${owner}/${repo}/contents/${encodeURIComponent(path)}?ref=${encodeURIComponent(defaultBranch)}`,
    );
    existingSha = existing.sha;
  } catch (e) {
    const err = e as GhErr;
    if (err.status !== 404) throw e;
  }

  const msg = `chore(reflex): share session judgment ${shortId} (${judgment.score}/100)`;
  const res = await gh<{
    content: { sha: string; html_url: string };
    commit: { html_url: string };
  }>("PUT", `/repos/${owner}/${repo}/contents/${encodeURIComponent(path)}`, {
    branch: defaultBranch,
    message: msg,
    content: Buffer.from(body, "utf8").toString("base64"),
    sha: existingSha,
    committer: { name: "Reflex", email: "reflex@localhost" },
    author: me
      ? {
          name: me.login,
          email: `${me.login}@users.noreply.github.com`,
        }
      : { name: "Reflex", email: "reflex@localhost" },
  });
  return {
    committed_path: path,
    sha: res.content.sha,
    html_url: res.content.html_url ?? res.commit.html_url,
  };
}

export interface TeamSharedJudgment {
  path: string;
  session_id: string;
  source: string;
  author_login: string | null;
  author_avatar: string | null;
  judge: string;
  judged_at: string;
  score: number;
  summary: string;
  repo: string | null;
  issues: SessionJudgment["issues"];
  user_patterns: string[];
  agent_patterns: string[];
  actionable_advice: string[];
}

// --- Shared playgrounds (per-session exploration chats) -------------------

export interface SharedPlaygroundMessage {
  role: "user" | "assistant";
  content: string;
  ts: string;
  model?: string | null;
  tokens_in?: number | null;
  tokens_out?: number | null;
  author_login?: string | null;
  author_avatar?: string | null;
}

export async function pushPlaygroundToRepo(params: {
  localRepoPath: string;
  sessionId: string;
  source: string;
  messages: SharedPlaygroundMessage[];
}): Promise<PushedJudgmentResult> {
  const { localRepoPath, sessionId, source, messages } = params;
  const remote = detectGitHubRemote(localRepoPath);
  if (!remote) throw new Error(`no github origin in ${localRepoPath}`);
  const { owner, repo } = remote;

  const repoInfo = await gh<{ default_branch: string }>(
    "GET",
    `/repos/${owner}/${repo}`,
  );
  const defaultBranch = repoInfo.default_branch;

  const me = await currentGitHubUser();

  const shortId = `${source}-${sessionId.slice(0, 14)}`;
  const path = `.reflex/playgrounds/${shortId}.jsonl`;

  // Build JSONL with an author-stamped _meta line first so fetchers can
  // identify the uploader without heuristics on every message.
  const metaLine = JSON.stringify({
    _meta: true,
    v: 1,
    session_id: sessionId,
    source,
    author_login: me?.login ?? null,
    author_avatar: me?.avatar_url ?? null,
    updated_at: new Date().toISOString(),
  });
  const msgLines = messages.map((m) =>
    JSON.stringify({
      role: m.role,
      content: m.content,
      ts: m.ts,
      model: m.model ?? null,
      tokens_in: m.tokens_in ?? null,
      tokens_out: m.tokens_out ?? null,
    }),
  );
  const body = [metaLine, ...msgLines].join("\n") + "\n";

  let existingSha: string | undefined;
  try {
    const existing = await gh<{ sha: string }>(
      "GET",
      `/repos/${owner}/${repo}/contents/${encodeURIComponent(path)}?ref=${encodeURIComponent(defaultBranch)}`,
    );
    existingSha = existing.sha;
  } catch (e) {
    const err = e as GhErr;
    if (err.status !== 404) throw e;
  }

  const msg = `chore(reflex): share playground for ${shortId} (${messages.length} msgs)`;
  const res = await gh<{
    content: { sha: string; html_url: string };
    commit: { html_url: string };
  }>("PUT", `/repos/${owner}/${repo}/contents/${encodeURIComponent(path)}`, {
    branch: defaultBranch,
    message: msg,
    content: Buffer.from(body, "utf8").toString("base64"),
    sha: existingSha,
    committer: { name: "Reflex", email: "reflex@localhost" },
    author: me
      ? {
          name: me.login,
          email: `${me.login}@users.noreply.github.com`,
        }
      : { name: "Reflex", email: "reflex@localhost" },
  });
  return {
    committed_path: path,
    sha: res.content.sha,
    html_url: res.content.html_url ?? res.commit.html_url,
  };
}

export interface TeamSharedPlayground {
  path: string;
  session_id: string;
  source: string;
  author_login: string | null;
  author_avatar: string | null;
  updated_at: string;
  messages: SharedPlaygroundMessage[];
}

export async function fetchTeamPlaygrounds(
  localRepoPath: string,
): Promise<TeamSharedPlayground[]> {
  const remote = detectGitHubRemote(localRepoPath);
  if (!remote) throw new Error(`no github origin in ${localRepoPath}`);
  const { owner, repo } = remote;
  const repoToken = token({ owner, repo });

  const repoInfo = await gh<{ default_branch: string }>(
    "GET",
    `/repos/${owner}/${repo}`,
  );
  const defaultBranch = repoInfo.default_branch;

  let dir: Array<{
    name: string;
    path: string;
    type: string;
    download_url: string | null;
  }>;
  try {
    dir = await gh(
      "GET",
      `/repos/${owner}/${repo}/contents/${encodeURIComponent(".reflex/playgrounds")}?ref=${encodeURIComponent(defaultBranch)}`,
    );
  } catch (e) {
    const err = e as GhErr;
    if (err.status === 404) return [];
    throw e;
  }
  if (!Array.isArray(dir)) return [];

  const files = dir.filter((f) => f.type === "file" && f.name.endsWith(".jsonl"));
  const slice = files.slice(0, 40);
  const out: TeamSharedPlayground[] = [];
  await Promise.all(
    slice.map(async (f) => {
      if (!f.download_url) return;
      try {
        const res = await fetch(f.download_url, {
          headers: {
            authorization: `Bearer ${repoToken}`,
            "user-agent": UA,
          },
        });
        if (!res.ok) return;
        const text = await res.text();
        const lines = text.split(/\r?\n/).filter(Boolean);
        let meta: {
          session_id?: string;
          source?: string;
          author_login?: string;
          author_avatar?: string;
          updated_at?: string;
        } = {};
        const msgs: SharedPlaygroundMessage[] = [];
        for (const line of lines) {
          let obj: Record<string, unknown>;
          try {
            obj = JSON.parse(line);
          } catch {
            continue;
          }
          if (obj._meta === true) {
            meta = obj as typeof meta;
            continue;
          }
          if (obj.role === "user" || obj.role === "assistant") {
            msgs.push({
              role: obj.role as "user" | "assistant",
              content: String(obj.content ?? ""),
              ts: String(obj.ts ?? ""),
              model: (obj.model as string | null) ?? null,
              tokens_in: (obj.tokens_in as number | null) ?? null,
              tokens_out: (obj.tokens_out as number | null) ?? null,
            });
          }
        }
        out.push({
          path: f.path,
          session_id: meta.session_id ?? "",
          source: meta.source ?? "",
          author_login: meta.author_login ?? null,
          author_avatar: meta.author_avatar ?? null,
          updated_at: meta.updated_at ?? "",
          messages: msgs,
        });
      } catch {
        // skip malformed
      }
    }),
  );
  out.sort((a, b) => b.updated_at.localeCompare(a.updated_at));
  return out;
}

/** List all shared judgments committed to `.reflex/sessions/` in the repo. */
export async function fetchTeamJudgments(
  localRepoPath: string,
): Promise<TeamSharedJudgment[]> {
  const remote = detectGitHubRemote(localRepoPath);
  if (!remote) throw new Error(`no github origin in ${localRepoPath}`);
  const { owner, repo } = remote;
  const repoToken = token({ owner, repo });

  const repoInfo = await gh<{ default_branch: string }>(
    "GET",
    `/repos/${owner}/${repo}`,
  );
  const defaultBranch = repoInfo.default_branch;

  let dir: Array<{
    name: string;
    path: string;
    type: string;
    download_url: string | null;
  }>;
  try {
    dir = await gh("GET",
      `/repos/${owner}/${repo}/contents/${encodeURIComponent(".reflex/sessions")}?ref=${encodeURIComponent(defaultBranch)}`,
    );
  } catch (e) {
    const err = e as GhErr;
    if (err.status === 404) return [];
    throw e;
  }
  if (!Array.isArray(dir)) return [];

  const files = dir.filter((f) => f.type === "file" && f.name.endsWith(".json"));
  // Fetch in parallel — cap at 40 to protect rate limits.
  const slice = files.slice(0, 40);
  const out: TeamSharedJudgment[] = [];
  await Promise.all(
    slice.map(async (f) => {
      try {
        if (!f.download_url) return;
        const res = await fetch(f.download_url, {
          headers: {
            authorization: `Bearer ${repoToken}`,
            "user-agent": UA,
          },
        });
        if (!res.ok) return;
        const j = (await res.json()) as Partial<TeamSharedJudgment> & {
          author_login?: string;
        };
        out.push({
          path: f.path,
          session_id: String(j.session_id ?? ""),
          source: String(j.source ?? ""),
          author_login: (j.author_login as string | null) ?? null,
          author_avatar: (j.author_avatar as string | null) ?? null,
          judge: String(j.judge ?? ""),
          judged_at: String(j.judged_at ?? ""),
          score: Number(j.score ?? 0),
          summary: String(j.summary ?? ""),
          repo: (j.repo as string | null) ?? null,
          issues: Array.isArray(j.issues) ? (j.issues as SessionJudgment["issues"]) : [],
          user_patterns: Array.isArray(j.user_patterns) ? (j.user_patterns as string[]) : [],
          agent_patterns: Array.isArray(j.agent_patterns) ? (j.agent_patterns as string[]) : [],
          actionable_advice: Array.isArray(j.actionable_advice)
            ? (j.actionable_advice as string[])
            : [],
        });
      } catch {
        // skip malformed
      }
    }),
  );
  out.sort((a, b) => b.judged_at.localeCompare(a.judged_at));
  return out;
}

// ------------------------- Team sync helpers -----------------------------
//
// The GitHub repo itself is the team's sync channel. These helpers pull
// down team state so the UI can show what *other* team members have
// shipped into AGENTS.md.

export interface TeamContextFile {
  /** Which context file is currently present in the repo's default branch. */
  path: string;
  /** Raw markdown content. */
  content: string;
  /** The text between the reflex sentinels, if any. */
  reflex_block: string | null;
  /** Commit sha of the file on default branch. */
  sha: string;
  /** Default branch name. */
  default_branch: string;
}

/** Fetch the current agent-context file from the repo's default branch.
 *  Returns null if no context file exists yet. */
export async function fetchRepoContext(
  localRepoPath: string,
): Promise<TeamContextFile | null> {
  const remote = detectGitHubRemote(localRepoPath);
  if (!remote) throw new Error(`no github origin in ${localRepoPath}`);
  const repoInfo = await gh<{ default_branch: string }>(
    "GET",
    `/repos/${remote.owner}/${remote.repo}`,
  );
  const defaultBranch = repoInfo.default_branch;

  for (const candidate of CONTEXT_FILE_CANDIDATES) {
    try {
      const f = await gh<{
        type: string;
        sha: string;
        encoding: string;
        content: string;
      }>(
        "GET",
        `/repos/${remote.owner}/${remote.repo}/contents/${encodeURIComponent(candidate)}?ref=${encodeURIComponent(defaultBranch)}`,
      );
      if (f.type !== "file") continue;
      const content =
        f.content && f.encoding === "base64"
          ? Buffer.from(f.content, "base64").toString("utf8")
          : "";
      const reflex_block = extractReflexBlock(content);
      return {
        path: candidate,
        content,
        reflex_block,
        sha: f.sha,
        default_branch: defaultBranch,
      };
    } catch (e) {
      const err = e as GhErr;
      if (err.status !== 404) throw e;
    }
  }
  return null;
}

function extractReflexBlock(md: string): string | null {
  const i = md.indexOf(REFLEX_BLOCK_START);
  const j = md.indexOf(REFLEX_BLOCK_END);
  if (i < 0 || j < 0 || j <= i) return null;
  return md.slice(i + REFLEX_BLOCK_START.length, j).trim();
}

export interface TeamHistoryEntry {
  sha: string;
  short_sha: string;
  message: string;
  /** First line of the message. */
  headline: string;
  author_login: string | null;
  author_name: string;
  author_avatar: string | null;
  authored_at: string;
  html_url: string;
  /** Filename this commit touched. */
  path: string;
}

/** Commits that have touched any of the candidate context files, newest first. */
export async function fetchRepoContextHistory(
  localRepoPath: string,
  limit = 30,
): Promise<TeamHistoryEntry[]> {
  const remote = detectGitHubRemote(localRepoPath);
  if (!remote) throw new Error(`no github origin in ${localRepoPath}`);

  const seen = new Set<string>();
  const out: TeamHistoryEntry[] = [];
  for (const candidate of CONTEXT_FILE_CANDIDATES) {
    try {
      const commits = await gh<
        Array<{
          sha: string;
          html_url: string;
          commit: {
            message: string;
            author: { name: string; date: string } | null;
          };
          author: { login: string; avatar_url: string } | null;
        }>
      >(
        "GET",
        `/repos/${remote.owner}/${remote.repo}/commits?path=${encodeURIComponent(candidate)}&per_page=${limit}`,
      );
      for (const c of commits) {
        if (seen.has(c.sha)) continue;
        seen.add(c.sha);
        const msg = c.commit.message ?? "";
        out.push({
          sha: c.sha,
          short_sha: c.sha.slice(0, 7),
          message: msg,
          headline: msg.split("\n")[0],
          author_login: c.author?.login ?? null,
          author_name: c.commit.author?.name ?? c.author?.login ?? "unknown",
          author_avatar: c.author?.avatar_url ?? null,
          authored_at: c.commit.author?.date ?? "",
          html_url: c.html_url,
          path: candidate,
        });
      }
    } catch (e) {
      const err = e as GhErr;
      if (err.status !== 404 && err.status !== 409) throw e;
    }
  }
  // Sort newest first, cap
  out.sort((a, b) => b.authored_at.localeCompare(a.authored_at));
  return out.slice(0, limit);
}

export interface TeamOpenPr {
  number: number;
  title: string;
  html_url: string;
  author_login: string | null;
  author_avatar: string | null;
  branch: string;
  updated_at: string;
  draft: boolean;
}

/** Open PRs that look like Reflex refresh PRs (either on the reflex branch
 *  or whose title starts with our marker). */
export async function listOpenReflexPrs(
  localRepoPath: string,
): Promise<TeamOpenPr[]> {
  const remote = detectGitHubRemote(localRepoPath);
  if (!remote) throw new Error(`no github origin in ${localRepoPath}`);
  const prs = await gh<
    Array<{
      number: number;
      title: string;
      html_url: string;
      head: { ref: string };
      user: { login: string; avatar_url: string } | null;
      updated_at: string;
      draft: boolean;
    }>
  >(
    "GET",
    `/repos/${remote.owner}/${remote.repo}/pulls?state=open&per_page=50`,
  );
  return prs
    .filter(
      (p) =>
        p.head.ref.startsWith("reflex/") ||
        /reflex-derived context|Reflex-judged/.test(p.title),
    )
    .map((p) => ({
      number: p.number,
      title: p.title,
      html_url: p.html_url,
      author_login: p.user?.login ?? null,
      author_avatar: p.user?.avatar_url ?? null,
      branch: p.head.ref,
      updated_at: p.updated_at,
      draft: p.draft,
    }));
}

function buildSessionContextMd(
  j: SessionJudgment,
  localRepoPath: string,
): string {
  const lines: string[] = [
    `# Agent context — notes from a past session`,
    "",
    `**Summary**: ${j.summary.trim()}`,
    "",
  ];

  if (j.agent_patterns.length) {
    lines.push("## Avoid (agent patterns seen in a past session)", "");
    for (const p of j.agent_patterns) lines.push(`- ${p}`);
    lines.push("");
  }

  if (j.user_patterns.length) {
    lines.push("## Note (user tendencies)", "");
    for (const p of j.user_patterns) lines.push(`- ${p}`);
    lines.push("");
  }

  const highIssues = j.issues.filter((i) => i.severity === "high");
  const medIssues = j.issues.filter((i) => i.severity === "med");
  if (highIssues.length || medIssues.length) {
    lines.push("## Specific issues from this session", "");
    for (const i of [...highIssues, ...medIssues]) {
      lines.push(
        `- **[${i.severity}${i.recurring ? " · recurring" : ""}]** ${i.title} — ${i.description}`,
      );
    }
    lines.push("");
  }

  if (j.actionable_advice.length) {
    lines.push("## Do this next time", "");
    for (const a of j.actionable_advice) lines.push(`- ${a}`);
    lines.push("");
  }

  lines.push(
    `<sub>Derived from one Reflex-judged session (score ${j.score}/100, ${j.judge}, ${j.judged_at.slice(0, 10)}). Repo: \`${localRepoPath}\`.</sub>`,
  );

  return lines.join("\n");
}
