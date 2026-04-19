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
 *   { type: "tool-invocation", toolInvocation: { toolName, args, result, state } }
 *   { type: "step-start", snapshot?: { ... } }
 *   { type: "step-finish", reason, snapshot?, tokens?, cost? }
 *
 * One OpenCode message may fan out to multiple normalized events (e.g. an
 * assistant message with text + tool invocations).
 */
export function normalizeOpenCodeMessage(raw: any): NormalizedEvent[] {
  if (!raw || typeof raw !== "object") return [rawFallback(raw)];

  const info = raw.info ?? {};
  const parts: any[] = Array.isArray(raw.parts) ? raw.parts : [];
  const role: string = info.role ?? "";
  const ts = extractTimestamp(info);

  if (role === "user") {
    const textParts = parts
      .filter((p) => p?.type === "text")
      .map((p) => p.text ?? "")
      .filter(Boolean);
    return [
      {
        kind: "user",
        ts,
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
        events.push(toolCallFrom(part.toolInvocation, ts, raw));
        continue;
      }

      // step-start / step-finish are structural — skip silently
      if (part.type === "step-start" || part.type === "step-finish") continue;
    }

    if (textParts.length) {
      events.unshift({
        kind: "assistant",
        ts,
        text: textParts.join("\n").trim(),
        raw,
      });
    }

    if (events.length) return events;

    // Assistant message with no recognizable parts
    return [{ kind: "assistant", ts, text: undefined, raw }];
  }

  return [rawFallback(raw, ts)];
}

function toolCallFrom(
  inv: any,
  ts: string | undefined,
  raw: any,
): NormalizedEvent {
  const toolName: string = inv.toolName ?? "";
  const args = inv.args ?? {};
  const state: string = inv.state ?? "";
  const result = inv.result;

  // If this is a completed tool invocation with a result, emit a tool_result
  // when the state indicates completion.
  if (state === "result" && result !== undefined) {
    const text =
      typeof result === "string"
        ? result
        : typeof result === "object" && result !== null
          ? JSON.stringify(result)
          : String(result ?? "");
    return {
      kind: "tool_result",
      ts,
      toolName,
      text,
      exitCode: 0,
      raw,
    };
  }

  const base: NormalizedEvent = {
    kind: "tool_call",
    ts,
    toolName,
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
    base.path = args.file_path ?? args.path ?? args.filePath ?? args.filename;
    base.kind = "file_write";
    if (typeof args.content === "string") {
      base.bytes = Buffer.byteLength(args.content, "utf8");
    }
  }

  if (lowerName === "todowrite" && Array.isArray(args.todos)) {
    base.kind = "todo";
    base.todos = (args.todos as any[]).map((t: any) => ({
      content: String(t.content ?? ""),
      status: String(t.status ?? "pending"),
      priority: t.priority ? String(t.priority) : undefined,
    }));
  }

  return base;
}

function extractTimestamp(info: any): string | undefined {
  if (!info?.time) return undefined;
  const time = info.time;
  // OpenCode stores timestamps as epoch millis in { created, updated }
  if (typeof time === "object") {
    const ms = time.created ?? time.updated;
    if (typeof ms === "number") return new Date(ms).toISOString();
  }
  if (typeof time === "string") return time;
  if (typeof time === "number") return new Date(time).toISOString();
  return undefined;
}

function rawFallback(raw: unknown, ts?: string): NormalizedEvent {
  return { kind: "raw", ts, raw };
}
