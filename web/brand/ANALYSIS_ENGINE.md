# Analysis Engine

Turns parsed transcripts → a friction report → a proposed `AGENTS.md` / `CLAUDE.md` diff + reasoning.

## Inputs

- Last **3 sessions** of the repo (MVP cap), already parsed per [`TRANSCRIPT_FORMAT.md`](./TRANSCRIPT_FORMAT.md).
- Current `AGENTS.md` and/or `CLAUDE.md` from the repo's default branch (fetched over GitHub REST).
- Any historical `Pattern` rows from prior analyses (for promotion — see §5).

## Outputs

- **`FrictionReport`** — correction clusters, dead-context candidates, lazy-prompt count, per-session FQ.
- **`ProposedEdit`** — `{ targetFile, beforeText, afterText, unifiedDiff, reasoning[] }`.
  - `reasoning[]` items cite `checkpoint_id` + `event_ts` so the PR body can link back.

## Pipeline

### 1. Classify events (cheap LLM pass)

- Model: **Claude Haiku 4.5** (fast, cheap, batchable).
- Batch size: 50 prompts per call.
- Per **user prompt**, output: `{ action | correction | clarification | lazy }`.
- Per **tool call**, output: `{ first_try | retry }` (retry = same `tool_name` within 60s of a prior non-zero exit).

Prompt caching: the instruction block + classification rubric is static → set cache breakpoint after the rubric.

### 2. Cluster corrections (semantic)

- Embed each `correction`-classified prompt (provider TBD: OpenAI `text-embedding-3-small` or similar).
- Agglomerative clustering; merge pairs with cosine ≥ **0.82**.
- A cluster has: `{ id, representativeText, members[], totalIntensity, scopeDirs[], firstSeen, lastSeen }`.
- `scopeDirs[]` derived from `files_touched` union of the member sessions — drives promotion rules.

### 3. Score friction

For each session, compute FQ per [`METRICS.md`](./METRICS.md):

```
FQ = Σ(intensity) / max(user_prompts, 1)
```

Aggregate: headline FQ for the timeline = mean of last 3 sessions.

### 4. Detect dead context

For each rule in current `AGENTS.md` / `CLAUDE.md` (parse markdown into rule-nodes — bullets + section headings):

- Compute Instruction Recency (IR). Embeddings compared to session text; cosine ≥ 0.78 counts as a reference.
- Also check violations: for each correction cluster, does its `representativeText` match this rule's text (cosine ≥ 0.75)? If yes, the rule is being **violated** — it's not dead, it's ignored. Surface that instead.

Outputs two lists:
- `deadCandidates[]` — rules with `IR > 30` and zero violations.
- `ignoredRules[]` — rules with violations. These get **strengthened** in the proposed edit (bolded, restructured, moved earlier).

### 5. Promotion (Hierarchical Summarization)

Rules live at three levels:

- **L3** — observed, not yet a rule. Lives only in `Pattern` table.
- **L2** — scoped rule under a specific directory (e.g., `src/auth/AGENTS.md` in v2; for v1 we annotate in the main file as "In `src/auth/`, …").
- **L1** — universal rule in the root file.

Promotion triggers:

| From | To | Condition |
|---|---|---|
| L3 | L2 | Cluster has ≥ 3 sessions in the same `scopeDir` |
| L2 | L1 | Cluster has ≥ 5 sessions spanning ≥ 2 `scopeDirs` |
| L1 | Dead | `IR > 30` AND 0 violations in last 90 days |

Persisted on `Pattern(level, scopeDir, rule, supportCount, firstSeen, lastSeen)`.

### 6. Generate optimization (expensive LLM pass)

- Model: **Claude Sonnet 4.6**.
- One call per analysis.
- Inputs to the prompt, in cache-aware order:
  1. **[CACHED]** System prompt + rubric + output schema (never changes).
  2. **[CACHED]** Markdown-diff style guide + safety rules (rarely changes).
  3. **[VARIABLE]** Current `AGENTS.md` / `CLAUDE.md` content.
  4. **[VARIABLE]** Top 10 correction clusters with evidence excerpts.
  5. **[VARIABLE]** Dead-context + ignored-rule lists.
- Output: strict JSON `{ targetFile, afterText, reasoning: [{ rule, checkpointIds[], evidenceText }] }`.
- We compute the unified diff ourselves (don't trust the LLM for that); we do trust it for `afterText`.

### 7. Guard the output

Hard rejects:

- Diff changes > **30%** of file size.
- A section header deleted without replacement.
- `afterText` fails markdown lint.
- Unified diff fails a dry `git apply --check`.
- Reasoning cites a checkpoint ID not in the input set (hallucination).

On rejection: log, surface to user as "Analysis needs manual review", do not auto-PR.

### 8. Persist & notify

- Write `Analysis` row with `FrictionReport` + `ProposedEdit`.
- Emit WebSocket event `analysis.ready` to the UI.
- User is now on the Diff View; "Open PR" is live.

## Claude prompt templates

### Classifier (Haiku) — static portion

```
You classify events from an AI-coding session transcript.

For each USER PROMPT, output exactly one label:
- "action"        : user is asking for new work
- "correction"    : user is correcting/negating prior agent output
- "clarification" : user is asking a question about what the agent did
- "lazy"          : prompt < 10 tokens, no error text or path, follows a failed tool

For each TOOL CALL, output exactly one label:
- "first_try" : first invocation of this tool in the last 60s
- "retry"     : same tool invoked within 60s of a non-zero exit_code

Respond as a JSON array, order-preserved, one label string per input.
```

### Optimizer (Sonnet) — system prompt (static, cached)

```
You are Reflex.md's instruction optimizer. Your job is to propose minimal,
high-signal edits to AGENTS.md or CLAUDE.md so that an AI coding agent
makes fewer of the mistakes shown in the evidence.

RULES:
1. Never propose source-code changes. Only edit the target markdown file.
2. Every new rule must cite at least one checkpoint ID from the evidence.
3. Prefer rewriting an existing weak rule over adding a new one.
4. If a rule in the current file is being ignored (per "ignoredRules"), do
   NOT delete it — strengthen it: bolder wording, move it earlier, add an
   example pulled from evidence.
5. Do not delete section headers without replacement.
6. Output strict JSON. No prose outside the JSON.

OUTPUT SCHEMA:
{
  "targetFile": "AGENTS.md" | "CLAUDE.md",
  "afterText": "...full new file contents...",
  "reasoning": [
    {
      "rule": "string — the new/changed rule in one sentence",
      "checkpointIds": ["..."],
      "evidenceText": "short quoted excerpt from a correction prompt"
    }
  ]
}
```

### Optimizer — user message (variable)

```
CURRENT FILE ({targetFile}):
---
{currentMarkdown}
---

CORRECTION CLUSTERS (top {N}):
{json.dumps(clusters)}

IGNORED RULES (present in file but being violated):
{json.dumps(ignoredRules)}

DEAD CONTEXT CANDIDATES (may be removed):
{json.dumps(deadCandidates)}

Produce the optimized file per the schema.
```

## Routing: which file gets the rule?

- Rule text mentions Claude-specific behavior (e.g., `<thinking>`, `tool_use_id`, Claude-only APIs) → `CLAUDE.md`.
- Otherwise → `AGENTS.md`.
- Repo has only one of the two → use that file.
- Repo has neither → create `AGENTS.md`.

Routing is done in code (regex keyword list) **before** calling the optimizer, so the prompt only deals with one target file.
