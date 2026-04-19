# PRD — Reflex.md (Web, v1)

## Scope (hard fence)

Reflex.md v1 is a **web app only**. Four features:

1. **GitHub connect** — user installs the Reflex.md GitHub App on a repo.
2. **Transcript ingest & display** — parse `entire/checkpoints/v1` and render it.
3. **Friction analysis** — detect repetitive corrections, score them, surface them.
4. **Instruction-file PR** — open a PR on `AGENTS.md` / `CLAUDE.md` with the proposed fix.

Everything else is out of scope. See [`ROADMAP.md`](./ROADMAP.md).

## What we never touch

- Source code. Reflex only proposes edits to `AGENTS.md` and `CLAUDE.md`.
- `.cursorrules`, per-directory `AGENTS.md`, and other variants — v2.
- The user's terminal. All ingestion is server-side from the shadow branch.

## Feature spec

### F1 — Connect a repo

- User clicks **"Install on GitHub"** → GitHub App flow → callback to `/onboarding`.
- We list the repos the installation covers and let the user pick one.
- Backend verifies that the chosen repo has an `entire/checkpoints/v1` branch.
  - If missing → show "Install entire-cli first" CTA with a doc link.
- First ingest + analysis kicks off automatically.

### F2 — Display the `entire` log

- **Session Timeline** page: one row per session (latest 3 for MVP).
- Row shows: strategy (claude-code / cursor / copilot / gemini), start time, duration, files-touched count, friction badge.
- Clicking a row opens an **Event Drawer** with the parsed `full.jsonl` events:
  - User prompts, agent responses (truncated), tool calls with exit codes, file writes.
  - Corrections highlighted red; tool retries amber; successful first-tries green.
- Uses a virtualized list — `full.jsonl` can be thousands of events.

### F3 — Repetitive-issue detection

- On Analyze click (or auto on first ingest), the pipeline in [`ANALYSIS_ENGINE.md`](./ANALYSIS_ENGINE.md) runs.
- Output rendered as a **Friction Report** panel:
  - Top correction clusters (semantic grouping) with count + severity.
  - Dead-context candidates (rules in `AGENTS.md` nobody references anymore).
  - Lazy-prompt count (informational; no v1 action).
- Each cluster expands to show the exact prompts / tool failures that evidence it.

### F4 — Open a PR

- A **"Propose instruction update"** CTA lives at the top of the Friction Report.
- Clicking it opens the **Diff View**: side-by-side Monaco diff of current vs proposed `AGENTS.md` / `CLAUDE.md` + a reasoning panel citing checkpoint IDs.
- **"Open PR"** button:
  - Creates a branch `reflex/update-agents-md-<shortId>` on the target repo using the installation token.
  - Writes the proposed file content.
  - Opens a PR whose body contains the reasoning trace + links back to source sessions.
- On PR merge (webhook): mark proposal `shipped`, bump `Pattern.supportCount`.

## Correction signals (taxonomy)

1. **Explicit correction** — prompt contains negation patterns: "no", "stop", "don't", "that's wrong", "revert", etc. Intensity = 1.
2. **Implicit correction** — user edits a file the agent wrote within N minutes (diff-distance signal). Intensity = 3.
3. **Tool-failure recovery** — command exits non-zero; agent retries with different args. Intensity = 2. Strong signal for missing docs.
4. **Manual `git revert` / `git reset`** — Intensity = 5. Highest weight.

Formulas in [`METRICS.md`](./METRICS.md).

## Which file does a rule go into?

- **Claude-specific guidance** (references Claude's tools, `<thinking>` tags, etc.) → `CLAUDE.md`.
- **Universal rule** → `AGENTS.md`.
- Repo only has one → write to that one.
- Repo has neither → create `AGENTS.md`.

## Promotion rules (Hierarchical Summarization)

- **L3 → L2:** same pattern observed in ≥ 3 sessions in the same directory.
- **L2 → L1:** pattern spans ≥ 2 directories AND ≥ 5 sessions.
- **Decay:** an L1 rule not referenced / not violated for 30 days → flagged as Dead Context.

## Privacy & safety

- We redact **on top of** `entire`'s redaction. Defense-in-depth regex pass for common key formats (AWS, GitHub PATs, Stripe, generic `sk-` / `ghp_`) before anything touches the LLM.
- Every Reflex-proposed edit carries a **reasoning trace** on the PR body: which checkpoints, which prompts, which tool failures. Fully auditable.
- Guardrails on generated diffs:
  - Must not exceed 30% of file size.
  - Must not delete section headers without replacement.
  - Must parse as valid markdown.
  - Must apply cleanly with `git apply` in a dry run.

## Explicit non-goals (v1)

- Multi-tenant auth beyond GitHub login.
- Continuous monitoring — on-demand "Analyze" button only.
- Editing `.cursorrules`, nested `AGENTS.md`, or any non-root instruction file.
- A "Coach" panel that nudges the user about lazy prompts.
- Instruction Density + Recency dashboards (formulas defined but not surfaced).
- Writing PRs that change source code.

See [`ROADMAP.md`](./ROADMAP.md) for what lands after MVP.
