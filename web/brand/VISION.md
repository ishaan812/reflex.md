# Vision

## The Correction Tax

Every AI-assisted developer pays it. You tell the agent "don't use barrel exports" on Monday. On Tuesday it uses barrel exports. On Wednesday you write a `.cursorrules` file. On Thursday the agent ignores half of it. On Friday you revert three commits.

The correction signal exists — it's sitting in every chat transcript. Nobody mines it.

## Why now

[`entire-cli`](https://github.com/entire-dev/entire-cli) already captures every agent session as a structured transcript on an `entire/checkpoints/v1` shadow branch. That's the missing substrate. Reflex.md is what you build on top of it.

## North star

**Project instructions that self-heal.** A repo's `AGENTS.md` / `CLAUDE.md` should get sharper every week without the human manually curating it. Corrections the developer made yesterday become rules the agent follows tomorrow.

## Elevator pitch

> Reflex.md reads your `entire-cli` transcripts, finds the mistakes your AI agents keep making, and opens a PR that teaches them not to. You click merge.

## Success for the hackathon demo

A user connects a repo → Reflex fetches the last 3 `entire` checkpoints → shows a friction timeline → generates an `AGENTS.md` diff → user clicks "Open PR" → PR appears on GitHub with reasoning citing the exact prompts that drove it.

## What we refuse to do

- Modify source code. Ever. We only propose edits to instruction files.
- Re-invent transcript capture. `entire-cli` already nails it.
- Ship another dashboard. Every view must drive toward a proposed PR.

See [`GLOSSARY.md`](./GLOSSARY.md) for terms. See [`PRD.md`](./PRD.md) for the concrete feature cut.
