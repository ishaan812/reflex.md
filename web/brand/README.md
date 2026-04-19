# Reflex.md — `brand/` docs

Source-of-truth context for humans and agents building Reflex.md. Every file is skim-first. Cross-links point back to [`GLOSSARY.md`](./GLOSSARY.md) so terms are defined once.

## Read order

1. [`VISION.md`](./VISION.md) — why this exists, in one page.
2. [`PRD.md`](./PRD.md) — what we're building (web-app scope).
3. [`PERSONAS.md`](./PERSONAS.md) — who it's for.
4. [`ARCHITECTURE.md`](./ARCHITECTURE.md) — system shape.
5. [`TRANSCRIPT_FORMAT.md`](./TRANSCRIPT_FORMAT.md) — how `entire-cli` checkpoints look on disk; the parser contract.
6. [`ANALYSIS_ENGINE.md`](./ANALYSIS_ENGINE.md) — correction detection + LLM prompts.
7. [`METRICS.md`](./METRICS.md) — Friction Quotient, Token Efficiency, etc.
8. [`GITHUB_INTEGRATION.md`](./GITHUB_INTEGRATION.md) — App permissions, OAuth, PR contract.
9. [`ROADMAP.md`](./ROADMAP.md) — MVP cut + explicit non-goals.
10. [`BRANDING.md`](./BRANDING.md) — name, voice, tokens.
11. [`GLOSSARY.md`](./GLOSSARY.md) — one-line definitions.

## Scope fence (read before adding features)

Reflex.md v1 is a **web app** that does exactly four things:

1. **Connect a GitHub repo** (via GitHub App install).
2. **Read & display `entire/checkpoints/v1`** — the shadow branch produced by [`entire-cli`](https://github.com/entire-dev/entire-cli).
3. **Detect repetitive friction** (corrections, retries, reverts) and score it with defined metrics.
4. **Open a PR against `AGENTS.md` / `CLAUDE.md`** to encode the missing rule.

Anything else — Electron app, continuous monitoring, `.cursorrules`, per-directory overrides, auth beyond GitHub — is **out of scope**. See [`ROADMAP.md`](./ROADMAP.md).

## Load-bearing assumption

`entire-cli` is already installed on the target repo. Reflex.md is a **pure consumer** of the `entire/checkpoints/v1` branch. We do not instrument the user's terminal.
