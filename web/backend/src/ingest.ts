import simpleGit from "simple-git";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { prisma } from "./prisma.js";
import { parseCheckpointsBranch, takeParseWarnings } from "./parser.js";
import { scoreSession } from "./friction.js";

export async function ingestRepo(
  user: { id: string; accessToken: string },
  owner: string,
  name: string,
) {
  const dir = mkdtempSync(join(tmpdir(), "reflex-"));
  try {
    const url = `https://x-access-token:${user.accessToken}@github.com/${owner}/${name}.git`;
    await simpleGit().clone(url, dir, [
      "--depth",
      "1",
      "--branch",
      "entire/checkpoints/v1",
      "--single-branch",
    ]);
    const checkpoints = parseCheckpointsBranch(dir, 3);
    const parseWarnings = takeParseWarnings();

    const repo = await prisma.repo.upsert({
      where: { userId_owner_name: { userId: user.id, owner, name } },
      update: {},
      create: { userId: user.id, owner, name },
    });

    for (const cp of checkpoints) {
      for (const s of cp.sessions) {
        const fq = scoreSession(s.agent, s.events, s.prompt);
        await prisma.session.upsert({
          where: {
            repoId_checkpointId_idx: {
              repoId: repo.id,
              checkpointId: cp.checkpointId,
              idx: s.index,
            },
          },
          update: {
            events: s.events as any,
            frictionScore: fq,
            filesTouched: s.filesTouched,
            tokenUsage: s.tokenUsage as any,
            agent: s.agent,
            sessionId: s.sessionId,
            turnId: s.turnId,
            startedAt: new Date(s.startedAt),
            endedAt: s.endedAt ? new Date(s.endedAt) : null,
            prompt: s.prompt,
            context: s.context,
            attribution: (s.attribution ?? null) as any,
            summary: (s.summary ?? null) as any,
          },
          create: {
            repoId: repo.id,
            checkpointId: cp.checkpointId,
            idx: s.index,
            agent: s.agent,
            sessionId: s.sessionId,
            turnId: s.turnId,
            strategy: s.strategy,
            branch: s.branch,
            startedAt: new Date(s.startedAt),
            endedAt: s.endedAt ? new Date(s.endedAt) : null,
            filesTouched: s.filesTouched,
            tokenUsage: s.tokenUsage as any,
            events: s.events as any,
            prompt: s.prompt,
            context: s.context,
            attribution: (s.attribution ?? null) as any,
            summary: (s.summary ?? null) as any,
            frictionScore: fq,
          },
        });
      }
    }

    const sessions = await prisma.session.findMany({
      where: { repoId: repo.id },
      orderBy: { startedAt: "desc" },
      select: {
        id: true,
        checkpointId: true,
        idx: true,
        agent: true,
        sessionId: true,
        turnId: true,
        strategy: true,
        branch: true,
        startedAt: true,
        endedAt: true,
        filesTouched: true,
        tokenUsage: true,
        frictionScore: true,
        prompt: true,
        summary: true,
      },
    });

    return { repo: { id: repo.id, owner, name }, sessions, parseWarnings };
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}
