# Architecture — Web v1

Everything runs on the laptop for the hackathon. No Vercel/Railway. `docker-compose up` gives Postgres + Redis; `pnpm dev` runs the app.

## System diagram

```
                     ┌──────────────────────────┐
                     │  Browser (React SPA)     │
                     │  apps/web                │
                     └────────────┬─────────────┘
                                  │ HTTP + WS
                                  ▼
                     ┌──────────────────────────┐
                     │  Hono server (apps/api)  │
                     │  - REST                  │
                     │  - WS (analysis.ready)   │
                     │  - Probot webhooks       │
                     └─┬────────────┬──────────┘
                       │            │ enqueues
                       │            ▼
                       │  ┌──────────────────────┐
                       │  │  BullMQ workers       │
                       │  │  (apps/worker)        │
                       │  │  - ingest             │
                       │  │  - analyze            │
                       │  └────┬───────────┬──────┘
                       │       │           │
      ┌────────────────┴───┐  ┌▼─────────┐ │
      │ GitHub (App + API) │  │ Postgres │ │ Redis queue
      │ - installation tok │  │ (Prisma) │ │
      │ - clone shadow br  │  └──────────┘ │
      │ - open PR          │                │
      └────────────────────┘   Anthropic ◄──┘
                                (Claude)
```

## Stack (deliberate choices)

| Layer | Choice | Why |
|---|---|---|
| Frontend | Vite + React + TS + Tailwind + shadcn/ui + Monaco diff | Fastest DX; Monaco handles markdown diffs gracefully. |
| Backend | Node + TS, **Hono** | Minimal, fast, runs equally well local or edge. |
| ORM | **Prisma** + Postgres | Zero-hassle migrations in a 14-hour build. |
| Queue | **BullMQ** + Redis | Ingest and analyze are slow; must be async. |
| GitHub App runtime | **Probot** | Handles App auth, webhook verification, installation tokens. Don't roll our own. |
| Git ops | **`simple-git`** (shell wrapper) | Shallow + sparse clone with `--filter=blob:none`. |
| LLM | **Anthropic Claude** — Haiku 4.5 (classify) + Sonnet 4.6 (optimize) | Prompt caching materially cuts cost since the rubric is static. |
| Embeddings | OpenAI `text-embedding-3-small` (cheapest viable) | For correction clustering + rule recency. |

## Monorepo layout (pnpm workspaces)

```
web/
├── apps/
│   ├── web/        # Vite React SPA
│   ├── api/        # Hono server + Probot
│   └── worker/     # BullMQ workers (ingest, analyze)
├── packages/
│   ├── parser/     # parseCheckpoint(dir) — pure fn, unit-tested
│   └── shared/     # TS types mirroring Prisma
├── prisma/
│   └── schema.prisma
├── docker-compose.yml  # postgres + redis
├── .env.example
└── brand/          # you are here
```

> **Note:** this monorepo lives inside the `web/` folder of the Reflex.md repo, per the scope fence.

## Services

### 1. `apps/web` — React SPA

Three screens:

- **/onboarding** — GitHub App install + repo picker.
- **/repos/:repoId/timeline** — Session Timeline (virtualized list, friction badges).
- **/repos/:repoId/analyses/:id/diff** — Monaco side-by-side diff + reasoning panel + "Open PR" CTA.

State: TanStack Query for server state; small Zustand store for UI.

### 2. `apps/api` — Hono server

REST endpoints:

| Method | Path | Purpose |
|---|---|---|
| `POST` | `/repos/:id/analyze` | Enqueue an `analyze` job. |
| `GET` | `/repos/:id/timeline` | Sessions + FQ summary for last N checkpoints. |
| `GET` | `/repos/:id/sessions/:sid/events` | Paginated events for the drawer. |
| `GET` | `/analyses/:id` | Friction report + diff payload. |
| `POST` | `/analyses/:id/open-pr` | Creates the PR; returns PR URL. |
| `GET` | `/auth/github/callback` | OAuth callback (identify user). |
| `POST` | `/webhooks/github` | Probot webhook handler. |

WebSocket channel: `/ws/analyses/:id` → pushes `analysis.ready`.

### 3. `apps/worker` — BullMQ workers

- **`ingest` worker** — `{ installationId, repoId }`:
  1. Mint installation token.
  2. Shallow + sparse-clone `entire/checkpoints/v1` into a temp dir.
  3. Walk sharded checkpoint dirs (last 3 by `created_at`).
  4. Parse with `@reflex/parser`.
  5. Upsert Checkpoint / Session / Event rows (idempotent on `checkpoint_id`).
  6. Wipe temp dir.

- **`analyze` worker** — `{ repoId }`:
  1. Load last 3 parsed sessions + current `AGENTS.md` / `CLAUDE.md`.
  2. Run pipeline per [`ANALYSIS_ENGINE.md`](./ANALYSIS_ENGINE.md).
  3. Persist `Analysis` row; emit `analysis.ready`.

Both workers are **idempotent** and restartable. Failures re-queue with exponential backoff; after 3 fails → dead-letter queue + UI surface.

### 4. `packages/parser`

Pure function, no I/O beyond reading files it's pointed at:

```ts
parseCheckpoint(dir: string): Checkpoint
```

Unit-tested against fixture checkpoints in `packages/parser/test/fixtures/`. Contract frozen per [`TRANSCRIPT_FORMAT.md`](./TRANSCRIPT_FORMAT.md).

## Data model

```prisma
model User {
  id              String   @id @default(cuid())
  githubLogin     String   @unique
  installationId  Int?
  createdAt       DateTime @default(now())
  repos           Repo[]
}

model Repo {
  id             String   @id @default(cuid())
  userId         String
  owner          String
  name           String
  defaultBranch  String
  checkpoints    Checkpoint[]
  patterns       Pattern[]
  analyses       Analysis[]
  @@unique([userId, owner, name])
}

model Checkpoint {
  id             String   @id                // = checkpoint_id
  repoId         String
  createdAt      DateTime
  tokenUsage     Json
  filesTouched   String[]
  sessions       Session[]
}

model Session {
  id             String   @id @default(cuid())
  checkpointId   String
  index          Int
  strategy       String
  startedAt      DateTime
  endedAt        DateTime?
  rawEventsPath  String                      // pointer to stored full.jsonl (S3 later; disk for hackathon)
  events         Event[]
  corrections    Correction[]
  @@unique([checkpointId, index])
}

model Event {
  id         String   @id @default(cuid())
  sessionId  String
  ts         DateTime
  type       String
  role       String?
  text       String?
  toolName   String?
  exitCode   Int?
  raw        Json
}

model Correction {
  id         String   @id @default(cuid())
  sessionId  String
  kind       String                          // explicit | implicit | tool_retry | revert
  intensity  Int
  promptId   String?
  evidence   Json
}

model Pattern {
  id            String   @id @default(cuid())
  repoId        String
  level         Int                          // 1, 2, 3
  scopeDir      String?                      // null at L1
  rule          String
  supportCount  Int      @default(1)
  firstSeen     DateTime @default(now())
  lastSeen      DateTime @default(now())
}

model Analysis {
  id              String   @id @default(cuid())
  repoId          String
  createdAt       DateTime @default(now())
  frictionScore   Float
  proposedMdPath  String                     // "AGENTS.md" | "CLAUDE.md"
  proposedDiff    String                     // unified diff
  afterText       String                     // full new file content
  reasoning       Json                       // reasoning[] from LLM
  status          String   @default("ready") // ready | shipped | closed
  pullRequest     PullRequest?
}

model PullRequest {
  id              String   @id @default(cuid())
  analysisId      String   @unique
  githubPrNumber  Int
  status          String   @default("open")  // open | merged | closed
  createdAt       DateTime @default(now())
}
```

## Environments

- **Local only** for v1. `docker-compose up` → Postgres + Redis. `pnpm dev` → web + api + worker in parallel (turborepo or `concurrently`).
- `smee.io` for webhook forwarding.
- GitHub App: separate **dev** app registered against the smee URL.
