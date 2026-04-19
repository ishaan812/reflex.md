# Glossary

One-line definitions. Every other doc in `brand/` links here instead of re-defining terms.

| Term | Definition |
|---|---|
| **Checkpoint** | A single run captured by `entire-cli`, identified by a stable `checkpoint_id`, stored as a sharded directory on the `entire/checkpoints/v1` shadow branch. A checkpoint contains one or more sessions. |
| **Shadow branch** | The `entire/checkpoints/v1` branch written by `entire-cli`. Our exclusive data source; we never read non-shadow branches for transcript data. |
| **Session** | One `strategy_name` run inside a checkpoint, indexed 0, 1, 2… Has its own `full.jsonl` event stream and `metadata.json`. |
| **Event** | A single line in `full.jsonl`: `user_prompt`, `agent_response`, `tool_call`, `tool_result`, `file_write`, `subagent_spawn`, or `todo_write`. |
| **Correction** | An event that indicates the agent got something wrong. Four kinds: explicit (negation in a prompt), implicit (user edits agent file), tool-failure retry, manual revert. |
| **Correction cluster** | A semantic grouping of related corrections across sessions (cosine ≥ 0.82). Each cluster is a candidate for a new rule. |
| **Friction Point** | A single correction event that contributes to Friction Quotient. |
| **Friction Quotient (FQ)** | `Σ(correction_intensity) / user_prompts`. Per-session score of how painful the session was. |
| **Dead Context** | A rule in `AGENTS.md` / `CLAUDE.md` that has not been referenced or violated in 30+ days. Candidate for removal. |
| **Ignored Rule** | A rule present in `AGENTS.md` / `CLAUDE.md` that the agent is violating (matched by a correction cluster). Candidate for strengthening, not removal. |
| **Promotion** | Moving a detected rule up the L3 → L2 → L1 ladder once it's seen enough sessions or directories to warrant a more general scope. |
| **L1 / L2 / L3** | Rule levels. L3 = observed-only; L2 = scoped to a directory; L1 = universal. |
| **Lazy prompt** | A user prompt < 10 tokens, no error text or path, following a failed tool call. Informational signal in v1. |
| **Instruction Recency (IR)** | Days since a rule was last referenced in session text or last matched a correction. Feeds Dead Context detection. |
| **Instruction Density (ID)** | `file_tokens / rule_count`. High ID = bloated prose; low ID = tight, instruction-heavy file. |
| **Token Efficiency (TE)** | `(output + cache_read) / (input + output)`. Fraction of tokens doing productive work this session. |
| **Strategy** | The `strategy_name` field on a session — `claude-code`, `cursor`, `copilot`, `gemini`, etc. Used for filtering/grouping only; parser stays agent-agnostic. |
| **Analysis** | One end-to-end run of the pipeline for a repo, producing a `FrictionReport` + `ProposedEdit`. Persisted as an `Analysis` row. |
| **ProposedEdit** | The LLM output: `{ targetFile, afterText, reasoning[] }`. We compute the unified diff ourselves. |
| **Reflex PR** | A pull request opened by Reflex.md on a branch named `reflex/update-<targetFile>-<shortAnalysisId>`. Always against `AGENTS.md` or `CLAUDE.md` in v1. |
| **Correction Tax** | The time cost of repeatedly correcting the same agent mistakes. The pain Reflex.md exists to eliminate. |
| **Entire** / **`entire-cli`** | The upstream tool that captures transcripts and writes the shadow branch. Reflex depends on it; does not bundle it. |
