# PLAN_V1.md — Reflex.md v1 Execution Plan

> **Goal:** ship a working end-to-end demo of Reflex.md. Connect GitHub → parse `entire/checkpoints/v1` → detect repeated corrections → open a PR against `AGENTS.md` / `CLAUDE.md`.
>
> **Locked decisions** (from planning):
> - Landing page copies **devlog** aesthetic verbatim (neon green `#00ff41` on zinc-950, JetBrains Mono + Space Grotesk).
> - Dashboard uses **shadcn/ui** themed against Tailwind v4 `@theme` tokens shared with the landing page.
> - LLM is **Gemini** via `@google/genai`. Primary slug `gemini-3.1-flash` currently 404s — **live flow runs on `gemini-2.5-flash`** (verified via `scripts/gemini-smoke.ts`).
> - Frontend on `:3000`, backend on `:3001`, Postgres on `:5432`.
> - GitHub OAuth App (not App). Homepage `http://localhost:3000`, Callback `http://localhost:3001/auth/github/callback`.

---

## 0. Stack

| Layer | Choice |
|---|---|
| DB | Postgres 16 (docker) |
| ORM | Prisma |
| Backend | Node 20 + TS + Express |
| Frontend | Vite + React 19 + TS + Tailwind v4 + shadcn/ui |
| Diff viewer | `@monaco-editor/react` DiffEditor |
| Git | `simple-git` |
| GitHub API | `@octokit/rest` |
| Auth | GitHub OAuth (user token) + JWT cookie |
| LLM | `@google/genai` — `gemini-3.1-flash` |
| Queue | None (synchronous) |

---

## 1. Folder layout

```
web/
├── PLAN_V1.md
├── docker-compose.yml
├── .env.example / .env
├── brand/                         ← reference docs
├── backend/
│   ├── package.json
│   ├── tsconfig.json
│   ├── prisma/schema.prisma
│   ├── scripts/smoke.sh
│   ├── test/
│   │   ├── parser.test.ts
│   │   └── fixtures/checkpoint-barrel/…
│   └── src/
│       ├── server.ts
│       ├── prisma.ts
│       ├── auth.ts
│       ├── parser.ts
│       ├── ingest.ts
│       ├── friction.ts
│       ├── llm.ts
│       ├── analyze.ts
│       ├── github.ts
│       └── types.ts
└── frontend/
    ├── package.json
    ├── vite.config.ts               ← port 3000, proxy /api + /auth
    ├── index.html
    ├── components.json
    └── src/
        ├── main.tsx / App.tsx
        ├── index.css                ← Tailwind v4 + @theme (ported from devlog)
        ├── api.ts
        ├── lib/utils.ts
        ├── components/
        │   ├── ui/                  ← shadcn primitives
        │   ├── landing/             ← Navbar, Hero, TerminalDemo, Features, Marquee, CTA, Footer
        │   └── dashboard/           ← SessionRow, Timeline, FrictionReport, DiffView, OpenPrDialog
        └── pages/
            ├── Landing.tsx          ← `/`
            ├── Repos.tsx            ← `/repos`
            └── Repo.tsx             ← `/repos/:owner/:name`
```

---

## 2. Data model

4 tables — `User`, `Repo`, `Session`, `Analysis`. Events live as JSON on `Session.events`.

```prisma
model User {
  id          String   @id @default(cuid())
  githubLogin String   @unique
  accessToken String
  createdAt   DateTime @default(now())
  repos       Repo[]
}

model Repo {
  id            String    @id @default(cuid())
  userId        String
  user          User      @relation(fields: [userId], references: [id])
  owner         String
  name          String
  defaultBranch String    @default("main")
  sessions      Session[]
  analyses      Analysis[]
  @@unique([userId, owner, name])
}

model Session {
  id            String    @id @default(cuid())
  repoId        String
  repo          Repo      @relation(fields: [repoId], references: [id])
  checkpointId  String
  idx           Int
  strategy      String
  branch        String?
  startedAt     DateTime
  endedAt       DateTime?
  filesTouched  String[]
  tokenUsage    Json
  events        Json
  frictionScore Float     @default(0)
  @@unique([repoId, checkpointId, idx])
}

model Analysis {
  id            String   @id @default(cuid())
  repoId        String
  repo          Repo     @relation(fields: [repoId], references: [id])
  createdAt     DateTime @default(now())
  frictionScore Float
  targetFile    String
  beforeText    String   @db.Text
  afterText     String   @db.Text
  unifiedDiff   String   @db.Text
  reasoning     Json
  clusters      Json
  prNumber      Int?
  prUrl         String?
}
```

---

## 3. API surface (8 endpoints)

| Method | Path | Purpose |
|---|---|---|
| GET  | `/auth/github`          | Redirect to GitHub authorize |
| GET  | `/auth/github/callback` | Exchange code → JWT cookie → redirect `/repos` |
| POST | `/auth/logout`          | Clear cookie |
| GET  | `/api/me`               | Current user |
| GET  | `/api/repos`            | List user's GitHub repos |
| POST | `/api/repos/:owner/:name/ingest`  | Clone shadow branch, parse, upsert, return sessions |
| POST | `/api/repos/:owner/:name/analyze` | Friction + Gemini, return Analysis + clusters |
| POST | `/api/analyses/:id/open-pr`       | Create branch + PR, return `{prUrl, prNumber}` |

---

## 4. Theme (Tailwind v4 `@theme` ported from devlog)

- Tokens identical to devlog: `--color-green: #00ff41`, `--color-bg-primary: #0a0a0a`, `--color-bg-card: #111111`, etc.
- shadcn CSS-var bridge added inside the same `@theme` block so shadcn primitives inherit the devlog palette without forking components.
- Fonts: `JetBrains Mono` (mono) + `Space Grotesk` (display).
- Utilities ported: `btn-clip`, `hero-glow`. Keyframes: `pulse-dot`, `blink`, `marquee`.

---

## 5. Friction detection

- `detectCorrections(events)` — flags `user_prompt` matching negation regex (intensity 1) and `tool_call` with non-zero exit followed by same `tool_name` within 60s (intensity 2).
- `scoreSession(events)` — `Σ intensity / max(prompts, 1)`. Thresholds per `brand/METRICS.md`: `<0.3` green, `<0.8` amber, `≥0.8` red.
- `clusterCorrections(all)` — stopword-filter then sort+join first 5 tokens as cluster key. Return top 5 with count and up to 3 sample texts.

---

## 6. Gemini adapter

```ts
import { GoogleGenAI } from "@google/genai";
const ai = new GoogleGenAI({ apiKey: process.env.GEMINI_API_KEY! });

const models = ["gemini-3.1-flash", "gemini-2.5-flash"];
for (const m of models) {
  try {
    return await ai.models.generateContent({
      model: m,
      config: {
        systemInstruction: SYSTEM_PROMPT,
        responseMimeType: "application/json",
        responseSchema: OUTPUT_SCHEMA,
      },
      contents: userPrompt,
    });
  } catch (e) { continue; }
}
```

System prompt per `brand/ANALYSIS_ENGINE.md`: never touch source; every rule cites a checkpointId; prefer rewriting existing rules over adding new ones.

---

## 7. Hour-by-hour

| Window | Task |
|---|---|
| 0:00–0:15 | Scaffold backend & frontend, docker compose up, kill stale :3000 |
| 0:15–0:25 | Prisma schema + `migrate dev`, `.env` populated |
| 0:25–0:55 | Parser + Vitest + fabricated fixtures |
| 0:55–1:15 | Push fixtures to `<you>/reflex-demo` on `entire/checkpoints/v1` |
| 1:15–1:40 | OAuth, `/api/me`, `/api/repos` |
| 1:40–2:05 | Ingest endpoint |
| 2:05–2:25 | Friction + Gemini + `/analyze` |
| 2:25–2:50 | Landing port from devlog (Reflex copy) |
| 2:50–3:15 | Dashboard shell (Repos + Repo 3-panel) |
| 3:15–3:35 | FrictionReport + DiffView |
| 3:35–3:50 | Open PR endpoint + dialog |
| 3:50–4:00 | Manual test run + record |

---

## 8. Cut list (in order)

1. FrictionReport panel
2. Reasoning list under diff
3. Terminal demo animation on landing
4. Marquee
5. shadcn polish (raw Tailwind using same tokens)
6. Landing entirely — redirect `/` to `/auth/github`

---

## 9. Automated tests

- `backend/test/parser.test.ts` (Vitest) — asserts checkpoint ID, session count, event parsing, tolerates malformed JSONL line.
- `backend/scripts/smoke.sh` — `/api/health` 200, `/api/me` 401 without cookie.

## 10. Manual test checklist

### A. Setup
- [ ] `docker compose up -d` → Postgres healthy on `:5432`
- [ ] `pnpm --filter backend dev` logs `api on 3001`
- [ ] `pnpm --filter frontend dev` logs `Local: http://localhost:3000`
- [ ] `/api/health` returns `{ ok: true }`

### B. Landing
- [ ] Hero renders with green glow + pulse-dot status
- [ ] Terminal demo shows blinking cursor
- [ ] Features grid: 4 cards, hover raises green shadow
- [ ] Marquee scrolls; pauses on hover
- [ ] No console errors

### C. Auth
- [ ] "Install on GitHub" → redirects to GitHub authorize
- [ ] Authorize → lands on `/repos` with session cookie set (httpOnly)
- [ ] `/api/me` returns your login
- [ ] Incognito `/api/me` → 401
- [ ] `/auth/logout` clears cookie

### D. Repo picker
- [ ] `/repos` shows shadcn card grid
- [ ] Demo repo appears with pushed-at + private badge
- [ ] Click repo → `/repos/:owner/:name`

### E. Ingest
- [ ] Ingest auto-fires on first visit (or click button)
- [ ] Skeleton shows for 5–30s
- [ ] Left timeline lists 3 sessions, newest first
- [ ] Strategy badge, time, FQ badge per row
- [ ] ≥2 of 3 sessions show amber/red FQ
- [ ] Re-running doesn't duplicate rows
- [ ] Repo without shadow branch → friendly error

### F. Analyze
- [ ] Click Analyze → loading state
- [ ] Within ~15s, FrictionReport shows ≥1 cluster referencing barrel/exports
- [ ] DiffView renders side-by-side diff on AGENTS.md
- [ ] Proposed addition mentions barrel exports
- [ ] Reasoning cites ≥1 checkpoint ID present in timeline
- [ ] Re-clicking Analyze creates new Analysis row

### G. Open PR
- [ ] Click Open PR → dialog appears
- [ ] Within ~5s dialog shows success state with PR URL
- [ ] URL opens GitHub PR
- [ ] PR body has friction score, Why section, samples, checkpoint IDs
- [ ] PR diff matches Monaco view
- [ ] Branch named `reflex/update-AGENTS-md-<8char>`
- [ ] Re-clicking Open PR returns existing PR (no duplicate)

### H. Failure modes
- [ ] Gemini missing key → toast error, no crash
- [ ] No push access → readable error
- [ ] Backend down → skeletons then error state
- [ ] Hard refresh on `/repos/:o/:n` restores state

### I. Visual parity
- [ ] Green `#00ff41` consistent across landing and dashboard
- [ ] JetBrains Mono + Space Grotesk loaded
- [ ] `btn-clip` clip-path renders
- [ ] Scrollbar green-on-black

---

## 11. Risks

| Risk | Mitigation |
|---|---|
| Gemini model slug unrecognized | Try `gemini-3.1-flash` first, fall back to `gemini-2.5-flash`. Log active model. |
| Port 3000 busy | `lsof -ti:3000 \| xargs kill -9` in dev script. |
| shadcn vs devlog token clash | CSS-var bridge inside `@theme` — test `<Button>` rendering. |
| Parser breaks on unexpected JSONL | Per-line try/catch; skip malformed lines. Vitest covers it. |
| OAuth redirect loop | Verify callback matches exactly. Test in incognito. |

---

## 12. Definition of done

- [ ] Landing page renders with devlog aesthetic.
- [ ] Login with GitHub lands on `/repos`.
- [ ] Demo repo ingest returns 3 sessions with FQ scores.
- [ ] Analyze produces Monaco diff + cluster mentioning barrel exports.
- [ ] Open PR creates a real PR on GitHub with reasoning body.
- [ ] Parser Vitest suite green.
- [ ] Manual checklist A–I walked with no P0 red.
