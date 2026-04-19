# PLAN_V1.md — 4-Hour Execution Plan

> **Goal:** ship a working end-to-end demo of Reflex.md in 4 hours. Connect GitHub → parse `entire/checkpoints/v1` → detect repeated corrections → open a PR against `AGENTS.md` / `CLAUDE.md`.
>
> **Non-goal:** production quality. This plan optimizes for demo-able in 4 hours, not correctness at scale.

---

## 0. The stripped stack

| Layer | Choice | Why |
|---|---|---|
| DB | **Postgres** (Docker, local) | Only service we run. |
| ORM | **Prisma** | Fastest schema→client in TS. ~5 min to set up. |
| Backend | **Node 20 + TypeScript + Express** | Boring, familiar, works. |
| Frontend | **Vite + React + TS + Tailwind + shadcn/ui** | Fast scaffold, good diff viewer ecosystem. |
| Diff viewer | **`@monaco-editor/react`** (DiffEditor) | One import, works. |
| Git ops | **`simple-git`** | Shells out to `git`; easiest auth path. |
| GitHub API | **`@octokit/rest`** | All REST calls. |
| GitHub auth | **OAuth App + user access token** | NO GitHub App, NO webhooks, NO smee. |
| LLM | **Anthropic SDK** (Claude Sonnet 4.6 only) | One call per analysis. Skip Haiku. |
| Queue | **None — synchronous** | Analyze blocks the request; UI shows spinner. |

### What we explicitly CUT from `brand/ARCHITECTURE.md`

- ❌ Redis + BullMQ queues — analyze runs inline on the request thread.
- ❌ Probot / GitHub App / webhooks — OAuth user token instead.
- ❌ pnpm workspaces — two plain folders, two `package.json`s.
- ❌ Separate worker process — no `apps/worker`.
- ❌ WebSockets — frontend polls every 2 s while analyze runs, or just waits on the POST response.
- ❌ Embeddings for clustering — normalize text + group on first 5 meaningful tokens.
- ❌ Haiku classifier pass — regex + heuristic.
- ❌ Promotion / Pattern / Dead Context / Ignored Rules — parked for v1.1.
- ❌ Markdown lint + `git apply --check` guardrails — one-line sanity check only.
- ❌ Multi-session event drawer complexity — show prompts + tool calls, nothing fancy.

---

## 1. Folder layout

```
web/
├── PLAN_V1.md                ← this file
├── docker-compose.yml        ← postgres only
├── .env.example
├── brand/                    ← reference docs (already exists)
├── backend/
│   ├── package.json
│   ├── tsconfig.json
│   ├── prisma/
│   │   └── schema.prisma
│   └── src/
│       ├── server.ts         ← express app
│       ├── prisma.ts         ← prisma client singleton
│       ├── auth.ts           ← github oauth + jwt middleware
│       ├── parser.ts         ← parseCheckpoint(dir)
│       ├── ingest.ts         ← clone + parse + upsert
│       ├── analyze.ts        ← friction + llm + diff
│       ├── github.ts         ← octokit helpers (list repos, open PR)
│       └── types.ts          ← shared types
└── frontend/
    ├── package.json
    ├── vite.config.ts
    ├── index.html
    └── src/
        ├── main.tsx
        ├── App.tsx
        ├── api.ts            ← fetch wrappers
        ├── pages/
        │   ├── Login.tsx
        │   ├── Repos.tsx
        │   └── Repo.tsx      ← single page: timeline + analyze + diff
        └── components/
            ├── SessionRow.tsx
            ├── EventDrawer.tsx
            └── DiffView.tsx
```

Two independent packages. Root `docker-compose.yml` boots postgres for both.

---

## 2. Data model (4 tables, that's it)

```prisma
// backend/prisma/schema.prisma
generator client { provider = "prisma-client-js" }
datasource db     { provider = "postgresql"; url = env("DATABASE_URL") }

model User {
  id          String   @id @default(cuid())
  githubLogin String   @unique
  accessToken String                                // user OAuth token, encrypted in v2
  createdAt   DateTime @default(now())
  repos       Repo[]
}

model Repo {
  id            String   @id @default(cuid())
  userId        String
  user          User     @relation(fields: [userId], references: [id])
  owner         String
  name          String
  defaultBranch String   @default("main")
  sessions      Session[]
  analyses      Analysis[]
  @@unique([userId, owner, name])
}

model Session {
  id            String   @id @default(cuid())
  repoId        String
  repo          Repo     @relation(fields: [repoId], references: [id])
  checkpointId  String
  idx           Int                                  // session index inside checkpoint
  strategy      String
  branch        String?
  startedAt     DateTime
  endedAt       DateTime?
  filesTouched  String[]
  tokenUsage    Json
  events        Json                                 // full.jsonl lines, already parsed
  frictionScore Float    @default(0)
  @@unique([repoId, checkpointId, idx])
}

model Analysis {
  id            String   @id @default(cuid())
  repoId        String
  repo          Repo     @relation(fields: [repoId], references: [id])
  createdAt     DateTime @default(now())
  frictionScore Float
  targetFile    String                               // "AGENTS.md" | "CLAUDE.md"
  beforeText    String   @db.Text
  afterText     String   @db.Text
  unifiedDiff   String   @db.Text
  reasoning     Json                                 // [{rule, checkpointIds, evidenceText}]
  prNumber      Int?
  prUrl         String?
}
```

Notes:
- No separate `Event`, `Correction`, `Pattern`, `PullRequest` tables. All event data lives as JSON on `Session.events`.
- `Analysis.prNumber` + `prUrl` null until the user clicks Open PR.

---

## 3. API surface (8 endpoints, all under `/api` or `/auth`)

| Method | Path | Purpose |
|---|---|---|
| GET | `/auth/github` | 302 to GitHub OAuth authorize URL |
| GET | `/auth/github/callback?code=...` | Exchange code → user token → JWT cookie → redirect to `/repos` |
| POST | `/auth/logout` | Clear cookie |
| GET | `/api/me` | Current user (401 if not logged in) |
| GET | `/api/repos` | List user's GitHub repos (via Octokit) |
| POST | `/api/repos/:owner/:name/ingest` | Clone + parse last 3 checkpoints. Returns sessions. |
| POST | `/api/repos/:owner/:name/analyze` | Run friction + LLM. Returns Analysis. |
| POST | `/api/analyses/:id/open-pr` | Create PR on GitHub. Returns `{ prUrl, prNumber }`. |

No WebSockets. `ingest` and `analyze` are slow-ish (10–30 s) but we just keep the HTTP request open. Frontend shows a spinner. Fine for 4-hour demo.

---

## 4. Frontend routes (3, really 2)

- `/` — if logged in → redirect to `/repos`; else show Login page.
- `/repos` — list + pick repo → navigate to `/repos/:owner/:name`.
- `/repos/:owner/:name` — **single page, three panels:**
  1. Left: Session Timeline (list of `SessionRow`).
  2. Top-right: Analyze button + Friction Report (correction clusters).
  3. Bottom-right: `DiffView` (Monaco) with "Open PR" CTA.

Collapsing timeline + analysis + diff into one page saves 30–45 min of routing/state work.

---

## 5. Hour-by-hour breakdown

> All times are wall-clock from the moment you start the 4-hour timer. **Complete all pre-work (§8) before the clock starts.**

### Hour 1 · 0:00 – 1:00 — Foundation

**0:00–0:10 — Scaffold**

```bash
cd web
# backend
mkdir backend && cd backend
pnpm init
pnpm add express cors cookie-parser jsonwebtoken @octokit/rest \
         @anthropic-ai/sdk simple-git diff prisma @prisma/client \
         zod dotenv
pnpm add -D typescript tsx @types/node @types/express \
            @types/cors @types/cookie-parser @types/jsonwebtoken
npx tsc --init
# frontend
cd ..
pnpm create vite frontend -- --template react-ts
cd frontend
pnpm add react-router-dom @monaco-editor/react lucide-react \
         @tanstack/react-query clsx
pnpm add -D tailwindcss postcss autoprefixer
npx tailwindcss init -p
# shadcn (lightweight — only Button, Card, Badge, Dialog)
pnpm dlx shadcn@latest init -d
pnpm dlx shadcn@latest add button card badge dialog skeleton
```

Create `web/docker-compose.yml`:

```yaml
services:
  postgres:
    image: postgres:16
    ports: ["5432:5432"]
    environment:
      POSTGRES_USER: reflex
      POSTGRES_PASSWORD: reflex
      POSTGRES_DB: reflex
    volumes: ["pgdata:/var/lib/postgresql/data"]
volumes: { pgdata: {} }
```

Create `web/.env.example` (copy to `.env`):

```
DATABASE_URL=postgresql://reflex:reflex@localhost:5432/reflex
GITHUB_CLIENT_ID=...
GITHUB_CLIENT_SECRET=...
JWT_SECRET=change-me
ANTHROPIC_API_KEY=...
FRONTEND_ORIGIN=http://localhost:5173
BACKEND_ORIGIN=http://localhost:3001
```

Run `docker compose up -d`. Postgres is live.

**0:10–0:25 — Prisma schema + migration**

Paste the schema from §2 into `backend/prisma/schema.prisma`. Then:

```bash
cd backend
npx prisma migrate dev --name init
npx prisma generate
```

Sanity: open Prisma Studio (`npx prisma studio`), confirm tables exist.

**0:25–0:50 — Parser (the risky piece — ship first)**

`backend/src/parser.ts`. Pure function, no network, no DB. Target shape defined in [`brand/TRANSCRIPT_FORMAT.md`](./brand/TRANSCRIPT_FORMAT.md).

```ts
import { readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";

export interface ParsedSession { /* see brand/TRANSCRIPT_FORMAT.md */ }
export interface ParsedCheckpoint {
  checkpointId: string;
  createdAt: string;
  sessions: ParsedSession[];
}

export function parseCheckpointsBranch(root: string, limit = 3): ParsedCheckpoint[] {
  // root = cloned working tree of entire/checkpoints/v1
  // walk shards: root/<aa>/<rest>/
  const shards = readdirSync(root).filter(s => /^[0-9a-f]{2}$/.test(s));
  const all: ParsedCheckpoint[] = [];
  for (const shard of shards) {
    const shardDir = join(root, shard);
    for (const rest of readdirSync(shardDir)) {
      const cpDir = join(shardDir, rest);
      if (!statSync(cpDir).isDirectory()) continue;
      all.push(parseOne(`${shard}${rest}`, cpDir));
    }
  }
  return all.sort((a, b) => b.createdAt.localeCompare(a.createdAt)).slice(0, limit);
}

function parseOne(id: string, dir: string): ParsedCheckpoint {
  const meta = JSON.parse(readFileSync(join(dir, "metadata.json"), "utf8"));
  const sessions: ParsedSession[] = [];
  for (const entry of readdirSync(dir)) {
    if (!/^\d+$/.test(entry)) continue;
    sessions.push(parseSession(Number(entry), join(dir, entry)));
  }
  return { checkpointId: id, createdAt: meta.created_at, sessions };
}

function parseSession(idx: number, dir: string): ParsedSession {
  const meta = JSON.parse(readFileSync(join(dir, "metadata.json"), "utf8"));
  const raw = readFileSync(join(dir, "full.jsonl"), "utf8");
  const events = raw.split("\n").filter(Boolean).map(line => {
    try { return JSON.parse(line); } catch { return null; }
  }).filter(Boolean);
  return {
    index: idx,
    strategy: meta.strategy_name,
    branch: meta.branch ?? null,
    filesTouched: meta.files_touched ?? [],
    tokenUsage: meta.token_usage ?? {},
    startedAt: meta.started_at,
    endedAt: meta.ended_at ?? null,
    events,
  };
}
```

Smoke test with one fixture checkpoint before moving on. **If the parser is wrong, nothing else matters.**

**0:50–1:00 — Express skeleton**

`backend/src/server.ts`:

```ts
import "dotenv/config";
import express from "express";
import cors from "cors";
import cookieParser from "cookie-parser";
import { authRoutes, requireUser } from "./auth.js";
import { repoRoutes } from "./github.js";
import { analyzeRoutes } from "./analyze.js";

const app = express();
app.use(cors({ origin: process.env.FRONTEND_ORIGIN, credentials: true }));
app.use(express.json({ limit: "10mb" }));
app.use(cookieParser());

app.get("/api/health", (_, res) => res.json({ ok: true }));
app.use("/auth", authRoutes);
app.use("/api", requireUser);
app.use("/api", repoRoutes);
app.use("/api", analyzeRoutes);

app.use((err: any, _req: any, res: any, _next: any) => {
  console.error(err);
  res.status(err.status ?? 500).json({ error: err.message });
});

app.listen(3001, () => console.log("api on 3001"));
```

Run `pnpm tsx src/server.ts`. Hit `/api/health` — green.

---

### Hour 2 · 1:00 – 2:00 — GitHub OAuth + Ingest

**1:00–1:25 — OAuth flow**

`backend/src/auth.ts`:

```ts
import { Router, RequestHandler } from "express";
import jwt from "jsonwebtoken";
import { prisma } from "./prisma.js";

export const authRoutes = Router();

authRoutes.get("/github", (_req, res) => {
  const url = new URL("https://github.com/login/oauth/authorize");
  url.searchParams.set("client_id", process.env.GITHUB_CLIENT_ID!);
  url.searchParams.set("scope", "repo");
  url.searchParams.set("redirect_uri", `${process.env.BACKEND_ORIGIN}/auth/github/callback`);
  res.redirect(url.toString());
});

authRoutes.get("/github/callback", async (req, res) => {
  const code = String(req.query.code);
  const tokRes = await fetch("https://github.com/login/oauth/access_token", {
    method: "POST",
    headers: { "Content-Type": "application/json", Accept: "application/json" },
    body: JSON.stringify({
      client_id: process.env.GITHUB_CLIENT_ID,
      client_secret: process.env.GITHUB_CLIENT_SECRET,
      code,
    }),
  }).then(r => r.json());
  const accessToken = tokRes.access_token;
  const me = await fetch("https://api.github.com/user", {
    headers: { Authorization: `Bearer ${accessToken}`, "User-Agent": "reflex-md" },
  }).then(r => r.json());

  const user = await prisma.user.upsert({
    where: { githubLogin: me.login },
    update: { accessToken },
    create: { githubLogin: me.login, accessToken },
  });

  const token = jwt.sign({ uid: user.id }, process.env.JWT_SECRET!, { expiresIn: "7d" });
  res.cookie("session", token, { httpOnly: true, sameSite: "lax" });
  res.redirect(`${process.env.FRONTEND_ORIGIN}/repos`);
});

export const requireUser: RequestHandler = async (req: any, res, next) => {
  const token = req.cookies?.session;
  if (!token) return res.status(401).json({ error: "unauthenticated" });
  try {
    const { uid } = jwt.verify(token, process.env.JWT_SECRET!) as { uid: string };
    req.user = await prisma.user.findUniqueOrThrow({ where: { id: uid } });
    next();
  } catch { res.status(401).json({ error: "invalid session" }); }
};
```

Test: visit `http://localhost:3001/auth/github`. Should bounce through GitHub and land back with a cookie.

**1:25–1:40 — List repos + `/api/me`**

`backend/src/github.ts`:

```ts
import { Router } from "express";
import { Octokit } from "@octokit/rest";

export const repoRoutes = Router();

repoRoutes.get("/me", (req: any, res) => {
  res.json({ login: req.user.githubLogin });
});

repoRoutes.get("/repos", async (req: any, res) => {
  const gh = new Octokit({ auth: req.user.accessToken });
  const { data } = await gh.repos.listForAuthenticatedUser({
    per_page: 100, sort: "pushed", visibility: "all",
  });
  res.json(data.map(r => ({
    owner: r.owner.login, name: r.name,
    defaultBranch: r.default_branch, private: r.private,
    pushedAt: r.pushed_at,
  })));
});
```

**1:40–2:00 — Ingest**

`backend/src/ingest.ts`:

```ts
import simpleGit from "simple-git";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { prisma } from "./prisma.js";
import { parseCheckpointsBranch } from "./parser.js";

export async function ingestRepo(user: { id: string; accessToken: string },
                                 owner: string, name: string) {
  const dir = mkdtempSync(join(tmpdir(), "reflex-"));
  try {
    const url = `https://x-access-token:${user.accessToken}@github.com/${owner}/${name}.git`;
    await simpleGit().clone(url, dir, [
      "--depth", "1",
      "--branch", "entire/checkpoints/v1",
      "--single-branch",
    ]);
    const checkpoints = parseCheckpointsBranch(dir, 3);

    const repo = await prisma.repo.upsert({
      where: { userId_owner_name: { userId: user.id, owner, name } },
      update: {},
      create: { userId: user.id, owner, name },
    });

    for (const cp of checkpoints) {
      for (const s of cp.sessions) {
        await prisma.session.upsert({
          where: { repoId_checkpointId_idx: {
            repoId: repo.id, checkpointId: cp.checkpointId, idx: s.index } },
          update: { events: s.events as any, frictionScore: scoreSession(s) },
          create: {
            repoId: repo.id,
            checkpointId: cp.checkpointId,
            idx: s.index,
            strategy: s.strategy,
            branch: s.branch,
            startedAt: new Date(s.startedAt),
            endedAt: s.endedAt ? new Date(s.endedAt) : null,
            filesTouched: s.filesTouched,
            tokenUsage: s.tokenUsage as any,
            events: s.events as any,
            frictionScore: scoreSession(s),
          },
        });
      }
    }
    return prisma.session.findMany({
      where: { repoId: repo.id }, orderBy: { startedAt: "desc" },
    });
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}

function scoreSession(s: any): number { /* see Hour 3 */ return 0; }
```

Wire it in `github.ts`:

```ts
repoRoutes.post("/repos/:owner/:name/ingest", async (req: any, res) => {
  const sessions = await ingestRepo(req.user, req.params.owner, req.params.name);
  res.json(sessions);
});
```

**Sanity check:** point at your pre-seeded demo repo. You should get 3 sessions back.

---

### Hour 3 · 2:00 – 3:00 — Friction + LLM + Frontend shell

**2:00–2:20 — Friction scoring (no LLM)**

`backend/src/analyze.ts` — detection helpers:

```ts
const NEGATIONS = /\b(no|don'?t|stop|wait|revert|that'?s wrong|not that|instead)\b/i;

export function detectCorrections(events: any[]) {
  const out: Array<{ kind: string; intensity: number; text: string; ts: string }> = [];
  for (let i = 0; i < events.length; i++) {
    const e = events[i];
    if (e.type === "user_prompt" && NEGATIONS.test(e.text ?? "")) {
      out.push({ kind: "explicit", intensity: 1, text: e.text, ts: e.ts });
    }
    if (e.type === "tool_call" && (e.exit_code ?? 0) !== 0) {
      // find next tool_call with same tool_name within 60s
      for (let j = i + 1; j < events.length; j++) {
        const n = events[j];
        if (n.type !== "tool_call") continue;
        const dt = new Date(n.ts).getTime() - new Date(e.ts).getTime();
        if (dt > 60_000) break;
        if (n.tool_name === e.tool_name) {
          out.push({ kind: "tool_retry", intensity: 2,
                     text: `${e.tool_name} retry`, ts: e.ts });
          break;
        }
      }
    }
  }
  return out;
}

export function scoreSession(s: any): number {
  const prompts = s.events.filter((e: any) => e.type === "user_prompt").length || 1;
  const total = detectCorrections(s.events).reduce((a, c) => a + c.intensity, 0);
  return total / prompts;
}
```

Clustering (heuristic, no embeddings):

```ts
export function clusterCorrections(all: ReturnType<typeof detectCorrections>) {
  const byKey = new Map<string, { key: string; count: number; samples: string[] }>();
  const STOP = new Set(["the","a","an","to","of","in","is","it","that","this","and","or","no","not","dont","don't"]);
  for (const c of all) {
    const tokens = c.text.toLowerCase().replace(/[^a-z0-9\s]/g, " ")
      .split(/\s+/).filter(t => t && !STOP.has(t));
    const key = tokens.slice(0, 5).sort().join(" ");
    const entry = byKey.get(key) ?? { key, count: 0, samples: [] };
    entry.count++;
    if (entry.samples.length < 3) entry.samples.push(c.text);
    byKey.set(key, entry);
  }
  return [...byKey.values()].sort((a, b) => b.count - a.count).slice(0, 5);
}
```

Good enough for v1. Upgrade to embeddings in v1.1.

**2:20–2:50 — LLM optimize + diff**

```ts
import Anthropic from "@anthropic-ai/sdk";
import { createTwoFilesPatch } from "diff";
import { Octokit } from "@octokit/rest";

const claude = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });

async function fetchInstructionFile(gh: Octokit, owner: string, name: string) {
  for (const path of ["AGENTS.md", "CLAUDE.md"]) {
    try {
      const { data } = await gh.repos.getContent({ owner, repo: name, path });
      if (!Array.isArray(data) && data.type === "file") {
        return { path, text: Buffer.from(data.content, "base64").toString("utf8"), sha: data.sha };
      }
    } catch {}
  }
  return { path: "AGENTS.md", text: "", sha: null };
}

export async function analyzeRepo(user: any, owner: string, name: string) {
  const repo = await prisma.repo.findUniqueOrThrow({
    where: { userId_owner_name: { userId: user.id, owner, name } },
    include: { sessions: { orderBy: { startedAt: "desc" }, take: 3 } },
  });
  const allCorrections = repo.sessions.flatMap(s => detectCorrections(s.events as any[]));
  const clusters = clusterCorrections(allCorrections);
  const fq = repo.sessions.reduce((a, s) => a + s.frictionScore, 0) / Math.max(repo.sessions.length, 1);

  const gh = new Octokit({ auth: user.accessToken });
  const target = await fetchInstructionFile(gh, owner, name);

  const systemPrompt = `You are Reflex.md's instruction optimizer.
Your job: propose minimal, high-signal edits to ${target.path} so an AI coding
agent makes fewer of the mistakes shown in the evidence.

RULES:
1. Never propose source-code changes. Only edit ${target.path}.
2. Every new/changed rule must cite at least one checkpointId from evidence.
3. Prefer rewriting an existing weak rule over adding a new one.
4. Do not delete section headers without replacement.
5. Output STRICT JSON. No prose outside JSON.

SCHEMA:
{
  "afterText": "...full new file contents...",
  "reasoning": [
    { "rule": "string", "checkpointIds": ["..."], "evidenceText": "short quote" }
  ]
}`;

  const userPrompt = `CURRENT ${target.path}:
---
${target.text || "(file does not exist; create it)"}
---

TOP CORRECTION CLUSTERS:
${JSON.stringify(clusters, null, 2)}

EVIDENCE SESSIONS (checkpointId → sample prompts):
${JSON.stringify(repo.sessions.map(s => ({
  checkpointId: s.checkpointId,
  strategy: s.strategy,
  samples: (s.events as any[])
    .filter(e => e.type === "user_prompt")
    .slice(0, 10)
    .map(e => e.text.slice(0, 200)),
})), null, 2)}

Produce the optimized file per the schema. Output JSON only.`;

  const resp = await claude.messages.create({
    model: "claude-sonnet-4-5",                       // or latest sonnet slug
    max_tokens: 4000,
    system: systemPrompt,
    messages: [{ role: "user", content: userPrompt }],
  });

  const jsonText = (resp.content[0] as any).text.trim()
    .replace(/^```(?:json)?\n?/, "").replace(/```$/, "");
  const parsed = JSON.parse(jsonText) as { afterText: string; reasoning: any[] };

  const unifiedDiff = createTwoFilesPatch(
    target.path, target.path, target.text, parsed.afterText);

  return prisma.analysis.create({
    data: {
      repoId: repo.id,
      frictionScore: fq,
      targetFile: target.path,
      beforeText: target.text,
      afterText: parsed.afterText,
      unifiedDiff,
      reasoning: parsed.reasoning as any,
    },
  });
}

export const analyzeRoutes = Router();
analyzeRoutes.post("/repos/:owner/:name/analyze", async (req: any, res) => {
  const a = await analyzeRepo(req.user, req.params.owner, req.params.name);
  res.json(a);
});
```

**2:50–3:00 — Frontend shell**

Configure Vite dev proxy in `frontend/vite.config.ts`:

```ts
server: {
  proxy: {
    "/api":  { target: "http://localhost:3001", changeOrigin: true },
    "/auth": { target: "http://localhost:3001", changeOrigin: true },
  },
}
```

Minimal `frontend/src/api.ts`:

```ts
const base = "";
const j = (r: Response) => r.ok ? r.json() : Promise.reject(r);
export const api = {
  me:      () => fetch(`${base}/api/me`, { credentials: "include" }).then(j),
  repos:   () => fetch(`${base}/api/repos`, { credentials: "include" }).then(j),
  ingest:  (o: string, n: string) =>
    fetch(`${base}/api/repos/${o}/${n}/ingest`, { method: "POST", credentials: "include" }).then(j),
  analyze: (o: string, n: string) =>
    fetch(`${base}/api/repos/${o}/${n}/analyze`, { method: "POST", credentials: "include" }).then(j),
  openPr:  (id: string) =>
    fetch(`${base}/api/analyses/${id}/open-pr`, { method: "POST", credentials: "include" }).then(j),
};
```

`App.tsx` — router + TanStack Query provider. Skeleton for Login, Repos, Repo pages.

---

### Hour 4 · 3:00 – 4:00 — UI polish + PR + demo

**3:00–3:20 — Timeline + SessionRow + EventDrawer**

`components/SessionRow.tsx`:
- Strategy badge, started-at, friction score badge (green/amber/red via thresholds in `brand/METRICS.md`).
- Click → set selected session → Drawer opens.

`components/EventDrawer.tsx`:
- Virtualized not needed for demo (3 sessions × ~50 events). Just a scrolling list.
- `user_prompt` matching `NEGATIONS` regex → red left-border.
- `tool_call` with non-zero exit → amber left-border.
- `agent_response` → muted. `file_write` → small chip.

**3:20–3:40 — DiffView + Open PR**

`components/DiffView.tsx`:

```tsx
import { DiffEditor } from "@monaco-editor/react";

export function DiffView({ analysis, onOpenPr }: { analysis: any; onOpenPr: () => void }) {
  return (
    <div className="flex flex-col h-full">
      <div className="flex items-center justify-between p-3 border-b">
        <div className="font-mono text-sm">{analysis.targetFile}</div>
        <button onClick={onOpenPr} className="btn-primary">
          Open PR
        </button>
      </div>
      <div className="flex-1">
        <DiffEditor
          language="markdown"
          original={analysis.beforeText}
          modified={analysis.afterText}
          options={{ renderSideBySide: true, readOnly: true, minimap: { enabled: false } }}
        />
      </div>
      <div className="border-t p-3 max-h-48 overflow-auto text-sm">
        <div className="font-semibold mb-1">Why</div>
        <ul className="space-y-1">
          {(analysis.reasoning as any[]).map((r, i) => (
            <li key={i}>
              <div className="font-medium">{r.rule}</div>
              <div className="text-muted-foreground italic">"{r.evidenceText}"</div>
              <div className="text-xs font-mono">
                {r.checkpointIds.map((c: string) => c.slice(0, 8)).join(", ")}
              </div>
            </li>
          ))}
        </ul>
      </div>
    </div>
  );
}
```

**3:40–3:50 — Open PR endpoint**

```ts
analyzeRoutes.post("/analyses/:id/open-pr", async (req: any, res) => {
  const a = await prisma.analysis.findUniqueOrThrow({
    where: { id: req.params.id }, include: { repo: true },
  });
  const gh = new Octokit({ auth: req.user.accessToken });
  const { owner, name } = a.repo;

  // 1. default branch ref
  const { data: repo } = await gh.repos.get({ owner, repo: name });
  const base = repo.default_branch;
  const { data: baseRef } = await gh.git.getRef({ owner, repo: name, ref: `heads/${base}` });
  const baseSha = baseRef.object.sha;
  const { data: baseCommit } = await gh.git.getCommit({ owner, repo: name, commit_sha: baseSha });

  // 2. blob + tree + commit
  const { data: blob } = await gh.git.createBlob({
    owner, repo: name,
    content: Buffer.from(a.afterText).toString("base64"),
    encoding: "base64",
  });
  const { data: tree } = await gh.git.createTree({
    owner, repo: name,
    base_tree: baseCommit.tree.sha,
    tree: [{ path: a.targetFile, mode: "100644", type: "blob", sha: blob.sha }],
  });
  const { data: commit } = await gh.git.createCommit({
    owner, repo: name,
    message: `Reflex: update ${a.targetFile}`,
    tree: tree.sha,
    parents: [baseSha],
  });

  // 3. branch
  const branch = `reflex/update-${a.targetFile.replace(".", "-")}-${a.id.slice(0, 8)}`;
  await gh.git.createRef({
    owner, repo: name, ref: `refs/heads/${branch}`, sha: commit.sha,
  });

  // 4. PR
  const body = renderPrBody(a);
  const { data: pr } = await gh.pulls.create({
    owner, repo: name, title: `Reflex: update ${a.targetFile}`,
    head: branch, base, body,
  });

  await prisma.analysis.update({
    where: { id: a.id },
    data: { prNumber: pr.number, prUrl: pr.html_url },
  });
  res.json({ prUrl: pr.html_url, prNumber: pr.number });
});

function renderPrBody(a: any) {
  const lines = [
    `## Reflex.md proposal`,
    ``,
    `Updates \`${a.targetFile}\` based on friction detected across the last 3 sessions.`,
    ``,
    `**Headline Friction Quotient:** ${a.frictionScore.toFixed(2)}`,
    ``,
    `### Why`,
    ...(a.reasoning as any[]).map(r =>
      `- **${r.rule}** — "${r.evidenceText}" (checkpoints: ${r.checkpointIds.map((c: string) => c.slice(0, 8)).join(", ")})`),
    ``,
    `<sub>Generated by Reflex.md · auditable against \`entire/checkpoints/v1\`.</sub>`,
  ];
  return lines.join("\n");
}
```

**3:50–4:00 — Demo dry-run + record**

1. `docker compose up -d` → `pnpm dev` in both folders.
2. Browser → `/` → Login with GitHub → lands on `/repos`.
3. Pick demo repo → Ingest spinner → Timeline loads.
4. Click Analyze → LLM runs → Diff appears.
5. Click Open PR → PR opens on GitHub in a new tab.
6. Screen-record with QuickTime.

---

## 6. Cut list (in strict cut-order if you fall behind)

Drop these IN THIS ORDER without refactoring anything:

1. **Reasoning panel in DiffView** — show the diff only.
2. **Clustering** — send raw correction list to the LLM; let it cluster internally.
3. **Event drawer** — timeline rows stay, events hidden.
4. **Correction highlighting** in the drawer — plain list.
5. **TanStack Query** — use plain `useEffect` + `useState`.
6. **shadcn components** — raw Tailwind `<button>` / `<div>`.
7. **Friction score badge** — show the raw number, no colors.

If you're still behind after all 7 cuts, the minimal viable demo is:
**Login → pick repo → ingest → button that opens a PR with LLM-proposed AGENTS.md.** No timeline, no UI polish.

---

## 7. Risk register + mitigations

| Risk | Probability | Impact | Mitigation |
|---|---|---|---|
| Parser breaks on unexpected `full.jsonl` shape | Med | High | Wrap per-line `JSON.parse` in try/catch; skip bad lines. Test against 2+ real checkpoints. |
| Anthropic rate limit / 429 | Low | High | One call per analysis; keep an OpenAI fallback key ready. |
| GitHub OAuth redirect loop | Med | Med | Verify callback URL matches exactly in OAuth App settings. Test with incognito. |
| LLM returns non-JSON | High | Med | Strip markdown fences; on parse fail, re-prompt with "output valid JSON only". |
| Diff exceeds 30% of file | Med | Low | Skip the guard; show the diff anyway. Human reviews the PR. |
| Git clone fails (auth) | Low | High | Token URL format: `https://x-access-token:<TOKEN>@github.com/owner/name.git`. Test before demo. |
| Demo repo has no entire branch | Critical | Demo-blocking | Pre-seed + verify the branch exists ahead of time. (See §8.) |
| Running long | High | High | Follow the cut list in §6 the moment you're 15 min behind. |

---

## 8. Pre-work (BEFORE the 4-hour clock starts)

**Do these the night before.** Not in the 4 hours.

1. **Register GitHub OAuth App:**
   - github.com/settings/developers → New OAuth App.
   - Name: `Reflex.md (local)`.
   - Homepage URL: `http://localhost:5173`.
   - Callback URL: `http://localhost:3001/auth/github/callback`.
   - Copy client ID + generate client secret → save to `.env`.

2. **Get Anthropic API key** → save to `.env`.

3. **Seed demo repo:**
   - Create `github.com/<you>/reflex-demo` (public or private — you have the token).
   - Commit a minimal `src/` with 2–3 TS files.
   - Commit a simple `AGENTS.md` with 3–4 bullet rules (e.g., "use named exports", "no `any`", "tests under `__tests__/`").
   - **Generate `entire/checkpoints/v1` content.** Two paths:
     - **Real:** run `entire-cli` 3× locally against the repo, each time prompt an agent (Claude Code / Cursor) and in at least 2 of the 3 sessions, tell the agent "no, don't use barrel exports — import directly" (or any other repeatable correction). Push the shadow branch.
     - **Fabricated (fallback if `entire-cli` misbehaves):** hand-write 3 fake checkpoints matching the schema in `brand/TRANSCRIPT_FORMAT.md` with planted corrections. Commit to a `entire/checkpoints/v1` branch. Faster, deterministic, totally fine for the demo.

4. **Verify the clone works:**
   ```bash
   git clone --depth 1 --branch entire/checkpoints/v1 \
     https://x-access-token:<YOUR_PAT>@github.com/<you>/reflex-demo.git /tmp/test-clone
   ```
   If this fails, the whole plan fails. Fix it now, not during the 4 hours.

5. **Tooling:** Node 20+, pnpm, Docker Desktop running.

6. **Paper dry run:** walk through the demo script in §9 on paper. Identify any step where you don't know exactly which command to run.

---

## 9. Demo script (90 seconds)

> Practice this until it's muscle memory. The demo is the deliverable.

1. "Every AI-assisted developer pays the Correction Tax — you tell the agent the same thing three times a week and nothing sticks."
2. "Reflex.md reads the transcripts `entire-cli` already captures and opens a PR that teaches the agent the rule."
3. *(Click Install / Login)* "I log in with GitHub…"
4. *(Pick demo repo)* "…pick my repo, and Reflex pulls the last 3 sessions."
5. *(Timeline renders)* "Red badges are high-friction sessions. I can drill into any session and see the exact prompts."
6. *(Click a red row, show correction)* "Here I told Claude 'don't use barrel exports'. Here's the same correction two days later. Same correction last week."
7. *(Click Analyze)* "Reflex spots the pattern, reads my `AGENTS.md`, and proposes an edit."
8. *(Diff View opens)* "One new rule. Cites the exact three checkpoints as evidence."
9. *(Click Open PR, switch to GitHub tab)* "PR on GitHub, auditable reasoning in the body. I merge. Next time my agent won't make the mistake."
10. "That's Reflex.md. Instructions that learn from your mistakes."

---

## 10. Definition of done (v1)

All six MUST hold at the 4-hour mark:

- [ ] I can log in with GitHub from the landing page.
- [ ] I can pick a repo from a list and trigger an ingest.
- [ ] The timeline shows 3 sessions with friction scores > 0.
- [ ] Clicking Analyze produces a Monaco diff on `AGENTS.md` or `CLAUDE.md`.
- [ ] The diff contains a rule that clearly responds to the planted correction.
- [ ] Clicking Open PR produces a real PR on GitHub with reasoning in the body.

If any one of these is failing at the 4-hour mark, the demo isn't real. Do the cut list in §6.
