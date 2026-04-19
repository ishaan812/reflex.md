import { describe, expect, it } from "vitest";
import { canonicalAgent, normalizeEvents } from "../src/adapters/index.js";

const T0 = 1_700_000_000_000; // 2023-11-14T22:13:20.000Z
const iso = (ms: number) => new Date(ms).toISOString();

describe("OpenCode adapter — basics", () => {
  it("normalizes a text user message", () => {
    const msg = {
      info: { role: "user", time: { created: T0 } },
      parts: [{ type: "text", text: "please refactor the login flow" }],
    };
    const out = normalizeEvents("OpenCode", [msg]);
    expect(out).toHaveLength(1);
    expect(out[0].kind).toBe("user");
    expect(out[0].text).toBe("please refactor the login flow");
    expect(out[0].ts).toBe(iso(T0));
  });

  it("splits assistant text + tool-invocation into paired call + result", () => {
    const msg = {
      info: { role: "assistant", time: { created: T0, updated: T0 + 500 } },
      parts: [
        { type: "text", text: "I'll run the tests." },
        {
          type: "tool-invocation",
          toolInvocation: {
            toolCallId: "call_1",
            toolName: "bash",
            args: { command: "pnpm test" },
            state: "result",
            result: "PASS 42 tests",
          },
        },
      ],
    };
    const out = normalizeEvents("OpenCode", [msg]);
    expect(out.map((e) => e.kind)).toEqual([
      "assistant",
      "tool_call",
      "tool_result",
    ]);
    expect(out[1].toolName).toBe("bash");
    expect(out[1].toolUseId).toBe("call_1");
    expect(out[2].toolUseId).toBe("call_1");
    expect(out[2].exitCode).toBe(0);
    expect(out[2].text).toBe("PASS 42 tests");
  });

  it("emits only tool_call for a pending tool-invocation (no result)", () => {
    const msg = {
      info: { role: "assistant", time: { created: T0 } },
      parts: [
        {
          type: "tool-invocation",
          toolInvocation: {
            toolCallId: "call_2",
            toolName: "bash",
            args: { command: "ls" },
            state: "call",
          },
        },
      ],
    };
    const out = normalizeEvents("OpenCode", [msg]);
    expect(out).toHaveLength(1);
    expect(out[0].kind).toBe("tool_call");
    expect(out[0].toolUseId).toBe("call_2");
  });

  it("silently skips step-start / step-finish parts", () => {
    const msg = {
      info: { role: "assistant", time: { created: T0 } },
      parts: [
        { type: "step-start" },
        { type: "text", text: "hello" },
        { type: "step-finish", reason: "stop" },
      ],
    };
    const out = normalizeEvents("OpenCode", [msg]);
    expect(out).toHaveLength(1);
    expect(out[0].kind).toBe("assistant");
    expect(out[0].text).toBe("hello");
  });
});

describe("OpenCode adapter — exitCode derivation", () => {
  const assistantWith = (inv: any) => ({
    info: { role: "assistant", time: { created: T0 } },
    parts: [{ type: "tool-invocation", toolInvocation: inv }],
  });

  it("state=\"error\" -> exitCode 1", () => {
    const out = normalizeEvents("OpenCode", [
      assistantWith({
        toolCallId: "c",
        toolName: "bash",
        args: {},
        state: "error",
        result: "boom",
      }),
    ]);
    const res = out.find((e) => e.kind === "tool_result")!;
    expect(res.exitCode).toBe(1);
  });

  it("result.error truthy -> exitCode 1", () => {
    const out = normalizeEvents("OpenCode", [
      assistantWith({
        toolCallId: "c",
        toolName: "bash",
        args: {},
        state: "result",
        result: { error: "ENOENT", stdout: "" },
      }),
    ]);
    const res = out.find((e) => e.kind === "tool_result")!;
    expect(res.exitCode).toBe(1);
  });

  it("numeric result.exitCode is preserved", () => {
    const out = normalizeEvents("OpenCode", [
      assistantWith({
        toolCallId: "c",
        toolName: "bash",
        args: {},
        state: "result",
        result: { exitCode: 127 },
      }),
    ]);
    const res = out.find((e) => e.kind === "tool_result")!;
    expect(res.exitCode).toBe(127);
  });

  it("shell-error text pattern -> exitCode 1", () => {
    const out = normalizeEvents("OpenCode", [
      assistantWith({
        toolCallId: "c",
        toolName: "bash",
        args: {},
        state: "result",
        result: "bash: cmd: command not found\nexited with 1",
      }),
    ]);
    const res = out.find((e) => e.kind === "tool_result")!;
    expect(res.exitCode).toBe(1);
  });

  it("clean string result -> exitCode 0", () => {
    const out = normalizeEvents("OpenCode", [
      assistantWith({
        toolCallId: "c",
        toolName: "bash",
        args: {},
        state: "result",
        result: "ok",
      }),
    ]);
    const res = out.find((e) => e.kind === "tool_result")!;
    expect(res.exitCode).toBe(0);
  });
});

describe("OpenCode adapter — tool-kind lifting", () => {
  it("write tool becomes file_write with path + bytes", () => {
    const msg = {
      info: { role: "assistant", time: { created: T0 } },
      parts: [
        {
          type: "tool-invocation",
          toolInvocation: {
            toolCallId: "c",
            toolName: "write",
            args: { file_path: "src/a.ts", content: "export const a = 1;\n" },
            state: "result",
            result: "ok",
          },
        },
      ],
    };
    const out = normalizeEvents("OpenCode", [msg]);
    const call = out.find((e) => e.kind === "file_write")!;
    expect(call.path).toBe("src/a.ts");
    expect(call.bytes).toBe(Buffer.byteLength("export const a = 1;\n", "utf8"));
  });

  it("todowrite tool becomes todo with todos list", () => {
    const msg = {
      info: { role: "assistant", time: { created: T0 } },
      parts: [
        {
          type: "tool-invocation",
          toolInvocation: {
            toolCallId: "c",
            toolName: "todowrite",
            args: {
              todos: [
                { content: "A", status: "pending" },
                { content: "B", status: "completed", priority: "high" },
              ],
            },
            state: "result",
            result: "ok",
          },
        },
      ],
    };
    const out = normalizeEvents("OpenCode", [msg]);
    const todoCall = out.find((e) => e.kind === "todo")!;
    expect(todoCall.todos).toHaveLength(2);
    expect(todoCall.todos?.[1].priority).toBe("high");
  });

  it("multiedit is lifted to file_write", () => {
    const msg = {
      info: { role: "assistant", time: { created: T0 } },
      parts: [
        {
          type: "tool-invocation",
          toolInvocation: {
            toolCallId: "c",
            toolName: "multiedit",
            args: { file_path: "src/b.ts", edits: [] },
            state: "result",
            result: "ok",
          },
        },
      ],
    };
    const out = normalizeEvents("OpenCode", [msg]);
    const write = out.find((e) => e.kind === "file_write")!;
    expect(write.path).toBe("src/b.ts");
  });
});

describe("Agent name canonicalization", () => {
  it("matches common Claude Code variants", () => {
    expect(canonicalAgent("Claude Code")).toBe("claudecode");
    expect(canonicalAgent("claude-code")).toBe("claudecode");
    expect(canonicalAgent("Claude_Code")).toBe("claudecode");
    expect(canonicalAgent("ClaudeCode")).toBe("claudecode");
    expect(canonicalAgent("Claude Code 1.2.3")).toBe("claudecode");
  });

  it("matches common OpenCode variants", () => {
    expect(canonicalAgent("OpenCode")).toBe("opencode");
    expect(canonicalAgent("opencode-cli")).toBe("opencode");
    expect(canonicalAgent("Open_Code")).toBe("opencode");
  });

  it("unknown agents fall through", () => {
    expect(canonicalAgent("Cursor")).toBe("cursor");
    expect(canonicalAgent(null)).toBe("");
  });

  it("loosely-named OpenCode events dispatch to OpenCode adapter", () => {
    const msg = {
      info: { role: "user", time: { created: T0 } },
      parts: [{ type: "text", text: "hi" }],
    };
    const out = normalizeEvents("open-code cli", [msg]);
    expect(out).toHaveLength(1);
    expect(out[0].kind).toBe("user");
    expect(out[0].text).toBe("hi");
  });
});
