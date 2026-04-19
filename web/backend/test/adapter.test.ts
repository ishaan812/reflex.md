import { describe, expect, it } from "vitest";
import { normalizeEvents } from "../src/adapters/index.js";

describe("Claude Code adapter", () => {
  it("normalizes a string-content user entry", () => {
    const out = normalizeEvents("Claude Code", [
      {
        type: "user",
        message: { role: "user", content: "please add login" },
        timestamp: "2026-01-01T00:00:00Z",
      },
    ]);
    expect(out.length).toBe(1);
    expect(out[0].kind).toBe("user");
    expect(out[0].text).toBe("please add login");
    expect(out[0].ts).toBe("2026-01-01T00:00:00Z");
  });

  it("normalizes assistant text + tool_use as multiple events", () => {
    const out = normalizeEvents("Claude Code", [
      {
        type: "assistant",
        timestamp: "2026-01-01T00:00:10Z",
        message: {
          role: "assistant",
          content: [
            { type: "text", text: "I'll write the file." },
            { type: "tool_use", id: "t1", name: "Write", input: { file_path: "a.ts", content: "export const a=1;" } },
          ],
        },
      },
    ]);
    expect(out.length).toBe(2);
    expect(out[0].kind).toBe("assistant");
    expect(out[0].text).toBe("I'll write the file.");
    expect(out[1].kind).toBe("file_write");
    expect(out[1].toolName).toBe("Write");
    expect(out[1].path).toBe("a.ts");
    expect(out[1].bytes).toBeGreaterThan(0);
  });

  it("lifts TodoWrite into a todo event", () => {
    const out = normalizeEvents("Claude Code", [
      {
        type: "assistant",
        message: {
          content: [
            {
              type: "tool_use",
              id: "t2",
              name: "TodoWrite",
              input: {
                todos: [
                  { content: "A", status: "pending" },
                  { content: "B", status: "completed" },
                ],
              },
            },
          ],
        },
      },
    ]);
    expect(out.length).toBe(1);
    expect(out[0].kind).toBe("todo");
    expect(out[0].todos?.length).toBe(2);
    expect(out[0].todos?.[1].status).toBe("completed");
  });

  it("maps tool_result envelopes to tool_result events", () => {
    const out = normalizeEvents("Claude Code", [
      {
        type: "user",
        message: {
          content: [
            {
              type: "tool_result",
              tool_use_id: "t1",
              content: "exit code 1\nerror: boom",
              is_error: true,
            },
          ],
        },
      },
    ]);
    expect(out.length).toBe(1);
    expect(out[0].kind).toBe("tool_result");
    expect(out[0].toolUseId).toBe("t1");
    expect(out[0].exitCode).toBe(1);
    expect(out[0].text).toContain("boom");
  });

  it("passes unknown Claude Code entry types through as raw", () => {
    const out = normalizeEvents("Claude Code", [
      { type: "file-history-snapshot", messageId: "x", snapshot: {} },
      { type: "progress", data: { kind: "tokens" } },
    ]);
    expect(out.map((e) => e.kind)).toEqual(["raw", "raw"]);
  });

  it("non-Claude-Code agents fall through to raw passthrough", () => {
    const out = normalizeEvents("Cursor", [{ foo: "bar", timestamp: "t" }]);
    expect(out.length).toBe(1);
    expect(out[0].kind).toBe("raw");
    expect(out[0].ts).toBe("t");
  });
});
