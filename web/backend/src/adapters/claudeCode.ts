import type { NormalizedEvent } from "../types.js";

/**
 * Adapts Claude Code's JSONL transcript format (as captured by entire-cli) into
 * Reflex's normalized event shape.
 *
 * Claude Code writes one JSON per line at:
 *   ~/.claude/projects/<encoded-path>/<session-uuid>.jsonl
 *
 * entire-cli copies that stream verbatim to `full.jsonl` under each session dir.
 *
 * Representative shapes:
 *   { type: "user",      message: { role: "user",      content: "..." | [ ... ] }, timestamp, uuid }
 *   { type: "assistant", message: { role: "assistant", content: [ { type:"text", text } | { type:"tool_use", id, name, input } ] }, timestamp }
 *   { type: "user",      message: { content: [ { type:"tool_result", tool_use_id, content, is_error? } ] } }   // tool result envelope
 *   { type: "summary",   summary: "..." }
 *   { type: "system",    ... }
 *
 * One Claude entry may fan out to multiple normalized events (e.g. an assistant
 * turn with two tool_use blocks → two `tool_call`s).
 */
export function normalizeClaudeCodeEvent(raw: any): NormalizedEvent[] {
  if (!raw || typeof raw !== "object") return [rawFallback(raw)];

  const ts: string | undefined = raw.timestamp ?? raw.ts;

  // Tool results ride on a "user" envelope whose content[] has {type:"tool_result",...}
  if (raw.type === "user" && Array.isArray(raw.message?.content)) {
    const blocks = raw.message.content as any[];
    const results = blocks.filter((b) => b?.type === "tool_result");
    if (results.length) {
      return results.map((b) => ({
        kind: "tool_result" as const,
        ts,
        toolUseId: b.tool_use_id,
        text: extractText(b.content),
        exitCode: b.is_error ? 1 : 0,
        raw,
      }));
    }
    // plain user message embedded as a block array
    const texts = blocks
      .filter((b) => b?.type === "text")
      .map((b) => b.text ?? "")
      .filter(Boolean);
    if (texts.length) {
      return [
        {
          kind: "user",
          ts,
          text: texts.join("\n").trim(),
          raw,
        },
      ];
    }
  }

  if (raw.type === "user") {
    return [
      {
        kind: "user",
        ts,
        text: extractText(raw.message?.content) || extractText(raw.content),
        raw,
      },
    ];
  }

  if (raw.type === "assistant") {
    const content = raw.message?.content;
    if (Array.isArray(content)) {
      const events: NormalizedEvent[] = [];
      const textParts: string[] = [];
      for (const block of content as any[]) {
        if (!block || typeof block !== "object") continue;
        if (block.type === "text" && typeof block.text === "string") {
          textParts.push(block.text);
        } else if (block.type === "tool_use") {
          events.push(toolCallFrom(block, ts, raw));
        }
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
    }
    return [
      {
        kind: "assistant",
        ts,
        text: extractText(content),
        raw,
      },
    ];
  }

  if (raw.type === "summary") {
    return [
      {
        kind: "assistant",
        ts,
        text:
          typeof raw.summary === "string"
            ? `[summary] ${raw.summary}`
            : extractText(raw.summary),
        raw,
      },
    ];
  }

  return [rawFallback(raw, ts)];
}

function toolCallFrom(block: any, ts: string | undefined, raw: any): NormalizedEvent {
  const toolName: string = block.name ?? "";
  const input = block.input ?? {};
  const base: NormalizedEvent = {
    kind: "tool_call",
    ts,
    toolName,
    toolUseId: block.id,
    args: input,
    raw,
  };
  // Lift file path for Write/Edit/MultiEdit to make file-write events obvious.
  if (
    toolName === "Write" ||
    toolName === "Edit" ||
    toolName === "MultiEdit" ||
    toolName === "write" ||
    toolName === "edit"
  ) {
    base.path = input.file_path ?? input.path ?? input.filename;
    base.kind = "file_write";
    if (typeof input.content === "string") {
      base.bytes = Buffer.byteLength(input.content, "utf8");
    }
  }
  if (toolName === "TodoWrite" && Array.isArray(input.todos)) {
    base.kind = "todo";
    base.todos = (input.todos as any[]).map((t) => ({
      content: String(t.content ?? ""),
      status: String(t.status ?? "pending"),
      priority: t.priority ? String(t.priority) : undefined,
    }));
  }
  return base;
}

function extractText(content: unknown): string | undefined {
  if (content == null) return undefined;
  if (typeof content === "string") return content;
  if (Array.isArray(content)) {
    const parts: string[] = [];
    for (const b of content as any[]) {
      if (!b) continue;
      if (typeof b === "string") parts.push(b);
      else if (typeof b?.text === "string") parts.push(b.text);
      else if (typeof b?.content === "string") parts.push(b.content);
    }
    return parts.join("\n").trim() || undefined;
  }
  if (typeof (content as any)?.text === "string") return (content as any).text;
  return undefined;
}

function rawFallback(raw: unknown, ts?: string): NormalizedEvent {
  return { kind: "raw", ts, raw };
}
