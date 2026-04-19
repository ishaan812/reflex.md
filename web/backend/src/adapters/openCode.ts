import type { NormalizedEvent } from "../types.js";

/**
 * Adapts OpenCode's transcript format (as captured by entire-cli) into
 * Reflex's normalized event shape.
 *
 * OpenCode writes a single JSON object to `full.jsonl` with shape:
 *   { info: { id, slug, ... }, messages: [ ... ] }
 *
 * Each message has:
 *   { info: { role: "user"|"assistant", time, agent, model, ... }, parts: [ ... ] }
 *
 * Part types:
 *   { type: "text", text: string, time?: { created, completed } }
 *   { type: "tool-invocation", toolInvocation: { toolCallId?, toolName, args, result, state } }
 *   { type: "step-start", snapshot?: { ... } }
 *   { type: "step-finish", reason, snapshot?, tokens?, cost? }
 *
 * One OpenCode message may fan out to multiple normalized events (e.g. an
 * assistant message with text + tool invocations). For a completed
 * tool-invocation we emit a PAIR of events: `tool_call` followed by
 * `tool_result`, so friction.ts's retry detector can correlate them.
 */
export function normalizeOpenCodeMessage(raw: any): NormalizedEvent[] {
  if (!raw || typeof raw !== "object") return [rawFallback(raw)];

  const info = raw.info ?? {};
  const parts: any[] = Array.isArray(raw.parts) ? raw.parts : [];
  const role: string = info.role ?? "";
  const createdTs = extractTimestamp(info, "created");
  const updatedTs = extractTimestamp(info, "updated") ?? createdTs;

  if (role === "user") {
    const textParts = parts
      .filter((p) => p?.type === "text")
      .map((p) => p.text ?? "")
      .filter(Boolean);
    return [
      {
        kind: "user",
        ts: createdTs,
        text: textParts.join("\n").trim() || undefined,
        raw,
      },
    ];
  }

  if (role === "assistant") {
    const events: NormalizedEvent[] = [];
    const textParts: string[] = [];

    for (const part of parts) {
      if (!part || typeof part !== "object") continue;

      if (part.type === "text" && typeof part.text === "string") {
        textParts.push(part.text);
        continue;
      }

      if (part.type === "tool-invocation" && part.toolInvocation) {
        const callCompletedTs =
          extractTimestamp(part, "completed") ?? updatedTs;
        for (const ev of eventsFromInvocation(
          part.toolInvocation,
          createdTs,
          callCompletedTs,
          raw,
        )) {
          events.push(ev);
        }
        continue;
      }

      // step-start / step-finish are structural — skip silently
      if (part.type === "step-start" || part.type === "step-finish") continue;
    }

    if (textParts.length) {
      events.unshift({
        kind: "assistant",
        ts: createdTs,
        text: textParts.join("\n").trim(),
        raw,
      });
    }

    if (events.length) return events;

    // Assistant message with no recognizable parts
    return [{ kind: "assistant", ts: createdTs, text: undefined, raw }];
  }

  return [rawFallback(raw, createdTs)];
}

/**
 * Expand a single tool-invocation part into the normalized event stream.
 *
 * - Always emits a `tool_call` (or `file_write` / `todo` lift) for the invocation.
 * - If the invocation has reached a terminal state (`result` or `error`) we
 *   additionally emit a `tool_result` with a derived exitCode.
 *
 * Exit-code derivation (in priority order):
 *   1. `state === "error"` → 1
 *   2. `result.error` truthy → 1
 *   3. numeric `result.exitCode` / `result.exit_code` / `result.code` → as-is
 *   4. shell-tool result text containing /error|failed|exit(?:ed)? (?:code|with) [1-9]/i → 1
 *   5. otherwise → 0
 */
function eventsFromInvocation(
  inv: any,
  callTs: string | undefined,
  resultTs: string | undefined,
  raw: any,
): NormalizedEvent[] {
  const toolName: string = inv?.toolName ?? "";
  const args = inv?.args ?? {};
  const state: string = typeof inv?.state === "string" ? inv.state : "";
  const result = inv?.result;
  // Preserve a correlation id between call and result so findPrecedingToolCall
  // can match them.
  const toolUseId: string | undefined =
    inv?.toolCallId ?? inv?.tool_call_id ?? inv?.id ?? undefined;

  const call: NormalizedEvent = {
    kind: "tool_call",
    ts: callTs,
    toolName,
    toolUseId,
    args,
    raw,
  };

  // Lift file path for write/edit tools
  const lowerName = toolName.toLowerCase();
  if (
    lowerName === "write" ||
    lowerName === "edit" ||
    lowerName === "multiedit" ||
    lowerName === "multi_edit"
  ) {
    call.kind = "file_write";
    call.path = args.file_path ?? args.path ?? args.filePath ?? args.filename;
    if (typeof args.content === "string") {
      call.bytes = Buffer.byteLength(args.content, "utf8");
    }
  } else if (lowerName === "todowrite" && Array.isArray(args.todos)) {
    call.kind = "todo";
    call.todos = (args.todos as any[]).map((t: any) => ({
      content: String(t?.content ?? ""),
      status: String(t?.status ?? "pending"),
      priority: t?.priority ? String(t.priority) : undefined,
    }));
  }

  const isTerminal =
    state === "result" || state === "error" || result !== undefined;
  if (!isTerminal) return [call];

  const text = stringifyResult(result);
  const exitCode = deriveExitCode(state, result, text);
  const resultEvent: NormalizedEvent = {
    kind: "tool_result",
    ts: resultTs,
    toolName,
    toolUseId,
    text,
    exitCode,
    raw,
  };

  return [call, resultEvent];
}

function stringifyResult(result: unknown): string | undefined {
  if (result == null) return undefined;
  if (typeof result === "string") return result;
  if (typeof result === "object") {
    try {
      return JSON.stringify(result);
    } catch {
      return String(result);
    }
  }
  return String(result);
}

const ERROR_TEXT_RE =
  /\b(error|failed|exit(?:ed)?\s+(?:code|with)\s+[1-9])\b/i;

function deriveExitCode(
  state: string,
  result: any,
  text: string | undefined,
): number {
  if (state === "error") return 1;
  if (result && typeof result === "object") {
    if (result.error) return 1;
    const numeric =
      typeof result.exitCode === "number"
        ? result.exitCode
        : typeof result.exit_code === "number"
          ? result.exit_code
          : typeof result.code === "number"
            ? result.code
            : null;
    if (numeric !== null) return numeric;
    // OpenCode's bash tool sometimes nests the exit code under result.metadata.
    const meta = result.metadata;
    if (meta && typeof meta === "object") {
      if (typeof meta.exitCode === "number") return meta.exitCode;
      if (typeof meta.exit_code === "number") return meta.exit_code;
    }
  }
  if (typeof text === "string" && ERROR_TEXT_RE.test(text)) return 1;
  return 0;
}

function extractTimestamp(
  container: any,
  prefer: "created" | "updated" | "completed" = "created",
): string | undefined {
  const time = container?.time ?? container?.info?.time;
  if (time == null) return undefined;
  if (typeof time === "object") {
    const order =
      prefer === "created"
        ? ["created", "updated", "completed"]
        : prefer === "updated"
          ? ["updated", "created", "completed"]
          : ["completed", "updated", "created"];
    for (const key of order) {
      const v = (time as any)[key];
      if (typeof v === "number") return new Date(v).toISOString();
      if (typeof v === "string" && v) return v;
    }
    return undefined;
  }
  if (typeof time === "string") return time;
  if (typeof time === "number") return new Date(time).toISOString();
  return undefined;
}

function rawFallback(raw: unknown, ts?: string): NormalizedEvent {
  return { kind: "raw", ts, raw };
}
