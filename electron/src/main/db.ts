// SQLite store for captured flows. One DB file per user.
//
// The schema is intentionally denormalized so that a UI query for the
// flow list is a single SELECT over one table.

import Database from "better-sqlite3";
import path from "node:path";
import fs from "node:fs";
import { app } from "electron";

import type {
  CaptureEvent,
  FlowDetail,
  FlowSummary,
  SessionDetail,
  SessionEntry,
  SessionSummary,
} from "@shared/types";
import type { SessionRating, Turn } from "@shared/turn";
import type {
  RepoInsight,
  RepoSummary,
  SessionJudgment,
} from "@shared/judge";
import { normalizeEntries } from "./normalize";
import { rateSession } from "./rate";

let db: Database.Database | null = null;

export function open(): Database.Database {
  if (db) return db;
  const dir = path.join(app.getPath("userData"), "reflex");
  fs.mkdirSync(dir, { recursive: true });
  const file = path.join(dir, "flows.db");
  db = new Database(file);
  db.pragma("journal_mode = WAL");
  db.pragma("synchronous = NORMAL");
  db.exec(SCHEMA);
  return db;
}

const SCHEMA = `
CREATE TABLE IF NOT EXISTS flows (
  id TEXT PRIMARY KEY,
  ts TEXT NOT NULL,
  method TEXT NOT NULL,
  scheme TEXT NOT NULL,
  host TEXT NOT NULL,
  port INTEGER NOT NULL,
  path TEXT NOT NULL,
  url TEXT NOT NULL,
  http_version TEXT NOT NULL,
  status INTEGER,
  duration_ms INTEGER,
  request_bytes INTEGER NOT NULL DEFAULT 0,
  response_bytes INTEGER NOT NULL DEFAULT 0,
  request_headers TEXT NOT NULL DEFAULT '{}',
  response_headers TEXT NOT NULL DEFAULT '{}',
  request_body BLOB,
  response_body BLOB,
  request_truncated INTEGER NOT NULL DEFAULT 0,
  response_truncated INTEGER NOT NULL DEFAULT 0,
  error TEXT
);

CREATE INDEX IF NOT EXISTS idx_flows_ts ON flows(ts DESC);
CREATE INDEX IF NOT EXISTS idx_flows_host ON flows(host);

-- Session entries surfaced by non-network sources (opencode SQLite,
-- claude-code JSONL, codex JSONL). Keyed by (source, session_id,
-- entry_id) so re-emits on sidecar restart are idempotent.
CREATE TABLE IF NOT EXISTS session_entries (
  id TEXT PRIMARY KEY,
  source TEXT NOT NULL,
  session_id TEXT NOT NULL,
  entry_id TEXT NOT NULL,
  parent_entry_id TEXT,
  ts TEXT NOT NULL,
  kind TEXT NOT NULL,
  role TEXT,
  model TEXT,
  content TEXT NOT NULL,
  byte_len INTEGER NOT NULL DEFAULT 0,
  metadata TEXT NOT NULL DEFAULT '{}',
  UNIQUE (source, session_id, entry_id)
);

CREATE INDEX IF NOT EXISTS idx_sessions_ts ON session_entries(ts DESC);
CREATE INDEX IF NOT EXISTS idx_sessions_session ON session_entries(session_id, ts);
CREATE INDEX IF NOT EXISTS idx_sessions_source ON session_entries(source, ts DESC);

-- Cached per-session ratings (score + mistakes/retries/etc). Regenerated
-- whenever session_entries for that session changes; stored as JSON for
-- cheap schema evolution.
CREATE TABLE IF NOT EXISTS session_ratings (
  session_id   TEXT PRIMARY KEY,
  source       TEXT NOT NULL,
  score        INTEGER NOT NULL,
  evaluated_at TEXT NOT NULL,
  entry_count  INTEGER NOT NULL DEFAULT 0,
  rating       TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_session_ratings_score ON session_ratings(score ASC);

-- AI-judged verdicts per session. Separate from heuristic ratings so we
-- can have both: heuristic (fast, cheap, runs always) + AI (quality,
-- costs tokens, runs on demand).
CREATE TABLE IF NOT EXISTS session_judgments (
  session_id   TEXT PRIMARY KEY,
  source       TEXT NOT NULL,
  judge        TEXT NOT NULL,
  judged_at    TEXT NOT NULL,
  score        INTEGER NOT NULL,
  entry_count  INTEGER NOT NULL DEFAULT 0,
  verdict      TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_session_judgments_judged_at
  ON session_judgments(judged_at DESC);

-- Cached cross-session repo insights (the real product: the
-- distilled-across-sessions advice agents read on startup).
CREATE TABLE IF NOT EXISTS repo_insights (
  repo           TEXT PRIMARY KEY,
  session_count  INTEGER NOT NULL,
  score_avg      REAL NOT NULL,
  judge          TEXT NOT NULL,
  evaluated_at   TEXT NOT NULL,
  insight        TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_repo_insights_evaluated
  ON repo_insights(evaluated_at DESC);
`;

/** Result of applying an event to the DB.
 *  At most one of the id fields is set, telling the caller which renderer
 *  channel to push an updated summary to. */
export interface ApplyResult {
  flowId?: string;
  sessionId?: string;
}

/** Apply a single capture event to the DB. */
export function applyEvent(ev: CaptureEvent): ApplyResult {
  const d = open();
  switch (ev.type) {
    case "flow_start":
      d.prepare(
        `INSERT OR REPLACE INTO flows
         (id, ts, method, scheme, host, port, path, url, http_version)
         VALUES (@id, @ts, @method, @scheme, @host, @port, @path, @url, @http_version)`,
      ).run({
        id: ev.id,
        ts: ev.ts,
        method: ev.method,
        scheme: ev.scheme,
        host: ev.host,
        port: ev.port,
        path: ev.path,
        url: ev.url,
        http_version: ev.http_version,
      });
      return { flowId: ev.id };

    case "request_head":
      d.prepare(`UPDATE flows SET request_headers = ? WHERE id = ?`).run(
        JSON.stringify(ev.headers),
        ev.id,
      );
      return {};

    case "request_body": {
      const buf = Buffer.from(ev.body_b64, "base64");
      d.prepare(
        `UPDATE flows SET request_body = ?, request_bytes = ?, request_truncated = ? WHERE id = ?`,
      ).run(buf, ev.byte_len, ev.truncated ? 1 : 0, ev.id);
      return {};
    }

    case "response_head":
      d.prepare(
        `UPDATE flows SET status = ?, http_version = ?, response_headers = ? WHERE id = ?`,
      ).run(ev.status, ev.http_version, JSON.stringify(ev.headers), ev.id);
      return {};

    case "response_body": {
      const buf = Buffer.from(ev.body_b64, "base64");
      d.prepare(
        `UPDATE flows SET response_body = ?, response_bytes = ?, response_truncated = ? WHERE id = ?`,
      ).run(buf, ev.byte_len, ev.truncated ? 1 : 0, ev.id);
      return {};
    }

    case "flow_end":
      d.prepare(
        `UPDATE flows SET duration_ms = ?, error = ? WHERE id = ?`,
      ).run(ev.duration_ms, ev.error, ev.id);
      return { flowId: ev.id };

    case "session_entry": {
      // Idempotent: (source, session_id, entry_id) is unique.
      d.prepare(
        `INSERT OR IGNORE INTO session_entries
          (id, source, session_id, entry_id, parent_entry_id, ts, kind, role, model, content, byte_len, metadata)
         VALUES
          (@id, @source, @session_id, @entry_id, @parent_entry_id, @ts, @kind, @role, @model, @content, @byte_len, @metadata)`,
      ).run({
        id: ev.id,
        source: ev.source,
        session_id: ev.session_id,
        entry_id: ev.entry_id,
        parent_entry_id: ev.parent_entry_id,
        ts: ev.ts,
        kind: ev.kind,
        role: ev.role,
        model: ev.model,
        content: ev.content,
        byte_len: ev.byte_len,
        metadata: JSON.stringify(ev.metadata ?? {}),
      });
      return { sessionId: ev.session_id };
    }

    case "sidecar_ready":
      return {};

    default: {
      // Exhaustiveness check — every variant should be handled.
      const _exhaustive: never = ev;
      void _exhaustive;
      return {};
    }
  }
}

export function listFlows(limit = 200): FlowSummary[] {
  const d = open();
  const rows = d
    .prepare(
      `SELECT id, ts, method, host, path, url, status, duration_ms,
              request_bytes, response_bytes, error
       FROM flows
       ORDER BY ts DESC
       LIMIT ?`,
    )
    .all(limit) as FlowSummary[];
  return rows;
}

export function getFlow(id: string): FlowDetail | null {
  const d = open();
  const row = d
    .prepare(`SELECT * FROM flows WHERE id = ?`)
    .get(id) as Record<string, unknown> | undefined;
  if (!row) return null;

  const reqHeaders = safeJson(row.request_headers as string) ?? {};
  const resHeaders = safeJson(row.response_headers as string) ?? {};

  const reqBody = row.request_body as Buffer | null;
  const resBody = row.response_body as Buffer | null;

  return {
    id: row.id as string,
    ts: row.ts as string,
    method: row.method as string,
    scheme: row.scheme as string,
    host: row.host as string,
    port: row.port as number,
    path: row.path as string,
    url: row.url as string,
    http_version: row.http_version as string,
    status: (row.status as number | null) ?? null,
    duration_ms: (row.duration_ms as number | null) ?? null,
    request_bytes: (row.request_bytes as number) ?? 0,
    response_bytes: (row.response_bytes as number) ?? 0,
    request_headers: reqHeaders,
    response_headers: resHeaders,
    request_body: reqBody ? reqBody.toString("base64") : null,
    response_body: resBody ? resBody.toString("base64") : null,
    request_truncated: !!row.request_truncated,
    response_truncated: !!row.response_truncated,
    error: (row.error as string | null) ?? null,
  };
}

function safeJson(s: string | null | undefined): Record<string, string> | null {
  if (!s) return null;
  try {
    return JSON.parse(s);
  } catch {
    return null;
  }
}

/** Build a lightweight summary from the current DB row (for renderer push). */
export function summarize(id: string): FlowSummary | null {
  const d = open();
  const row = d
    .prepare(
      `SELECT id, ts, method, host, path, url, status, duration_ms,
              request_bytes, response_bytes, error
       FROM flows WHERE id = ?`,
    )
    .get(id) as FlowSummary | undefined;
  return row ?? null;
}

// --- Sessions queries --------------------------------------------------

export function listSessions(limit = 200): SessionSummary[] {
  const d = open();
  // Aggregate rows per session with min/max ts + count.
  const rows = d
    .prepare(
      `SELECT
          session_id,
          source,
          MIN(ts)             AS first_ts,
          MAX(ts)             AS last_ts,
          COUNT(*)            AS entry_count,
          (
            SELECT model FROM session_entries
            WHERE session_id = outer.session_id AND model IS NOT NULL
            ORDER BY ts DESC LIMIT 1
          ) AS model,
          (
            SELECT metadata FROM session_entries
            WHERE session_id = outer.session_id
            ORDER BY ts ASC LIMIT 1
          ) AS first_meta,
          (
            SELECT content FROM session_entries
            WHERE session_id = outer.session_id AND role = 'user' AND kind = 'message'
            ORDER BY ts ASC LIMIT 1
          ) AS first_user_text
        FROM session_entries AS outer
        GROUP BY session_id
        ORDER BY last_ts DESC
        LIMIT ?`,
    )
    .all(limit) as Array<{
    session_id: string;
    source: string;
    first_ts: string;
    last_ts: string;
    entry_count: number;
    model: string | null;
    first_meta: string | null;
    first_user_text: string | null;
  }>;

  return rows.map((r) => ({
    session_id: r.session_id,
    source: r.source,
    first_ts: r.first_ts,
    last_ts: r.last_ts,
    entry_count: r.entry_count,
    model: r.model,
    project: deriveProject(r.first_meta),
    first_user_text: r.first_user_text ? clip(r.first_user_text, 200) : null,
  }));
}

export function summarizeSession(sessionId: string): SessionSummary | null {
  const d = open();
  const row = d
    .prepare(
      `SELECT
          session_id,
          source,
          MIN(ts) AS first_ts,
          MAX(ts) AS last_ts,
          COUNT(*) AS entry_count,
          (
            SELECT model FROM session_entries
            WHERE session_id = ? AND model IS NOT NULL
            ORDER BY ts DESC LIMIT 1
          ) AS model,
          (
            SELECT metadata FROM session_entries
            WHERE session_id = ?
            ORDER BY ts ASC LIMIT 1
          ) AS first_meta,
          (
            SELECT content FROM session_entries
            WHERE session_id = ? AND role = 'user' AND kind = 'message'
            ORDER BY ts ASC LIMIT 1
          ) AS first_user_text
        FROM session_entries
        WHERE session_id = ?
        GROUP BY session_id`,
    )
    .get(sessionId, sessionId, sessionId, sessionId) as
    | {
        session_id: string;
        source: string;
        first_ts: string;
        last_ts: string;
        entry_count: number;
        model: string | null;
        first_meta: string | null;
        first_user_text: string | null;
      }
    | undefined;
  if (!row) return null;
  return {
    session_id: row.session_id,
    source: row.source,
    first_ts: row.first_ts,
    last_ts: row.last_ts,
    entry_count: row.entry_count,
    model: row.model,
    project: deriveProject(row.first_meta),
    first_user_text: row.first_user_text ? clip(row.first_user_text, 200) : null,
  };
}

export function getSession(sessionId: string): SessionDetail | null {
  const summary = summarizeSession(sessionId);
  if (!summary) return null;

  const entries = loadEntries(sessionId);
  return { ...summary, entries };
}

function loadEntries(sessionId: string): SessionEntry[] {
  const d = open();
  const rows = d
    .prepare(
      `SELECT id, source, session_id, entry_id, parent_entry_id, ts, kind,
              role, model, content, byte_len, metadata
        FROM session_entries
        WHERE session_id = ?
        ORDER BY ts ASC, id ASC`,
    )
    .all(sessionId) as Array<SessionEntry & { metadata: string }>;

  return rows.map((r) => ({
    id: r.id,
    source: r.source,
    session_id: r.session_id,
    entry_id: r.entry_id,
    parent_entry_id: r.parent_entry_id,
    ts: r.ts,
    kind: r.kind,
    role: r.role,
    model: r.model,
    content: r.content,
    byte_len: r.byte_len,
    metadata: safeJson(r.metadata as unknown as string) ?? {},
  }));
}

/** Normalized turn list for a session. */
export function getTurns(sessionId: string): Turn[] {
  return normalizeEntries(loadEntries(sessionId));
}

/** Compute (or recompute) a session's rating and cache it. */
export function computeRating(sessionId: string): SessionRating | null {
  const entries = loadEntries(sessionId);
  if (entries.length === 0) return null;
  const turns = normalizeEntries(entries);
  const rating = rateSession(turns);
  if (!rating) return null;

  const d = open();
  d.prepare(
    `INSERT OR REPLACE INTO session_ratings
      (session_id, source, score, evaluated_at, entry_count, rating)
     VALUES (?, ?, ?, ?, ?, ?)`,
  ).run(
    rating.session_id,
    rating.source,
    rating.score,
    rating.evaluated_at,
    entries.length,
    JSON.stringify(rating),
  );
  return rating;
}

/** Get a session's cached rating, or compute it on demand if stale/missing. */
export function getRating(sessionId: string): SessionRating | null {
  const d = open();
  const row = d
    .prepare(
      `SELECT session_id, source, score, evaluated_at, entry_count, rating
       FROM session_ratings WHERE session_id = ?`,
    )
    .get(sessionId) as
    | {
        session_id: string;
        source: string;
        score: number;
        evaluated_at: string;
        entry_count: number;
        rating: string;
      }
    | undefined;

  // Check staleness: compare cached entry_count to current.
  const current = d
    .prepare(
      `SELECT COUNT(*) AS n FROM session_entries WHERE session_id = ?`,
    )
    .get(sessionId) as { n: number } | undefined;
  const curCount = current?.n ?? 0;

  if (row && row.entry_count === curCount) {
    try {
      return JSON.parse(row.rating) as SessionRating;
    } catch {
      // fall through and recompute
    }
  }

  return computeRating(sessionId);
}

export function listRatings(limit = 200): SessionRating[] {
  const d = open();
  const rows = d
    .prepare(
      `SELECT session_id FROM session_ratings
        ORDER BY evaluated_at DESC LIMIT ?`,
    )
    .all(limit) as Array<{ session_id: string }>;
  const out: SessionRating[] = [];
  for (const r of rows) {
    const rating = getRating(r.session_id);
    if (rating) out.push(rating);
  }
  return out;
}

/** Ensure every session has a rating row; useful on initial UI load. */
export function computeRatingsForAllSessions(): number {
  const d = open();
  const rows = d
    .prepare(
      `SELECT DISTINCT session_id FROM session_entries`,
    )
    .all() as Array<{ session_id: string }>;
  let n = 0;
  for (const r of rows) {
    if (computeRating(r.session_id)) n++;
  }
  return n;
}

// --- Judgments --------------------------------------------------------

export function saveJudgment(j: SessionJudgment, entryCount: number): void {
  const d = open();
  d.prepare(
    `INSERT OR REPLACE INTO session_judgments
      (session_id, source, judge, judged_at, score, entry_count, verdict)
     VALUES (?, ?, ?, ?, ?, ?, ?)`,
  ).run(
    j.session_id,
    j.source,
    j.judge,
    j.judged_at,
    j.score,
    entryCount,
    JSON.stringify(j),
  );
}

export function getJudgment(sessionId: string): SessionJudgment | null {
  const d = open();
  const row = d
    .prepare(
      `SELECT verdict FROM session_judgments WHERE session_id = ?`,
    )
    .get(sessionId) as { verdict: string } | undefined;
  if (!row) return null;
  try {
    return JSON.parse(row.verdict) as SessionJudgment;
  } catch {
    return null;
  }
}

export function listJudgments(limit = 500): SessionJudgment[] {
  const d = open();
  const rows = d
    .prepare(
      `SELECT verdict FROM session_judgments
        ORDER BY judged_at DESC LIMIT ?`,
    )
    .all(limit) as Array<{ verdict: string }>;
  const out: SessionJudgment[] = [];
  for (const r of rows) {
    try {
      out.push(JSON.parse(r.verdict));
    } catch {
      /* skip malformed */
    }
  }
  return out;
}

/** Is the judgment for this session stale vs current entry count? */
export function judgmentNeedsRefresh(sessionId: string): boolean {
  const d = open();
  const row = d
    .prepare(
      `SELECT sj.entry_count AS cached,
              (SELECT COUNT(*) FROM session_entries WHERE session_id = ?) AS cur
         FROM session_judgments sj
        WHERE sj.session_id = ?`,
    )
    .get(sessionId, sessionId) as
    | { cached: number; cur: number }
    | undefined;
  if (!row) return true;
  return row.cached !== row.cur;
}

/** Count of entries for a session (used to stamp judgments as fresh). */
export function countEntries(sessionId: string): number {
  const d = open();
  const row = d
    .prepare(
      `SELECT COUNT(*) AS n FROM session_entries WHERE session_id = ?`,
    )
    .get(sessionId) as { n: number } | undefined;
  return row?.n ?? 0;
}

// ---- Repos --------------------------------------------------------------

/**
 * Enumerate repos from per-session judgments (only judged sessions know
 * their repo). Returns one row per repo with aggregates.
 */
export function listRepos(): RepoSummary[] {
  const d = open();
  // Extract repo from verdict JSON. Using JSON_EXTRACT because verdicts are
  // stored as JSON strings.
  const rows = d
    .prepare(
      `SELECT
          json_extract(sj.verdict, '$.repo') AS repo,
          COUNT(*)                           AS judgment_count,
          AVG(sj.score)                      AS score_avg,
          MIN(sj.judged_at)                  AS first_ts,
          MAX(sj.judged_at)                  AS last_ts
        FROM session_judgments sj
        GROUP BY repo
        ORDER BY last_ts DESC`,
    )
    .all() as Array<{
    repo: string | null;
    judgment_count: number;
    score_avg: number;
    first_ts: string;
    last_ts: string;
  }>;

  // For total session counts we also ask session_entries grouped by repo.
  // We infer a session's repo from its judgment (already computed above).
  // A session with no judgment is omitted until it is judged.

  const insightRepos = new Set(
    (
      d
        .prepare(`SELECT repo FROM repo_insights`)
        .all() as Array<{ repo: string }>
    ).map((r) => r.repo),
  );

  return rows
    .filter((r) => !!r.repo)
    .map((r) => ({
      repo: r.repo as string,
      session_count: r.judgment_count,
      first_ts: r.first_ts,
      last_ts: r.last_ts,
      judgment_count: r.judgment_count,
      score_avg:
        typeof r.score_avg === "number"
          ? Math.round(r.score_avg * 10) / 10
          : null,
      has_insight: insightRepos.has(r.repo as string),
    }));
}

/** Fetch all SessionJudgment rows for a given repo. */
export function listJudgmentsForRepo(repo: string): SessionJudgment[] {
  const d = open();
  const rows = d
    .prepare(
      `SELECT verdict FROM session_judgments
         WHERE json_extract(verdict, '$.repo') = ?
         ORDER BY judged_at ASC`,
    )
    .all(repo) as Array<{ verdict: string }>;
  const out: SessionJudgment[] = [];
  for (const r of rows) {
    try {
      out.push(JSON.parse(r.verdict));
    } catch {
      /* skip */
    }
  }
  return out;
}

export function saveRepoInsight(i: RepoInsight): void {
  const d = open();
  d.prepare(
    `INSERT OR REPLACE INTO repo_insights
      (repo, session_count, score_avg, judge, evaluated_at, insight)
     VALUES (?, ?, ?, ?, ?, ?)`,
  ).run(
    i.repo,
    i.session_count,
    i.score_avg,
    i.judge,
    i.evaluated_at,
    JSON.stringify(i),
  );
}

export function getRepoInsight(repo: string): RepoInsight | null {
  const d = open();
  const row = d
    .prepare(`SELECT insight FROM repo_insights WHERE repo = ?`)
    .get(repo) as { insight: string } | undefined;
  if (!row) return null;
  try {
    return JSON.parse(row.insight) as RepoInsight;
  } catch {
    return null;
  }
}

function clip(s: string, n: number): string {
  return s.length > n ? s.slice(0, n) + "…" : s;
}

function deriveProject(meta: string | null): string | null {
  if (!meta) return null;
  try {
    const obj = JSON.parse(meta);
    if (typeof obj?.cwd === "string") return obj.cwd;
    if (typeof obj?.path?.cwd === "string") return obj.path.cwd;
    if (typeof obj?._session_slug === "string") return obj._session_slug;
  } catch {
    return null;
  }
  return null;
}
