import { describe, expect, it } from "vitest";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import {
  detectCorrections,
  scoreSession,
  clusterCorrections,
  frictionColor,
} from "../src/friction.js";
import { parseCheckpointsBranch } from "../src/parser.js";

const __dirname = dirname(fileURLToPath(import.meta.url));
const DEVLOG = join(__dirname, "fixtures", "devlog-real");

describe("friction", () => {
  it("picks explicit corrections from normalized user events", () => {
    const sigs = detectCorrections(
      "Claude Code",
      [
        {
          type: "user",
          message: { content: "no, don't use barrel exports" },
          timestamp: "2026-01-01T00:00:00Z",
        },
        { type: "user", message: { content: "thanks" } },
      ],
      null,
    );
    expect(sigs.filter((s) => s.kind === "explicit").length).toBe(1);
  });

  it("picks a tool_retry when a failing tool_result is followed by a same-tool call", () => {
    const events = [
      {
        type: "assistant",
        timestamp: "2026-01-01T00:00:00Z",
        message: {
          content: [
            {
              type: "tool_use",
              id: "t1",
              name: "Bash",
              input: { command: "pnpm test" },
            },
          ],
        },
      },
      {
        type: "user",
        message: {
          content: [
            {
              type: "tool_result",
              tool_use_id: "t1",
              content: "exit 1",
              is_error: true,
            },
          ],
        },
        timestamp: "2026-01-01T00:00:10Z",
      },
      {
        type: "assistant",
        timestamp: "2026-01-01T00:00:30Z",
        message: {
          content: [
            {
              type: "tool_use",
              id: "t2",
              name: "Bash",
              input: { command: "pnpm test -- --run" },
            },
          ],
        },
      },
    ];
    const sigs = detectCorrections("Claude Code", events, null);
    expect(sigs.some((s) => s.kind === "tool_retry")).toBe(true);
  });

  it("falls back to prompt.txt when no normalized user events exist", () => {
    const sigs = detectCorrections(
      "Unknown",
      [],
      "no, don't do that.\n\nadd tests instead",
    );
    expect(sigs.length).toBeGreaterThan(0);
  });

  it("friction color thresholds", () => {
    expect(frictionColor(0)).toBe("green");
    expect(frictionColor(0.5)).toBe("amber");
    expect(frictionColor(1)).toBe("red");
  });

  it("clusters corrections by content", () => {
    const clusters = clusterCorrections([
      { kind: "explicit", intensity: 1, text: "no barrel exports" },
      { kind: "explicit", intensity: 1, text: "don't use barrel exports" },
      { kind: "explicit", intensity: 1, text: "stop writing tests in jest" },
    ]);
    expect(clusters.length).toBeGreaterThanOrEqual(1);
  });

  it("detects tool_retry for OpenCode sessions (regression: paired tool_call/tool_result)", () => {
    // Single OpenCode "document" containing two assistant messages: a failing
    // bash call followed by a retry of the same tool within the 60s window.
    const T = 1_700_000_000_000;
    const msg1 = {
      info: { role: "assistant", time: { created: T, updated: T + 200 } },
      parts: [
        {
          type: "tool-invocation",
          toolInvocation: {
            toolCallId: "a",
            toolName: "bash",
            args: { command: "pnpm test" },
            state: "error",
            result: "exit 1",
          },
        },
      ],
    };
    const msg2 = {
      info: {
        role: "assistant",
        time: { created: T + 10_000, updated: T + 10_500 },
      },
      parts: [
        {
          type: "tool-invocation",
          toolInvocation: {
            toolCallId: "b",
            toolName: "bash",
            args: { command: "pnpm test -- --run" },
            state: "result",
            result: "PASS",
          },
        },
      ],
    };
    const sigs = detectCorrections("OpenCode", [msg1, msg2], null);
    expect(sigs.some((s) => s.kind === "tool_retry")).toBe(true);
  });

  it("scores the real devlog session (smoke)", () => {
    const [cp] = parseCheckpointsBranch(DEVLOG, 10);
    for (const s of cp.sessions) {
      const fq = scoreSession(s.agent, s.events, s.prompt);
      expect(fq).toBeGreaterThanOrEqual(0);
    }
  });
});
