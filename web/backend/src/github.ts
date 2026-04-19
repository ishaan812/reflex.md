import { Router } from "express";
import { Octokit } from "@octokit/rest";
import { prisma } from "./prisma.js";
import { ingestRepo } from "./ingest.js";

export const repoRoutes = Router();

repoRoutes.get("/me", (req: any, res) => {
  res.json({ login: req.user.githubLogin });
});

repoRoutes.get("/repos", async (req: any, res, next) => {
  try {
    const gh = new Octokit({ auth: req.user.accessToken });
    const { data } = await gh.repos.listForAuthenticatedUser({
      per_page: 100,
      sort: "pushed",
      visibility: "all",
    });
    res.json(
      data.map((r) => ({
        owner: r.owner.login,
        name: r.name,
        full_name: r.full_name,
        defaultBranch: r.default_branch,
        private: r.private,
        pushedAt: r.pushed_at,
        description: r.description,
      })),
    );
  } catch (e) {
    next(e);
  }
});

repoRoutes.get("/sessions/:id", async (req: any, res, next) => {
  try {
    const session = await prisma.session.findFirst({
      where: { id: req.params.id, repo: { userId: req.user.id } },
      include: { repo: { select: { owner: true, name: true } } },
    });
    if (!session) return res.status(404).json({ error: "session not found" });
    res.json({
      id: session.id,
      checkpointId: session.checkpointId,
      idx: session.idx,
      strategy: session.strategy,
      branch: session.branch,
      startedAt: session.startedAt,
      endedAt: session.endedAt,
      filesTouched: session.filesTouched,
      tokenUsage: session.tokenUsage,
      frictionScore: session.frictionScore,
      events: session.events,
      repo: session.repo,
    });
  } catch (e) {
    next(e);
  }
});

repoRoutes.post("/repos/:owner/:name/ingest", async (req: any, res, next) => {
  try {
    const result = await ingestRepo(req.user, req.params.owner, req.params.name);
    res.json(result);
  } catch (e: any) {
    // return readable error for missing shadow branch
    if (
      typeof e.message === "string" &&
      (e.message.includes("Remote branch") ||
        e.message.includes("not found in upstream") ||
        e.message.includes("couldn't find remote ref"))
    ) {
      return res.status(400).json({
        error:
          "This repo does not have the `entire/checkpoints/v1` shadow branch. Install entire-cli first.",
      });
    }
    next(e);
  }
});

export async function fetchInstructionFile(
  gh: Octokit,
  owner: string,
  name: string,
): Promise<{ path: string; text: string; sha: string | null }> {
  for (const path of ["AGENTS.md", "CLAUDE.md"]) {
    try {
      const { data } = await gh.repos.getContent({ owner, repo: name, path });
      if (!Array.isArray(data) && (data as any).type === "file") {
        const text = Buffer.from((data as any).content, "base64").toString(
          "utf8",
        );
        return { path, text, sha: (data as any).sha };
      }
    } catch {
      // 404 — try next file
    }
  }
  return { path: "AGENTS.md", text: "", sha: null };
}

export async function openPrForAnalysis(
  user: { accessToken: string },
  analysisId: string,
): Promise<{ prUrl: string; prNumber: number }> {
  const a = await prisma.analysis.findUniqueOrThrow({
    where: { id: analysisId },
    include: { repo: true },
  });

  // idempotent: if we already opened a PR for this analysis, return it
  if (a.prNumber && a.prUrl) {
    return { prUrl: a.prUrl, prNumber: a.prNumber };
  }

  const gh = new Octokit({ auth: user.accessToken });
  const { owner, name } = a.repo;

  const { data: repo } = await gh.repos.get({ owner, repo: name });
  const base = repo.default_branch;
  const { data: baseRef } = await gh.git.getRef({
    owner,
    repo: name,
    ref: `heads/${base}`,
  });
  const baseSha = baseRef.object.sha;
  const { data: baseCommit } = await gh.git.getCommit({
    owner,
    repo: name,
    commit_sha: baseSha,
  });

  const { data: blob } = await gh.git.createBlob({
    owner,
    repo: name,
    content: Buffer.from(a.afterText).toString("base64"),
    encoding: "base64",
  });
  const { data: tree } = await gh.git.createTree({
    owner,
    repo: name,
    base_tree: baseCommit.tree.sha,
    tree: [
      {
        path: a.targetFile,
        mode: "100644",
        type: "blob",
        sha: blob.sha,
      },
    ],
  });
  const { data: commit } = await gh.git.createCommit({
    owner,
    repo: name,
    message: `Reflex: update ${a.targetFile}`,
    tree: tree.sha,
    parents: [baseSha],
  });

  const branch = `reflex/update-${a.targetFile.replace(/\./g, "-")}-${a.id.slice(0, 8)}`;
  try {
    await gh.git.createRef({
      owner,
      repo: name,
      ref: `refs/heads/${branch}`,
      sha: commit.sha,
    });
  } catch (e: any) {
    // branch may already exist from a partially-completed earlier attempt
    if (e.status !== 422) throw e;
  }

  const body = renderPrBody(a);
  const { data: pr } = await gh.pulls.create({
    owner,
    repo: name,
    title: `Reflex: update ${a.targetFile}`,
    head: branch,
    base,
    body,
  });

  await prisma.analysis.update({
    where: { id: a.id },
    data: { prNumber: pr.number, prUrl: pr.html_url },
  });

  return { prUrl: pr.html_url, prNumber: pr.number };
}

function renderPrBody(a: any): string {
  const reasoning = (a.reasoning as any[]) ?? [];
  const reasoningLines = reasoning.length
    ? reasoning
        .map(
          (r) =>
            `- **${r.rule}** — "${r.evidenceText}" (checkpoints: ${(r.checkpointIds ?? [])
              .map((c: string) => c.slice(0, 8))
              .join(", ")})`,
        )
        .join("\n")
    : "- (no structured reasoning returned)";
  return [
    `## Reflex.md proposal`,
    ``,
    `Updates \`${a.targetFile}\` based on friction detected across the last 3 sessions.`,
    ``,
    `**Headline Friction Quotient:** ${a.frictionScore.toFixed(2)}`,
    ``,
    `### Why this change`,
    reasoningLines,
    ``,
    `<sub>Generated by Reflex.md. Every rule above cites an \`entire-cli\` checkpoint. Audit with \`git log --all --grep='Checkpoint-Id: <id>'\`.</sub>`,
  ].join("\n");
}
