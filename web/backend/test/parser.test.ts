import { describe, expect, it } from "vitest";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { parseCheckpointsBranch } from "../src/parser.js";

const __dirname = dirname(fileURLToPath(import.meta.url));
const DEVLOG = join(__dirname, "fixtures", "devlog-real");

describe("parser — real entire-cli format", () => {
  it("parses a real devlog checkpoint", () => {
    const cps = parseCheckpointsBranch(DEVLOG, 10);
    expect(cps.length).toBe(1);
    const cp = cps[0];
    expect(cp.checkpointId).toBe("18a01d659c86");
    expect(cp.strategy).toBe("manual-commit");
    expect(cp.branch).toBe("master");
    expect(cp.filesTouched.length).toBeGreaterThan(0);
    expect(cp.tokenUsage.input_tokens).toBe(207);
    expect(cp.tokenUsage.api_call_count).toBe(170);
  });

  it("extracts all sessions under the checkpoint with real fields", () => {
    const [cp] = parseCheckpointsBranch(DEVLOG, 10);
    expect(cp.sessions.length).toBe(2);

    const s0 = cp.sessions[0];
    expect(s0.index).toBe(0);
    expect(s0.agent).toBe("Claude Code");
    expect(s0.strategy).toBe("manual-commit");
    expect(s0.sessionId).toBe("71b7ebb0-9f9c-436f-9037-b8ec1849d6a0");
    expect(s0.turnId).toBe("413db266526b");
    expect(s0.branch).toBe("master");
    expect(s0.startedAt).toBe("2026-02-21T11:30:31.117538Z");
    expect(s0.endedAt).toBeNull();
    expect(s0.filesTouched.length).toBeGreaterThan(0);
    expect(s0.prompt && s0.prompt.length).toBeGreaterThan(0);
    expect(s0.events.length).toBeGreaterThan(0);
    expect(s0.attribution?.total_committed).toBe(125);
  });

  it("computes checkpoint createdAt from earliest session", () => {
    const [cp] = parseCheckpointsBranch(DEVLOG, 10);
    expect(cp.createdAt).toBe("2026-02-21T11:30:31.117538Z");
  });

  it("tolerates a non-JSONL transcript (session 1 is plain text)", () => {
    const [cp] = parseCheckpointsBranch(DEVLOG, 10);
    const s1 = cp.sessions.find((s) => s.index === 1)!;
    expect(s1.agent).toBe("Claude Code");
    // Plain-text "transcript" — parser emits zero events but does not throw.
    expect(Array.isArray(s1.events)).toBe(true);
    expect(s1.events.length).toBe(0);
  });

  it("returns empty for a non-existent root", () => {
    expect(parseCheckpointsBranch("/nope/does/not/exist", 3)).toEqual([]);
  });
});
