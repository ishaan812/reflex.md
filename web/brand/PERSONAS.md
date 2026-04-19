# Personas

Three users. Each has a job-to-be-done Reflex.md must satisfy.

## 1. The Power User — "Priya"

- Solo or small-team dev. Ships 20+ AI-assisted PRs a week.
- Has `entire-cli` installed because they're the type to install `entire-cli`.
- Already writes an `AGENTS.md` by hand and is tired of it.

**Job-to-be-done:** *"Stop me from re-typing the same corrections every sprint."*

**Primary value:** Friction Report + auto-PR. They trust their own judgment on the diff; they just don't want to write it from scratch.

**Success:** Merges ≥ 1 Reflex PR in the first week.

## 2. The Team Lead — "Tomas"

- Engineering manager or senior IC. Owns the agent guidelines for a team of 5–15.
- Worries about consistency: did everyone internalize the new convention, or just the one person who was in Slack that day?
- Accountable for AI spend.

**Job-to-be-done:** *"Show me where my team's agent setup is leaking time and money, and fix it with a reviewable PR."*

**Primary value:** Friction Quotient + Token Efficiency over time, with correction clusters that span people. The PR is the artifact they already know how to review.

**Success:** Uses Reflex as weekly retro input.

## 3. The Agent Builder — "Ada"

- Builds agents / tooling that call Claude, Cursor APIs, etc.
- Needs high-quality `AGENTS.md` / `CLAUDE.md` templates for customers.

**Job-to-be-done:** *"Give me empirical data on what instructions actually work in the wild."*

**Primary value:** Transparency — every Reflex proposal cites exact checkpoints. Ada can mine aggregated patterns across their own usage.

**Success:** Cites Reflex-derived insights in their own product docs.

---

See [`VISION.md`](./VISION.md) for north star, [`METRICS.md`](./METRICS.md) for the numbers each persona cares about.
