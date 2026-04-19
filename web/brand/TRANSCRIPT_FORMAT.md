# Transcript Format — `entire/checkpoints/v1`

This is the **parser contract**. Every assumption about the data lives here. If the shape changes, update this file first, then the parser.

## Shadow branch layout

`entire-cli` writes to a shadow branch named `entire/checkpoints/v1`. Checkpoints are sharded by the first 2 hex chars of their ID:

```
entire/checkpoints/v1/
└── 0f/                        # shard = first 2 hex chars
    └── f8ca6db1c9/            # remainder of checkpoint_id
        ├── metadata.json       # checkpoint-level metadata
        └── 0/                  # session index: 0, 1, 2 …
            ├── full.jsonl      # event stream, one JSON per line
            ├── metadata.json   # session-level metadata
            ├── context.md      # formatted prompts (human-readable)
            ├── prompt.txt      # raw user prompts
            └── content_hash.txt
```

**Full checkpoint ID** = shard + remainder, so `0f/f8ca6db1c9/` → `0ff8ca6db1c9`.

## Commit ↔ checkpoint linkage

Every `entire`-tracked commit carries a trailer:

```
Checkpoint-Id: 0ff8ca6db1c9
```

So we can join commits to sessions without a separate index. Use `git log --format=%B` and parse trailers with `git interpret-trailers`.

## Checkpoint `metadata.json` (top-level)

Fields we rely on:

```jsonc
{
  "checkpoint_id": "0ff8ca6db1c9",
  "created_at": "2026-04-18T14:02:11Z",
  "strategy": "claude-code",   // or "cursor" | "copilot" | "gemini"
  "sessions": [
    { "index": 0, "started_at": "...", "ended_at": "..." }
    // ...
  ]
}
```

**Unknown fields:** preserve as-is on the Checkpoint row so we don't lose data on format bumps.

## Session `metadata.json`

Fields we rely on:

```jsonc
{
  "strategy_name": "claude-code",
  "branch": "feat/add-login",
  "files_touched": ["src/auth/login.ts", "src/auth/session.ts"],
  "token_usage": {
    "input_tokens": 14523,
    "cache_read_tokens": 9102,
    "output_tokens": 3481,
    "api_calls": 42
  },
  "started_at": "2026-04-18T14:02:11Z",
  "ended_at":   "2026-04-18T14:41:02Z"
}
```

## `full.jsonl` — event stream

One JSON object per line. Parser treats unknown `type` values as pass-through (don't throw). Known event types:

| `type` | Meaning | Key fields |
|---|---|---|
| `user_prompt` | Human-typed prompt | `ts`, `role: "user"`, `text` |
| `agent_response` | Agent message | `ts`, `role: "assistant"`, `text`, `tool_calls[]` (optional) |
| `tool_call` | Agent invoking a tool | `ts`, `tool_name`, `tool_call_id`, `args`, `exit_code` (when available) |
| `tool_result` | Tool returning | `ts`, `tool_call_id`, `output`, `exit_code` |
| `file_write` | File changed by agent | `ts`, `path`, `bytes`, `hash` |
| `subagent_spawn` | Nested agent start | `ts`, `parent_id`, `child_id`, `purpose` |
| `todo_write` | TodoWrite snapshot | `ts`, `todos[]` |

### Annotated sample line

```json
{"type":"tool_call","ts":"2026-04-18T14:05:22Z","tool_call_id":"tc_01abc","tool_name":"Bash","args":{"command":"pnpm test"},"exit_code":1}
```

- `exit_code: 1` combined with a following `tool_call` for the same `tool_name` within 60s → **tool-failure retry** signal.

### Sample session (condensed)

```json
{"type":"user_prompt","ts":"2026-04-18T14:02:11Z","role":"user","text":"Add a login route"}
{"type":"agent_response","ts":"2026-04-18T14:02:34Z","role":"assistant","text":"I'll add the route and tests..."}
{"type":"tool_call","ts":"2026-04-18T14:03:02Z","tool_call_id":"tc_01","tool_name":"Write","args":{"path":"src/auth/login.ts"}}
{"type":"file_write","ts":"2026-04-18T14:03:03Z","path":"src/auth/login.ts","bytes":1840,"hash":"sha256:..."}
{"type":"tool_call","ts":"2026-04-18T14:03:40Z","tool_call_id":"tc_02","tool_name":"Bash","args":{"command":"pnpm test"},"exit_code":1}
{"type":"tool_call","ts":"2026-04-18T14:04:10Z","tool_call_id":"tc_03","tool_name":"Bash","args":{"command":"pnpm test -- auth"},"exit_code":0}
{"type":"user_prompt","ts":"2026-04-18T14:05:50Z","role":"user","text":"no — don't use barrel exports, import directly from the module"}
```

Last line is an **explicit correction** (intensity 1). If the agent's next `file_write` undoes a barrel export introduced in `tc_01`, it's also an **implicit correction** signal.

## Redaction

`entire-cli` redacts secrets best-effort. We **re-run** a redaction pass before anything reaches the LLM. Patterns covered (defense in depth):

- `sk-[A-Za-z0-9]{20,}` (OpenAI / generic)
- `ghp_[A-Za-z0-9]{36,}` (GitHub PATs)
- `AKIA[0-9A-Z]{16}` (AWS access keys)
- `xox[baprs]-[A-Za-z0-9-]+` (Slack)
- Anything tagged by `entire` already with `[REDACTED]` — leave untouched.

Redaction replaces the match with `[REDACTED:<kind>]`.

## Parser behavior spec

- **Input:** path to a cloned repo with `entire/checkpoints/v1` checked out into a working tree (either as a branch or a `git archive`-extracted tree).
- **Output:** `Checkpoint` objects with nested `Session` objects whose `events` are the parsed `full.jsonl` lines.
- **Guarantees:**
  - Agent-agnostic: no branching on `strategy_name` for parsing. `strategy_name` is metadata only.
  - Idempotent: same input → same output, re-ingest safe (we upsert on `checkpoint_id`).
  - Tolerant: unknown event types pass through; malformed JSON lines get logged and skipped, not thrown.
  - Stable keys: `checkpoint_id` is our primary key. Don't invent IDs.

## TypeScript shape (reference)

```ts
export interface Checkpoint {
  checkpointId: string;
  createdAt: string;           // ISO
  sessions: Session[];
  raw: Record<string, unknown>; // preserved unknown fields
}

export interface Session {
  index: number;               // 0, 1, 2, …
  strategy: string;            // "claude-code" | "cursor" | "copilot" | "gemini" | …
  branch: string | null;
  filesTouched: string[];
  tokenUsage: {
    inputTokens: number;
    cacheReadTokens: number;
    outputTokens: number;
    apiCalls: number;
  };
  startedAt: string;
  endedAt: string | null;
  events: TranscriptEvent[];
}

export type TranscriptEvent =
  | { type: "user_prompt"; ts: string; role: "user"; text: string }
  | { type: "agent_response"; ts: string; role: "assistant"; text: string; toolCalls?: ToolCallRef[] }
  | { type: "tool_call"; ts: string; toolCallId: string; toolName: string; args: unknown; exitCode?: number }
  | { type: "tool_result"; ts: string; toolCallId: string; output: string; exitCode?: number }
  | { type: "file_write"; ts: string; path: string; bytes: number; hash: string }
  | { type: "subagent_spawn"; ts: string; parentId: string; childId: string; purpose: string }
  | { type: "todo_write"; ts: string; todos: Array<{ content: string; status: string }> }
  | { type: "unknown"; ts: string; raw: Record<string, unknown> };
```
