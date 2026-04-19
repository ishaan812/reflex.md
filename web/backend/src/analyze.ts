import { Router } from "express";
import { createTwoFilesPatch } from "diff";
import { Octokit } from "@octokit/rest";
import { prisma } from "./prisma.js";
import { detectCorrections, clusterCorrections } from "./friction.js";
import { fetchInstructionFile, openPrForAnalysis } from "./github.js";
import { optimizeInstructionFile } from "./llm.js";

export const analyzeRoutes = Router();

analyzeRoutes.post(
  "/repos/:owner/:name/analyze",
  async (req: any, res, next) => {
    try {
      const { owner, name } = req.params;
      const repo = await prisma.repo.findUnique({
        where: {
          userId_owner_name: { userId: req.user.id, owner, name },
        },
        include: { sessions: { orderBy: { startedAt: "desc" }, take: 3 } },
      });
      if (!repo) {
        return res
          .status(404)
          .json({ error: "repo not ingested yet — run ingest first" });
      }
      if (repo.sessions.length === 0) {
        return res
          .status(400)
          .json({ error: "no sessions to analyze. Re-run ingest." });
      }

      const allCorrections = repo.sessions.flatMap((s) =>
        detectCorrections(s.events as any),
      );
      const clusters = clusterCorrections(allCorrections);
      const fq =
        repo.sessions.reduce((a, s) => a + s.frictionScore, 0) /
        Math.max(repo.sessions.length, 1);

      const gh = new Octokit({ auth: req.user.accessToken });
      const target = await fetchInstructionFile(gh, owner, name);

      const evidenceSessions = repo.sessions.map((s) => ({
        checkpointId: s.checkpointId,
        strategy: s.strategy,
        samplePrompts: (s.events as any[])
          .filter((e: any) => e.type === "user_prompt")
          .slice(0, 10)
          .map((e: any) => String(e.text ?? "").slice(0, 200)),
      }));

      const proposed = await optimizeInstructionFile({
        targetFile: target.path,
        currentText: target.text,
        clusters,
        evidenceSessions,
      });

      const unifiedDiff = createTwoFilesPatch(
        target.path,
        target.path,
        target.text,
        proposed.afterText,
      );

      const analysis = await prisma.analysis.create({
        data: {
          repoId: repo.id,
          frictionScore: fq,
          targetFile: target.path,
          beforeText: target.text,
          afterText: proposed.afterText,
          unifiedDiff,
          reasoning: proposed.reasoning as any,
          clusters: clusters as any,
        },
      });

      res.json({
        ...analysis,
        sessions: repo.sessions.map((s) => ({
          id: s.id,
          checkpointId: s.checkpointId,
          frictionScore: s.frictionScore,
          strategy: s.strategy,
        })),
      });
    } catch (e) {
      next(e);
    }
  },
);

analyzeRoutes.post("/analyses/:id/open-pr", async (req: any, res, next) => {
  try {
    const { prUrl, prNumber } = await openPrForAnalysis(
      req.user,
      req.params.id,
    );
    res.json({ prUrl, prNumber });
  } catch (e: any) {
    if (e.status === 403) {
      return res.status(403).json({
        error:
          "GitHub rejected the request (check repo push access + OAuth scopes).",
      });
    }
    if (e.status === 404) {
      return res
        .status(404)
        .json({ error: "repo not found or missing permissions." });
    }
    next(e);
  }
});
