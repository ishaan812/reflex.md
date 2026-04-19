import { readdirSync, readFileSync, statSync, existsSync } from "node:fs";
import { join } from "node:path";
import type {
  InitialAttribution,
  ParsedCheckpoint,
  ParsedSession,
  SessionSummaryBlock,
  TokenUsage,
} from "./types.js";

export interface ParseWarning {
  /** Location relative to the repo root (e.g. `18/a01d659c86` or `.../session 0`). */
  path: string;
  /** Short category: `checkpoint` for top-level failures, `session` for per-session. */
  kind: "checkpoint" | "session";
  message: string;
}

/**
 * Collected during the last `parseCheckpointsBranch` run. Callers who care
 * (e.g. the ingest endpoint) can read + reset via `takeParseWarnings()` so
 * we can surface them in API responses instead of only logging.
 */
let pendingWarnings: ParseWarning[] = [];

export function takeParseWarnings(): ParseWarning[] {
  const w = pendingWarnings;
  pendingWarnings = [];
  return w;
}

/**
 * Walks the working tree of an `entire/checkpoints/v1` shadow branch and
 * returns the `limit` most recent checkpoints, newest first.
 *
 * Real on-disk layout (from entireio/cli, verified against ishaan812/devlog):
 *
 *   <root>/<id[:2]>/<id[2:]>/metadata.json        ← CheckpointSummary
 *   <root>/<id[:2]>/<id[2:]>/<n>/metadata.json    ← per-session CommittedMetadata
 *   <root>/<id[:2]>/<id[2:]>/<n>/full.jsonl       ← agent-specific transcript
 *   <root>/<id[:2]>/<id[2:]>/<n>/prompt.txt       ← canonical user prompts
 *   <root>/<id[:2]>/<id[2:]>/<n>/context.md       ← optional
 *   <root>/<id[:2]>/<id[2:]>/<n>/content_hash.txt
 */
export function parseCheckpointsBranch(
  root: string,
  limit = 3,
): ParsedCheckpoint[] {
  pendingWarnings = [];
  if (!existsSync(root)) return [];
  const shards = readdirSync(root).filter((s) => /^[0-9a-f]{2}$/i.test(s));
  const all: ParsedCheckpoint[] = [];

  for (const shard of shards) {
    const shardDir = join(root, shard);
    if (!statSync(shardDir).isDirectory()) continue;
    for (const rest of readdirSync(shardDir)) {
      const cpDir = join(shardDir, rest);
      if (!statSync(cpDir).isDirectory()) continue;
      const cpId = `${shard}${rest}`;
      try {
        const cp = parseOneCheckpoint(cpId, cpDir);
        if (cp) all.push(cp);
      } catch (e) {
        const message = (e as Error).message;
        pendingWarnings.push({ path: cpId, kind: "checkpoint", message });
        // eslint-disable-next-line no-console
        console.warn(`[parser] skipping ${cpId}: ${message}`);
      }
    }
  }

  // Newest-first by the chronologically earliest session in the checkpoint.
  return all
    .sort((a, b) => (a.createdAt > b.createdAt ? -1 : 1))
    .slice(0, limit);
}

function parseOneCheckpoint(
  fallbackId: string,
  dir: string,
): ParsedCheckpoint | null {
  const metaPath = join(dir, "metadata.json");
  if (!existsSync(metaPath)) {
    throw new Error(`missing metadata.json in ${dir}`);
  }
  const meta = safeJson(readFileSync(metaPath, "utf8")) as any;
  const checkpointId: string = meta?.checkpoint_id ?? fallbackId;
  const strategy: string = meta?.strategy ?? "unknown";
  const branch: string | null = meta?.branch ?? null;
  const filesTouched: string[] = Array.isArray(meta?.files_touched)
    ? meta.files_touched
    : [];
  const tokenUsage: TokenUsage = (meta?.token_usage as TokenUsage) ?? {};

  const sessions: ParsedSession[] = [];
  for (const entry of readdirSync(dir)) {
    if (!/^\d+$/.test(entry)) continue;
    const sDir = join(dir, entry);
    if (!statSync(sDir).isDirectory()) continue;
    try {
      sessions.push(parseOneSession(Number(entry), sDir));
    } catch (e) {
      const message = (e as Error).message;
      pendingWarnings.push({
        path: `${checkpointId}#${entry}`,
        kind: "session",
        message,
      });
      // eslint-disable-next-line no-console
      console.warn(
        `[parser] skipping session ${checkpointId}#${entry}: ${message}`,
      );
    }
  }
  sessions.sort((a, b) => a.index - b.index);

  // Preferred: earliest session startedAt.
  // Fallbacks, in order:
  //   1. The checkpoint metadata's own created_at / committed_at if present
  //   2. The checkpoint dir's mtime
  // We never fall back to `Date.now()` because that would misorder historical
  // checkpoints with missing timestamps as "just now" and surface them in the
  // take-3 window.
  const createdAt =
    (sessions.length
      ? sessions
          .map((s) => s.startedAt)
          .filter(Boolean)
          .sort()
          .at(0)
      : undefined) ??
    (typeof meta?.created_at === "string" ? meta.created_at : undefined) ??
    (typeof meta?.committed_at === "string" ? meta.committed_at : undefined) ??
    safeMtime(metaPath) ??
    safeMtime(dir) ??
    new Date(0).toISOString();

  return {
    checkpointId,
    createdAt,
    branch,
    strategy,
    filesTouched,
    tokenUsage,
    sessions,
  };
}

function safeMtime(path: string): string | undefined {
  try {
    return statSync(path).mtime.toISOString();
  } catch {
    return undefined;
  }
}

function parseOneSession(idx: number, dir: string): ParsedSession {
  const metaPath = join(dir, "metadata.json");
  if (!existsSync(metaPath)) {
    throw new Error(`missing metadata.json`);
  }
  const meta = safeJson(readFileSync(metaPath, "utf8")) as any;

  const jsonlPath = join(dir, "full.jsonl");
  const events: unknown[] = existsSync(jsonlPath)
    ? parseTranscript(readFileSync(jsonlPath, "utf8"))
    : [];

  const promptPath = join(dir, "prompt.txt");
  const prompt = existsSync(promptPath)
    ? readFileSync(promptPath, "utf8")
    : null;

  const contextPath = join(dir, "context.md");
  const context = existsSync(contextPath)
    ? readFileSync(contextPath, "utf8")
    : null;

  const startedAt: string =
    (typeof meta?.created_at === "string" && meta.created_at) ||
    safeMtime(metaPath) ||
    safeMtime(dir) ||
    new Date(0).toISOString();

  // Derive endedAt from the latest event timestamp we can find in the raw
  // stream. Two caveats:
  //   1. Claude Code's JSONL often contains history from turns BEFORE the
  //      current checkpoint's `created_at`, so the raw maximum can precede
  //      startedAt. We clamp to `>= startedAt`.
  //   2. If no usable timestamp exists at all, leave as null.
  const endedAt = deriveEndedAt(events, startedAt);

  return {
    index: idx,
    sessionId: meta?.session_id ?? null,
    agent: meta?.agent ?? "Unknown Agent",
    strategy: meta?.strategy ?? "unknown",
    branch: meta?.branch ?? null,
    turnId: meta?.turn_id ?? null,
    filesTouched: Array.isArray(meta?.files_touched) ? meta.files_touched : [],
    tokenUsage: (meta?.token_usage as TokenUsage) ?? {},
    startedAt,
    endedAt,
    prompt,
    context,
    attribution: (meta?.initial_attribution as InitialAttribution) ?? null,
    summary: (meta?.summary as SessionSummaryBlock) ?? null,
    events,
  };
}

/**
 * Best-effort latest-timestamp scan across raw agent events.
 * Handles:
 *  - Claude Code JSONL: each entry has `timestamp` (ISO string).
 *  - OpenCode: each message has `info.time.updated` / `.created` (epoch ms).
 */
function deriveEndedAt(
  events: unknown[],
  startedAtIso: string | null,
): string | null {
  const startedMs =
    startedAtIso && Number.isFinite(Date.parse(startedAtIso))
      ? Date.parse(startedAtIso)
      : null;
  let maxMs = -Infinity;
  const consider = (ms: number) => {
    if (!Number.isFinite(ms)) return;
    if (ms > maxMs) maxMs = ms;
  };
  const visit = (v: any) => {
    if (!v || typeof v !== "object") return;
    const ts = v.timestamp ?? v.ts;
    if (typeof ts === "string") consider(Date.parse(ts));
    const info = v.info;
    if (info && typeof info === "object" && info.time) {
      const t = info.time;
      for (const key of ["completed", "updated", "created"]) {
        const raw = (t as any)[key];
        if (typeof raw === "number") consider(raw);
        else if (typeof raw === "string") consider(Date.parse(raw));
      }
    }
  };
  for (const e of events) visit(e);
  if (!Number.isFinite(maxMs)) return null;
  // Clamp: events preceding startedAt are checkpoint-history noise, not the
  // session's actual end.
  if (startedMs != null && maxMs < startedMs) return startedAtIso;
  return new Date(maxMs).toISOString();
}

/**
 * Parse a transcript file that may be either:
 * 1. True JSONL (one JSON object per line) — Claude Code format
 * 2. A single JSON object with `{ info, messages }` — OpenCode format
 *
 * Detects the format automatically and returns the event array.
 */
function parseTranscript(raw: string): unknown[] {
  const trimmed = raw.trim();
  if (!trimmed) return [];

  // Try parsing as a single JSON object first (OpenCode writes pretty-printed JSON
  // to full.jsonl which is NOT valid JSONL — each line fails individually).
  try {
    const obj = JSON.parse(trimmed);
    if (obj && typeof obj === "object" && !Array.isArray(obj)) {
      // OpenCode format: { info, messages: [...] }
      if (Array.isArray(obj.messages)) {
        return obj.messages;
      }
      // Single JSON object but no messages key — wrap it as a single event
      return [obj];
    }
    if (Array.isArray(obj)) return obj;
    // Primitive — wrap
    return [obj];
  } catch {
    // Not valid as a single JSON blob — fall through to JSONL parsing
  }

  // JSONL: one JSON object per line
  const out: unknown[] = [];
  for (const line of trimmed.split("\n")) {
    if (!line.trim()) continue;
    try {
      out.push(JSON.parse(line));
    } catch {
      // tolerate malformed lines
    }
  }
  return out;
}

function safeJson(raw: string): unknown {
  try {
    return JSON.parse(raw);
  } catch {
    return {};
  }
}
