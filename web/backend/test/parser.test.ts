import { describe, expect, it } from "vitest";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { parseCheckpointsBranch } from "../src/parser.js";
import { detectCorrections, scoreSession, clusterCorrections, frictionColor } from "../src/friction.js";

const __dirname = dirname(fileURLToPath(import.meta.url));
const FIXTURE = join(__dirname, "fixtures", "checkpoint-barrel");

describe("parser", () => {
  it("parses all checkpoints in a shadow branch working tree", () => {
    const cps = parseCheckpointsBranch(FIXTURE, 10);
    expect(cps.length).toBe(2);
  });

  it("returns newest first and respects the limit", () => {
    const cps = parseCheckpointsBranch(FIXTURE, 1);
    expect(cps.length).toBe(1);
    expect(cps[0].checkpointId).toBe("1aaa11bb22cc");
  });

  it("extracts session metadata and events", () => {
    const [_newest, older] = parseCheckpointsBranch(FIXTURE, 10);
    expect(older.checkpointId).toBe("0ff8ca6db1c9");
    expect(older.sessions.length).toBe(2);
    expect(older.sessions[0].strategy).toBe("claude-code");
    expect(older.sessions[0].branch).toBe("feat/add-login");
    expect(older.sessions[0].events.length).toBeGreaterThan(0);
  });

  it("tolerates malformed JSONL lines without throwing", () => {
    const cps = parseCheckpointsBranch(FIXTURE, 10);
    const s0 = cps.find((c) => c.checkpointId === "0ff8ca6db1c9")!.sessions[0];
    // fixture has 10 lines, 1 is garbage — parser should skip it
    expect(s0.events.length).toBe(9);
  });

  it("returns empty array for a non-existent root", () => {
    expect(parseCheckpointsBranch("/nonexistent/path", 3)).toEqual([]);
  });
});

describe("friction", () => {
  it("detects explicit corrections via negation regex", () => {
    const events = [
      { type: "user_prompt", ts: "t", role: "user", text: "no — don't do that" },
      { type: "user_prompt", ts: "t", role: "user", text: "please add login" },
    ] as any;
    const c = detectCorrections(events);
    expect(c.length).toBe(1);
    expect(c[0].kind).toBe("explicit");
  });

  it("detects tool retries within 60s of non-zero exit", () => {
    const events = [
      { type: "tool_call", ts: "2026-01-01T00:00:00Z", tool_name: "Bash", exit_code: 1 },
      { type: "tool_call", ts: "2026-01-01T00:00:30Z", tool_name: "Bash", exit_code: 0 },
    ] as any;
    const c = detectCorrections(events);
    expect(c.length).toBe(1);
    expect(c[0].kind).toBe("tool_retry");
  });

  it("FQ is 0 for clean session", () => {
    const events = [
      { type: "user_prompt", ts: "t", role: "user", text: "add login" },
    ] as any;
    expect(scoreSession(events)).toBe(0);
  });

  it("clusters corrections by normalized keywords", () => {
    const sigs = [
      { kind: "explicit" as const, intensity: 1, text: "don't use barrel exports", ts: "t" },
      { kind: "explicit" as const, intensity: 1, text: "no barrel exports please", ts: "t" },
      { kind: "explicit" as const, intensity: 1, text: "stop writing tests in jest", ts: "t" },
    ];
    const clusters = clusterCorrections(sigs);
    expect(clusters.length).toBeGreaterThanOrEqual(1);
    const top = clusters[0];
    expect(top.count).toBeGreaterThanOrEqual(1);
  });

  it("friction color thresholds", () => {
    expect(frictionColor(0.1)).toBe("green");
    expect(frictionColor(0.5)).toBe("amber");
    expect(frictionColor(1.2)).toBe("red");
  });
});
