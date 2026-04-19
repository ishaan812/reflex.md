# Metrics

Four metrics. Two are **v1 surfaced** (drive the UI). Two are **v1 computed but v2 surfaced** (we track them so we have history when dashboards ship).

| Metric | Status | Answers |
|---|---|---|
| **Friction Quotient** | v1 surfaced | "How painful was this session?" |
| **Token Efficiency** | v1 surfaced (badge only) | "Am I burning tokens for no reason?" |
| **Instruction Recency** | v1 computed | "Are my rules still alive?" |
| **Instruction Density** | v1 computed | "Is my `AGENTS.md` too bloated to be read?" |

All formulas below use fields defined in [`TRANSCRIPT_FORMAT.md`](./TRANSCRIPT_FORMAT.md).

---

## Friction Quotient (FQ)

**Question:** how much of this session was spent fighting the agent instead of moving forward?

**Formula** (per session):

```
FQ = Σ(correction_intensity) / max(total_user_prompts, 1)
```

**Intensity weights** (tune later):

| Signal | Weight | Source |
|---|---|---|
| Explicit text correction (negation patterns) | 1 | prompt classifier (Haiku) |
| Tool-failure retry (same tool, non-zero exit, re-invoked) | 2 | `full.jsonl` tool-call events |
| Implicit correction (user edits agent-written file < 5 min later) | 3 | git diff vs session `files_touched` |
| Manual `git revert` / `git reset --hard` within N commits | 5 | commit trailers + reflog |

**Windowing:** computed per session (a session = one `strategy_name` run, defined by `metadata.json`). Aggregated across last 3 sessions for the headline badge on the Timeline.

**Thresholds (defaults):**
- `FQ < 0.3` → Clean (green)
- `0.3 ≤ FQ < 0.8` → Noisy (amber)
- `FQ ≥ 0.8` → High-friction (red)

**Sanity check:** a session that is all successful first-tries should produce `FQ = 0`. A session with more corrections than prompts should produce `FQ > 1`. If violated, rebalance weights.

---

## Token Efficiency (TE)

**Question:** what fraction of tokens this session did useful work?

**Formula** (per session):

```
TE = (output_tokens + cache_read_tokens) / max(input_tokens + output_tokens, 1)
```

Higher is better. Penalizes sessions that repeatedly re-ingest the same context because the agent forgot it.

**Source:** `token_usage` object in session `metadata.json` (populated by `entire-cli`).

**v1 surface:** sparkline on the Timeline row. No dedicated dashboard.

---

## Instruction Recency (IR)

**Question:** is this rule still being used?

**Per rule** (a rule = one bullet / section in `AGENTS.md` or `CLAUDE.md`):

```
IR = days_since_last_reference
```

Where `reference` means any of:
- A prompt or agent response in the last 90 days whose embedding has cosine ≥ 0.78 to the rule text.
- A correction cluster that would have been prevented by the rule.
- A tool-failure retry where the failing command matches a rule keyword.

**Decay rule:** `IR > 30` AND zero violation matches → the rule is a **Dead Context** candidate, surfaced to the user for removal.

**v1 surface:** flagged in the Friction Report as candidates; not a dashboard yet.

---

## Instruction Density (ID)

**Question:** is the instruction file readable by an agent under context pressure?

**Formula** (per file):

```
ID = total_tokens(AGENTS.md) / total_rules(AGENTS.md)
```

A file with 50 rules in 5000 tokens (ID = 100) is healthier than a file with 5 rules in 5000 tokens (ID = 1000) — the latter is prose, not instructions.

**Secondary signal:** total tokens > 4000 → "too long to reliably attend to" warning.

**v1 surface:** single number in the Diff View header so the user sees if the proposed edit bloats the file.

---

## How each metric flows into a PR

The PR body generated in F4 must include:
- The session-level FQ for each session that contributed evidence.
- The top 3 correction clusters with their intensity-weighted counts.
- Any Dead Context rules being removed (with IR values).

See [`ANALYSIS_ENGINE.md`](./ANALYSIS_ENGINE.md) for how these numbers get stitched into the Claude prompt.
