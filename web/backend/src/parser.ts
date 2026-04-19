import { readdirSync, readFileSync, statSync, existsSync } from "node:fs";
import { join } from "node:path";
import type {
  InitialAttribution,
  ParsedCheckpoint,
  ParsedSession,
  TokenUsage,
} from "./types.js";

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
  if (!existsSync(root)) return [];
  const shards = readdirSync(root).filter((s) => /^[0-9a-f]{2}$/i.test(s));
  const all: ParsedCheckpoint[] = [];

  for (const shard of shards) {
    const shardDir = join(root, shard);
    if (!statSync(shardDir).isDirectory()) continue;
    for (const rest of readdirSync(shardDir)) {
      const cpDir = join(shardDir, rest);
      if (!statSync(cpDir).isDirectory()) continue;
      try {
        const cp = parseOneCheckpoint(`${shard}${rest}`, cpDir);
        if (cp) all.push(cp);
      } catch (e) {
        // eslint-disable-next-line no-console
        console.warn(
          `[parser] skipping ${shard}${rest}: ${(e as Error).message}`,
        );
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
      // eslint-disable-next-line no-console
      console.warn(
        `[parser] skipping session ${checkpointId}#${entry}: ${(e as Error).message}`,
      );
    }
  }
  sessions.sort((a, b) => a.index - b.index);

  const createdAt = sessions.length
    ? sessions
        .map((s) => s.startedAt)
        .sort()
        .at(0)!
    : new Date().toISOString();

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

function parseOneSession(idx: number, dir: string): ParsedSession {
  const metaPath = join(dir, "metadata.json");
  if (!existsSync(metaPath)) {
    throw new Error(`missing metadata.json`);
  }
  const meta = safeJson(readFileSync(metaPath, "utf8")) as any;

  const jsonlPath = join(dir, "full.jsonl");
  const events: unknown[] = existsSync(jsonlPath)
    ? parseJsonl(readFileSync(jsonlPath, "utf8"))
    : [];

  const promptPath = join(dir, "prompt.txt");
  const prompt = existsSync(promptPath)
    ? readFileSync(promptPath, "utf8")
    : null;

  const contextPath = join(dir, "context.md");
  const context = existsSync(contextPath)
    ? readFileSync(contextPath, "utf8")
    : null;

  return {
    index: idx,
    sessionId: meta?.session_id ?? null,
    agent: meta?.agent ?? "Unknown Agent",
    strategy: meta?.strategy ?? "unknown",
    branch: meta?.branch ?? null,
    turnId: meta?.turn_id ?? null,
    filesTouched: Array.isArray(meta?.files_touched) ? meta.files_touched : [],
    tokenUsage: (meta?.token_usage as TokenUsage) ?? {},
    startedAt: meta?.created_at ?? new Date().toISOString(),
    endedAt: null, // entire-cli does not track this
    prompt,
    context,
    attribution: (meta?.initial_attribution as InitialAttribution) ?? null,
    events,
  };
}

function parseJsonl(raw: string): unknown[] {
  const out: unknown[] = [];
  for (const line of raw.split("\n")) {
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
