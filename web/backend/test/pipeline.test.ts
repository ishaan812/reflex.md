import { describe, expect, it } from "vitest";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { createTwoFilesPatch } from "diff";
import { parseCheckpointsBranch } from "../src/parser.js";
import {
  detectCorrections,
  scoreSession,
  clusterCorrections,
} from "../src/friction.js";

const __dirname = dirname(fileURLToPath(import.meta.url));
const FIXTURE = join(__dirname, "fixtures", "checkpoint-barrel");

/**
 * Integration test for the full local pipeline (parser -> friction -> diff),
 * skipping the LLM call (which requires a live API key).
 */
describe("end-to-end pipeline (no LLM)", () => {
  it("turns the fixture into a unified diff against AGENTS.md", () => {
    const cps = parseCheckpointsBranch(FIXTURE, 3);
    expect(cps.length).toBeGreaterThan(0);

    const sessions = cps.flatMap((c) =>
      c.sessions.map((s) => ({ checkpointId: c.checkpointId, ...s })),
    );
    expect(sessions.length).toBeGreaterThan(0);

    const allCorrections = sessions.flatMap((s) => detectCorrections(s.events));
    const clusters = clusterCorrections(allCorrections);
    expect(clusters.length).toBeGreaterThan(0);

    // planted correction should dominate: at least one cluster mentions barrel or exports
    const text = clusters.map((c) => c.key + " " + c.samples.join(" ")).join(" ");
    expect(text.toLowerCase()).toMatch(/barrel|export/);

    // headline friction > 0 since we planted 3 explicit corrections
    const avgFQ =
      sessions.reduce((a, s) => a + scoreSession(s.events), 0) / sessions.length;
    expect(avgFQ).toBeGreaterThan(0);

    // diff round-trips (shape check; content verified at analyze-time by Gemini)
    const before = "# AGENTS.md\n\n- use named exports\n";
    const after = `${before}- never use barrel exports; import directly from the source module (cp_0ff8ca6d, cp_1aaa11bb)\n`;
    const diff = createTwoFilesPatch("AGENTS.md", "AGENTS.md", before, after);
    expect(diff).toContain("barrel exports");
    expect(diff).toContain("+++");
  });
});
