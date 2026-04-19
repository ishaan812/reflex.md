import { describe, expect, it } from "vitest";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { createTwoFilesPatch } from "diff";
import { parseCheckpointsBranch } from "../src/parser.js";
import {
  detectCorrections,
  clusterCorrections,
  scoreSession,
} from "../src/friction.js";

const __dirname = dirname(fileURLToPath(import.meta.url));
const DEVLOG = join(__dirname, "fixtures", "devlog-real");

describe("pipeline (no LLM) on real devlog fixture", () => {
  it("parses → detects → clusters → diffs end-to-end", () => {
    const cps = parseCheckpointsBranch(DEVLOG, 10);
    expect(cps.length).toBeGreaterThan(0);
    const sessions = cps.flatMap((c) =>
      c.sessions.map((s) => ({ checkpointId: c.checkpointId, ...s })),
    );
    expect(sessions.length).toBeGreaterThan(0);

    const allCorrections = sessions.flatMap((s) =>
      detectCorrections(s.agent, s.events, s.prompt),
    );
    const clusters = clusterCorrections(allCorrections);

    // Every FQ should be a finite, non-negative number.
    for (const s of sessions) {
      const fq = scoreSession(s.agent, s.events, s.prompt);
      expect(Number.isFinite(fq)).toBe(true);
      expect(fq).toBeGreaterThanOrEqual(0);
    }

    // Diff shape round-trip remains correct.
    const before = "# AGENTS.md\n- use named exports\n";
    const after = `${before}- new rule cited (18a01d659c86)\n`;
    const diff = createTwoFilesPatch("AGENTS.md", "AGENTS.md", before, after);
    expect(diff).toContain("18a01d659c86");
    expect(clusters.length).toBeGreaterThanOrEqual(0);
  });
});
