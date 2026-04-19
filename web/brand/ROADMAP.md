# Roadmap

## MVP (hackathon demo, web-only)

Four features, nothing more:

1. **GitHub connect** — install App, pick repo, verify `entire/checkpoints/v1` exists.
2. **Transcript ingest + display** — parse last 3 checkpoints, render Session Timeline + Event Drawer.
3. **Friction detection** — classify, cluster, score; render Friction Report.
4. **PR on `AGENTS.md` / `CLAUDE.md`** — Diff View + Open PR button.

### Build order (14-hour cut)

| Hour | Milestone |
|---|---|
| 0–2 | Monorepo skeleton (pnpm workspaces), Prisma schema, Tailwind + shadcn. |
| 2–5 | `packages/parser` against fixture checkpoints. **Risky piece — ship first.** |
| 5–7 | GitHub App: register, install flow, installation-token clone. |
| 7–10 | Analysis pipeline: classifier + clusterer + Sonnet rewrite with prompt caching. |
| 10–12 | UI: Repos picker → Timeline → Diff View → Open PR. |
| 12–13 | E2E against a pre-seeded demo repo with obvious correction patterns. |
| 13–14 | Polish + record demo video. |

### Demo script

1. Visit landing page → **Install on GitHub**.
2. Pick the demo repo (pre-seeded with `entire-cli` checkpoints containing a "don't use barrel exports" correction across three sessions).
3. Timeline loads: three sessions, red friction badges on two of them.
4. Click into a session → Event Drawer shows the exact correction prompt highlighted red.
5. Click **Analyze** → Friction Report renders with one cluster: "barrel exports discouraged" (3 sessions).
6. Click **Propose instruction update** → Monaco diff shows a new bullet added to `AGENTS.md`. Reasoning panel cites the three checkpoint IDs.
7. Click **Open PR** → PR appears on GitHub, body includes the reasoning trace.
8. Fin.

## Explicit non-goals (v1)

- ❌ Electron desktop app (the `electron/` folder stays empty for now).
- ❌ Continuous monitoring — analyze is on-demand only.
- ❌ `.cursorrules`, `.github/copilot-instructions.md`, per-directory `AGENTS.md`.
- ❌ Source-code changes of any kind.
- ❌ Multi-tenant auth, orgs, billing.
- ❌ Instruction Density / Recency **dashboards** (metrics computed, not surfaced).
- ❌ Coach panel / lazy-prompt nudges.
- ❌ Cloud deploy. Local `docker-compose` + `pnpm dev` only.

## v1.1 (post-hackathon, ~1–2 weeks)

- **Continuous mode** — webhook on shadow-branch `push` auto-enqueues ingest.
- **Per-directory `AGENTS.md`** — promotion engine writes to `src/<dir>/AGENTS.md` when L2.
- **`.cursorrules` + copilot-instructions** — routing in the optimizer extends to more target files.
- **History view** — "what did Reflex propose last month?", merged PR outcomes, `Pattern.supportCount` over time.

## v2 (quarter horizon)

- **Instruction Density + Recency dashboards** with trend lines.
- **Coach panel** — inline nudge when Reflex detects a lazy prompt *live* (requires browser extension or Electron wrapper — hence why `electron/` exists in the repo plan).
- **Team mode** — org-level install, per-member friction leaderboards, aggregated correction clusters with privacy controls.
- **Custom rubrics** — teams define their own correction signals and severity weights.
- **Agent-builder API** — Ada's persona consumes aggregated, anonymized patterns programmatically.

## Explicit "probably never" list

Protect the product from feature creep:

- Running the agents ourselves. We are a consumer of transcripts, not a competitor to Claude Code / Cursor.
- Re-implementing `entire-cli`. If `entire`'s format changes, we update [`TRANSCRIPT_FORMAT.md`](./TRANSCRIPT_FORMAT.md) and the parser.
- Proposing source-code changes. If we cross that line, we become yet another AI code-review tool; market is crowded; different value prop.
