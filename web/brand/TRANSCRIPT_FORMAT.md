# TRANSCRIPT_FORMAT.md — Reflex ↔ entire-cli on-disk contract

> **This document reflects what `entireio/cli` v0.4.x actually writes.**
>
> Upstream source of truth: [entireio/cli — sessions-and-checkpoints.md](https://github.com/entireio/cli/blob/main/docs/architecture/sessions-and-checkpoints.md).
>
> An earlier version of this file documented a fictional schema. Reflex's parser, friction detector, and event drawer were built against that fiction and produced nonsense on real repositories (session timestamps set to `Date.now()`, agent badge always reading "manual-commit", friction quotient always 0, event drawer rendering everything as "Other"). The parser was realigned against this document in commit `align_to_entire`.

## Branch

`entire/checkpoints/v1` — a separate git branch containing metadata only. Checkpoints live under sharded subdirectories keyed by a 12-hex-character checkpoint ID.

Clone recipe Reflex uses (single branch, shallow):

```bash
git clone --depth 1 --branch entire/checkpoints/v1 --single-branch \
  https://x-access-token:<token>@github.com/<owner>/<repo>.git <tmpdir>
```

## On-disk layout

```
entire/checkpoints/v1/
└── <id[:2]>/<id[2:]>/              ← sharded by first 2 hex chars of checkpoint ID
    ├── metadata.json               ← CheckpointSummary
    ├── 0/                          ← first session (0-indexed, concurrent sessions allowed)
    │   ├── metadata.json           ← per-session CommittedMetadata
    │   ├── full.jsonl              ← agent-specific transcript stream
    │   ├── prompt.txt              ← canonical user prompt(s) for this checkpoint
    │   ├── context.md              ← optional formatted context
    │   └── content_hash.txt        ← integrity hash
    └── 1/                          ← second concurrent session, same structure
        └── …
```

## Checkpoint-level `metadata.json` (CheckpointSummary)

```json
{
  "cli_version": "0.4.5",
  "checkpoint_id": "18a01d659c86",
  "strategy": "manual-commit",
  "branch": "master",
  "checkpoints_count": 1,
  "files_touched": ["path/one.go", "path/two.go"],
  "sessions": [
    { "metadata": "/18/a01d659c86/0/metadata.json",
      "transcript": "/18/a01d659c86/0/full.jsonl",
      "context": "/18/a01d659c86/0/context.md",
      "content_hash": "/18/a01d659c86/0/content_hash.txt",
      "prompt": "/18/a01d659c86/0/prompt.txt" }
  ],
  "token_usage": {
    "input_tokens": 207,
    "cache_creation_tokens": 130476,
    "cache_read_tokens": 13248087,
    "output_tokens": 19809,
    "api_call_count": 170
  }
}
```

Important non-obvious facts:

- **No `created_at`** at this level. Reflex derives checkpoint ordering from the earliest `created_at` among the per-session metadata files.
- **`strategy` is the storage strategy** (`manual-commit`), NOT the agent name. The agent name lives in each per-session metadata file.
- `sessions[].context` and `sessions[].prompt` may be empty strings when the agent did not produce them.
- `token_usage` uses snake_case keys everywhere.

## Session-level `<n>/metadata.json` (CommittedMetadata)

```json
{
  "cli_version": "0.4.5",
  "checkpoint_id": "18a01d659c86",
  "session_id": "71b7ebb0-9f9c-436f-9037-b8ec1849d6a0",
  "strategy": "manual-commit",
  "created_at": "2026-02-21T11:30:31.117538Z",
  "branch": "master",
  "agent": "Claude Code",
  "turn_id": "413db266526b",
  "checkpoints_count": 1,
  "files_touched": ["…"],
  "token_usage": { "input_tokens": 207, "…": 0 },
  "initial_attribution": {
    "calculated_at": "…",
    "agent_lines": 0,
    "human_added": 125,
    "human_modified": 63,
    "human_removed": 0,
    "total_committed": 125,
    "agent_percentage": 0
  },
  "transcript_path": ".claude/projects/…/<session-uuid>.jsonl"
}
```

Notes:

- **`agent`** is the actual agent name (`"Claude Code"`, `"Codex"`, `"Gemini CLI"`, `"Cursor"`, `"Copilot CLI"`, `"OpenCode"`, etc.). Reflex surfaces this as the primary badge in the UI.
- **`session_id`** is a UUID. It may be `"unknown"` for some agents.
- **No `ended_at`**; the cli does not track session end.
- **No `started_at`**; use `created_at`.
- `transcript_path` points back to the original agent-side transcript location for audit.

## `full.jsonl` (agent-specific)

The cli is deliberately agnostic — whatever the agent's hook captures is streamed verbatim into `full.jsonl`. The filename is a convention, not a guarantee of JSONL: some agents (e.g. Cursor) write plain-text transcripts under the same name.

### Claude Code (most common)

Identical to `~/.claude/projects/<encoded-path>/<session-uuid>.jsonl`. Representative line types:

| `type`                  | Shape | Notes |
|-------------------------|-------|-------|
| `user`                  | `{ type, message: { role:"user", content: string \| Block[] } }` | User message. `content` may be a string or an array of content blocks. |
| `user` (tool_result)    | `message.content[] = [{ type:"tool_result", tool_use_id, content, is_error? }]` | Tool result envelopes ride on a `user` entry. |
| `assistant`             | `{ type, message: { role:"assistant", content: [{ type:"text", text } \| { type:"tool_use", id, name, input }] } }` | Assistant turn. One turn may include text and multiple tool calls. |
| `summary`               | `{ type, summary: string }` | Session summary. |
| `progress`              | Internal progress markers. | Not rendered. |
| `file-history-snapshot` | Internal state snapshot. | Not rendered. |
| `system`                | Internal system events. | Not rendered. |

### Other agents

Cursor, Codex, Gemini, Copilot, Aider, OpenCode each use their own shape. Reflex currently has no adapter for these and treats each line as an opaque `{ kind: "raw", raw: <line> }` event.

## `prompt.txt`

Plain-text file containing the user's typed prompt(s) that bracket this checkpoint. Paragraphs are separated by blank lines. This is the **most reliable cross-agent friction signal** because every strategy produces it.

## Reflex's normalized event model

To make `full.jsonl` usable in the UI and friction detector, Reflex normalizes raw events into a 7-kind schema via a per-agent adapter:

```ts
type NormalizedKind =
  | "user" | "assistant" | "tool_call" | "tool_result"
  | "file_write" | "todo" | "raw";

interface NormalizedEvent {
  kind: NormalizedKind;
  ts?: string;
  text?: string;
  toolName?: string;
  toolUseId?: string;
  args?: unknown;
  exitCode?: number;       // set on tool_result; non-zero means failure
  path?: string;           // set on file_write
  bytes?: number;
  todos?: Array<{ content: string; status: string; priority?: string }>;
  raw: unknown;            // original entry, kept for drawer's "Show raw" toggle
}
```

Claude Code mapping rules (in `backend/src/adapters/claudeCode.ts`):

- `user` with string or text blocks → `user`.
- `user` with `tool_result` blocks → `tool_result` (one per block).
- `assistant` text block → `assistant`.
- `assistant` `tool_use` block → `tool_call` (or `file_write` for `Write|Edit|MultiEdit`, or `todo` for `TodoWrite`).
- `summary` → `assistant` with `[summary]` prefix.
- Everything else → `raw`.

Other agents: every line → `raw`.

## Friction signals

Two independent signals feed into `detectCorrections(agent, events, prompt)`:

1. **Explicit corrections** — user messages (from normalized `kind:"user"` events, or paragraph-split `prompt.txt` if no adapter) that match a negation regex. Intensity 1.
2. **Tool retries** — a `tool_result` with `exitCode !== 0` followed within 60 seconds by another `tool_call` of the same `toolName`. Intensity 2.

`scoreSession` returns `Σ intensity / max(userPromptCount, 1)`; thresholds from `METRICS.md`.

## Changelog

- **2026-04** — Aligned to real entire-cli v0.4.x format. Added `agent`/`prompt`/`context`/`attribution` fields to the Reflex Session model. Added Claude Code adapter and normalized event model. Replaced fabricated fixtures with a trimmed snapshot from `ishaan812/devlog`.
