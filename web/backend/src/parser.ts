import { readdirSync, readFileSync, statSync, existsSync } from "node:fs";
import { join } from "node:path";
import type { ParsedCheckpoint, ParsedSession, TranscriptEvent } from "./types.js";

/**
 * Walks a working tree that contains `entire/checkpoints/v1` shards and
 * returns the most recent `limit` checkpoints, newest first.
 *
 * Layout (from brand/TRANSCRIPT_FORMAT.md):
 *   <root>/<aa>/<rest>/metadata.json
 *   <root>/<aa>/<rest>/<idx>/{metadata.json,full.jsonl,...}
 */
export function parseCheckpointsBranch(root: string, limit = 3): ParsedCheckpoint[] {
  if (!existsSync(root)) return [];
  const shardNames = readdirSync(root).filter((s) => /^[0-9a-f]{2}$/i.test(s));
  const all: ParsedCheckpoint[] = [];

  for (const shard of shardNames) {
    const shardDir = join(root, shard);
    if (!statSync(shardDir).isDirectory()) continue;
    for (const rest of readdirSync(shardDir)) {
      const cpDir = join(shardDir, rest);
      if (!statSync(cpDir).isDirectory()) continue;
      try {
        all.push(parseOne(`${shard}${rest}`, cpDir));
      } catch (e) {
        // eslint-disable-next-line no-console
        console.warn(`[parser] skipping ${shard}${rest}: ${(e as Error).message}`);
      }
    }
  }

  return all
    .sort((a, b) => (a.createdAt > b.createdAt ? -1 : 1))
    .slice(0, limit);
}

function parseOne(id: string, dir: string): ParsedCheckpoint {
  const metaPath = join(dir, "metadata.json");
  if (!existsSync(metaPath)) {
    throw new Error(`missing metadata.json in ${dir}`);
  }
  const meta = JSON.parse(readFileSync(metaPath, "utf8"));
  const sessions: ParsedSession[] = [];
  for (const entry of readdirSync(dir)) {
    if (!/^\d+$/.test(entry)) continue;
    const sessionDir = join(dir, entry);
    if (!statSync(sessionDir).isDirectory()) continue;
    sessions.push(parseSession(Number(entry), sessionDir));
  }
  sessions.sort((a, b) => a.index - b.index);
  return {
    checkpointId: meta.checkpoint_id ?? id,
    createdAt: meta.created_at ?? new Date().toISOString(),
    sessions,
  };
}

function parseSession(idx: number, dir: string): ParsedSession {
  const meta = JSON.parse(readFileSync(join(dir, "metadata.json"), "utf8"));
  const jsonlPath = join(dir, "full.jsonl");
  const raw = existsSync(jsonlPath) ? readFileSync(jsonlPath, "utf8") : "";
  const events: TranscriptEvent[] = [];
  for (const line of raw.split("\n")) {
    if (!line.trim()) continue;
    try {
      events.push(JSON.parse(line) as TranscriptEvent);
    } catch {
      // tolerate malformed lines per brand/TRANSCRIPT_FORMAT.md
      continue;
    }
  }
  return {
    index: idx,
    strategy: meta.strategy_name ?? meta.strategy ?? "unknown",
    branch: meta.branch ?? null,
    filesTouched: meta.files_touched ?? [],
    tokenUsage: meta.token_usage ?? {},
    startedAt: meta.started_at ?? new Date().toISOString(),
    endedAt: meta.ended_at ?? null,
    events,
  };
}
