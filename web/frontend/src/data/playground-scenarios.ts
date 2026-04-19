/**
 * Canned scenarios for the public Playground page.
 *
 * These are hand-crafted to mirror what Reflex.md would see on a real repo:
 *   • raw transcript events (what the agent + user produced)
 *   • detected friction signals (what Reflex's parser extracts)
 *   • a correction cluster (what similar signals collapse into)
 *   • the AGENTS.md edit we'd propose
 *   • a "before / after merge" dramatization of agent behavior
 *
 * Every field is static data — no backend required. All scenarios intentionally
 * use agent+session IDs that show up in the transcript so the evidence chain
 * is legible end-to-end.
 */

export type TranscriptEventKind =
  | "system"
  | "you"
  | "agent"
  | "tool_call"
  | "tool_result_ok"
  | "tool_result_err"
  | "diff_add"
  | "diff_remove"
  | "diff_header"
  | "blank";

export interface TranscriptEvent {
  /** Visual category — drives colour + gutter char. */
  kind: TranscriptEventKind;
  /** Raw text (we do NOT typewriter-animate this; see TranscriptPlayer). */
  text: string;
  /** Stable id so we can highlight this line when its signal pill is hovered. */
  id: string;
  /** Fake session label shown as an "## Session abcd1234" header above. */
  sessionHeader?: string;
  /** If this line is a detected friction signal, its signal id. */
  signalId?: string;
}

export type SignalKind = "explicit" | "tool_retry";

export interface DetectedSignal {
  id: string;
  kind: SignalKind;
  /** Short label, e.g. "Negation matched: don't" */
  label: string;
  /** The evidence line text (will match a TranscriptEvent.text). */
  evidence: string;
  /** Matching transcript event id — lets us scroll+flash when hovered. */
  eventId: string;
  /** Friction intensity contributed (mirrors backend friction.ts). */
  intensity: 1 | 2;
  /** Short explanation of the detector rule. */
  rule: string;
}

export interface ClusterSample {
  quote: string;
  sessionId: string;
}

export interface Cluster {
  key: string;
  count: number;
  totalIntensity: number;
  samples: ClusterSample[];
}

export interface AgentsDiff {
  path: string;
  /** Lines rendered in red with `-` gutter. */
  beforeLines: string[];
  /** Lines rendered in green with `+` gutter. */
  afterLines: string[];
  /** Plain-English "why this change" citations. */
  reasoning: Array<{
    rule: string;
    evidence: string;
    sessionIds: string[];
  }>;
}

export interface BehaviorTerminal {
  label: string;
  events: TranscriptEvent[];
  /** Final one-liner result, rendered as a footer pill. */
  verdict: string;
  verdictTone: "red" | "green";
}

export interface PlaygroundScenario {
  id: string;
  /** Tab label e.g. "Barrel exports". */
  title: string;
  /** Short subtitle shown under the tab description. */
  subtitle: string;
  /** Signal kinds this scenario demonstrates — drives eyebrow chip. */
  signalKinds: SignalKind[];
  /** Session timeline in Stage 1. */
  transcript: TranscriptEvent[];
  /** Parsed out of the transcript in Stage 2. */
  signals: DetectedSignal[];
  /** Cluster produced in Stage 3. */
  cluster: Cluster;
  /** Friction Quotient headline (mirrors backend scoring). */
  frictionScore: number;
  /** AGENTS.md edit in Stage 4. */
  diff: AgentsDiff;
  /** Stage 5 side-by-side. */
  before: BehaviorTerminal;
  after: BehaviorTerminal;
}

// ────────────────────────────────────────────────────────────────────────────
// Scenario 1 — Explicit corrections: barrel exports
// ────────────────────────────────────────────────────────────────────────────

const barrelExports: PlaygroundScenario = {
  id: "barrel-exports",
  title: "Barrel exports",
  subtitle: "Two agents, same mistake, twice a week.",
  signalKinds: ["explicit"],
  transcript: [
    {
      id: "bx-s1-h",
      kind: "system",
      text: "## Session 2a1f3c — claude-code · mon 14:02",
      sessionHeader: "2a1f3c",
    },
    {
      id: "bx-s1-you-1",
      kind: "you",
      text: "add a util for toast notifications",
    },
    {
      id: "bx-s1-agent-1",
      kind: "agent",
      text: "Added src/ui/index.ts re-exporting Toast, Toaster, useToast.",
    },
    {
      id: "bx-s1-you-2",
      kind: "you",
      text: "no — don't use barrel exports. import directly from ./toast.",
      signalId: "sig-bx-1",
    },
    { id: "bx-s1-blank", kind: "blank", text: "" },

    {
      id: "bx-s2-h",
      kind: "system",
      text: "## Session 8c3b91 — cursor · thu 09:47",
      sessionHeader: "8c3b91",
    },
    {
      id: "bx-s2-you-1",
      kind: "you",
      text: "wire up the settings page",
    },
    {
      id: "bx-s2-agent-1",
      kind: "agent",
      text: "Updated src/settings/index.ts to re-export Panel, Row, Toggle.",
    },
    {
      id: "bx-s2-you-2",
      kind: "you",
      text: "stop. don't re-export from index.ts. we never use barrels.",
      signalId: "sig-bx-2",
    },
    { id: "bx-s2-blank", kind: "blank", text: "" },

    {
      id: "bx-s3-h",
      kind: "system",
      text: "## Session f00abc — claude-code · fri 18:20",
      sessionHeader: "f00abc",
    },
    {
      id: "bx-s3-you-1",
      kind: "you",
      text: "expose the new analytics hooks",
    },
    {
      id: "bx-s3-agent-1",
      kind: "agent",
      text: "Created src/analytics/index.ts with named re-exports.",
    },
    {
      id: "bx-s3-you-2",
      kind: "you",
      text: "that's wrong. import from the source module. no barrels.",
      signalId: "sig-bx-3",
    },
  ],
  signals: [
    {
      id: "sig-bx-1",
      kind: "explicit",
      label: "Negation · “no … don't”",
      evidence: "no — don't use barrel exports. import directly from ./toast.",
      eventId: "bx-s1-you-2",
      intensity: 1,
      rule: "User text matched NEGATION_RE in friction.ts",
    },
    {
      id: "sig-bx-2",
      kind: "explicit",
      label: "Negation · “stop … don't”",
      evidence: "stop. don't re-export from index.ts. we never use barrels.",
      eventId: "bx-s2-you-2",
      intensity: 1,
      rule: "User text matched NEGATION_RE in friction.ts",
    },
    {
      id: "sig-bx-3",
      kind: "explicit",
      label: "Negation · “that's wrong”",
      evidence: "that's wrong. import from the source module. no barrels.",
      eventId: "bx-s3-you-2",
      intensity: 1,
      rule: "User text matched NEGATION_RE in friction.ts",
    },
  ],
  cluster: {
    key: "barrel exports index.ts re-export",
    count: 3,
    totalIntensity: 3,
    samples: [
      {
        quote: "no — don't use barrel exports. import directly from ./toast.",
        sessionId: "2a1f3c",
      },
      {
        quote: "stop. don't re-export from index.ts. we never use barrels.",
        sessionId: "8c3b91",
      },
      {
        quote: "that's wrong. import from the source module. no barrels.",
        sessionId: "f00abc",
      },
    ],
  },
  frictionScore: 0.42,
  diff: {
    path: "AGENTS.md",
    beforeLines: [
      "## Code style",
      "",
      "- Prefer small, composable modules.",
      "- Keep files under 300 lines where practical.",
    ],
    afterLines: [
      "## Code style",
      "",
      "- Prefer small, composable modules.",
      "- Keep files under 300 lines where practical.",
      "- **Never use barrel exports.** Do not create or add to `index.ts`",
      "  files that re-export from sibling modules. Import each symbol",
      "  directly from the source file.",
    ],
    reasoning: [
      {
        rule: "Never use barrel exports",
        evidence:
          "Three sessions across claude-code and cursor ended with the user rejecting a re-export from index.ts.",
        sessionIds: ["2a1f3c", "8c3b91", "f00abc"],
      },
    ],
  },
  before: {
    label: "Before merge · wed morning",
    verdict: "friction · user corrects again",
    verdictTone: "red",
    events: [
      {
        id: "bx-b-1",
        kind: "you",
        text: "add a hook for feature flags",
      },
      {
        id: "bx-b-2",
        kind: "agent",
        text: "Added src/flags/index.ts re-exporting useFlag, FlagProvider.",
      },
      {
        id: "bx-b-3",
        kind: "you",
        text: "no. import from ./useFlag directly. we don't do barrels.",
      },
    ],
  },
  after: {
    label: "After merge · next morning",
    verdict: "clean run · 0 corrections",
    verdictTone: "green",
    events: [
      {
        id: "bx-a-0",
        kind: "system",
        text: "(loaded AGENTS.md · rule: never use barrel exports)",
      },
      {
        id: "bx-a-1",
        kind: "you",
        text: "add a hook for feature flags",
      },
      {
        id: "bx-a-2",
        kind: "agent",
        text: "Added src/flags/useFlag.ts. Imported directly where used.",
      },
      {
        id: "bx-a-3",
        kind: "you",
        text: "lgtm, merged.",
      },
    ],
  },
};

// ────────────────────────────────────────────────────────────────────────────
// Scenario 2 — Tool retry loop: pnpm build against the same TS error
// ────────────────────────────────────────────────────────────────────────────

const rebuildLoop: PlaygroundScenario = {
  id: "rebuild-loop",
  title: "Rebuild loop",
  subtitle: "Agent keeps re-running a failing build instead of reading it.",
  signalKinds: ["tool_retry"],
  transcript: [
    {
      id: "rb-h",
      kind: "system",
      text: "## Session d41d8c — claude-code · tue 11:08",
      sessionHeader: "d41d8c",
    },
    {
      id: "rb-you",
      kind: "you",
      text: "ship the types for the new api client",
    },
    {
      id: "rb-agent-1",
      kind: "agent",
      text: "Running pnpm build to verify…",
    },
    {
      id: "rb-call-1",
      kind: "tool_call",
      text: "$ pnpm build",
    },
    {
      id: "rb-err-1",
      kind: "tool_result_err",
      text: "✗ exit 2 · TS2345: Argument of type 'string | null' not assignable to 'string'",
      signalId: "sig-rb-1",
    },
    {
      id: "rb-agent-2",
      kind: "agent",
      text: "Let me try again.",
    },
    {
      id: "rb-call-2",
      kind: "tool_call",
      text: "$ pnpm build",
    },
    {
      id: "rb-err-2",
      kind: "tool_result_err",
      text: "✗ exit 2 · TS2345: Argument of type 'string | null' not assignable to 'string'",
      signalId: "sig-rb-2",
    },
    {
      id: "rb-agent-3",
      kind: "agent",
      text: "Retrying…",
    },
    {
      id: "rb-call-3",
      kind: "tool_call",
      text: "$ pnpm build",
    },
    {
      id: "rb-err-3",
      kind: "tool_result_err",
      text: "✗ exit 2 · TS2345: Argument of type 'string | null' not assignable to 'string'",
      signalId: "sig-rb-3",
    },
    {
      id: "rb-you-2",
      kind: "you",
      text: "stop re-running build. read the error and fix the type.",
      signalId: "sig-rb-4",
    },
  ],
  signals: [
    {
      id: "sig-rb-1",
      kind: "tool_retry",
      label: "Tool retry · pnpm build (1/3)",
      evidence: "exit 2 → pnpm build re-invoked within 12s",
      eventId: "rb-err-1",
      intensity: 2,
      rule: "Non-zero exit_code followed by same-tool call in <60s",
    },
    {
      id: "sig-rb-2",
      kind: "tool_retry",
      label: "Tool retry · pnpm build (2/3)",
      evidence: "exit 2 → pnpm build re-invoked within 9s",
      eventId: "rb-err-2",
      intensity: 2,
      rule: "Non-zero exit_code followed by same-tool call in <60s",
    },
    {
      id: "sig-rb-3",
      kind: "tool_retry",
      label: "Tool retry · pnpm build (3/3)",
      evidence: "exit 2 → pnpm build re-invoked within 8s",
      eventId: "rb-err-3",
      intensity: 2,
      rule: "Non-zero exit_code followed by same-tool call in <60s",
    },
    {
      id: "sig-rb-4",
      kind: "explicit",
      label: "Negation · “stop”",
      evidence: "stop re-running build. read the error and fix the type.",
      eventId: "rb-you-2",
      intensity: 1,
      rule: "User text matched NEGATION_RE in friction.ts",
    },
  ],
  cluster: {
    key: "pnpm build retry without reading error",
    count: 4,
    totalIntensity: 7,
    samples: [
      {
        quote: "exit 2 → pnpm build re-invoked (×3)",
        sessionId: "d41d8c",
      },
      {
        quote: "stop re-running build. read the error and fix the type.",
        sessionId: "d41d8c",
      },
    ],
  },
  frictionScore: 1.12,
  diff: {
    path: "AGENTS.md",
    beforeLines: [
      "## Running commands",
      "",
      "- Run `pnpm build` to verify type changes.",
      "- Run `pnpm test` before declaring done.",
    ],
    afterLines: [
      "## Running commands",
      "",
      "- Run `pnpm build` to verify type changes.",
      "- Run `pnpm test` before declaring done.",
      "- **Do not re-run a failing command with the same arguments.** If",
      "  `pnpm build` exits non-zero, read the full stderr, identify the",
      "  failing file:line, and fix the underlying code before re-running.",
    ],
    reasoning: [
      {
        rule: "Do not re-run a failing command with the same arguments",
        evidence:
          "pnpm build exited non-zero 3× in a row with an identical TS2345 message before the user intervened.",
        sessionIds: ["d41d8c"],
      },
    ],
  },
  before: {
    label: "Before merge · next type issue",
    verdict: "friction · 2 retries before user stops it",
    verdictTone: "red",
    events: [
      {
        id: "rb-b-1",
        kind: "you",
        text: "add a nullable updatedAt to User",
      },
      {
        id: "rb-b-2",
        kind: "tool_call",
        text: "$ pnpm build",
      },
      {
        id: "rb-b-3",
        kind: "tool_result_err",
        text: "✗ exit 2 · TS2322 on user.ts:41",
      },
      {
        id: "rb-b-4",
        kind: "tool_call",
        text: "$ pnpm build",
      },
      {
        id: "rb-b-5",
        kind: "tool_result_err",
        text: "✗ exit 2 · TS2322 on user.ts:41",
      },
      {
        id: "rb-b-6",
        kind: "you",
        text: "read the error. fix the type.",
      },
    ],
  },
  after: {
    label: "After merge · next type issue",
    verdict: "clean run · fixed on first read",
    verdictTone: "green",
    events: [
      {
        id: "rb-a-0",
        kind: "system",
        text: "(loaded AGENTS.md · rule: read failures before retrying)",
      },
      {
        id: "rb-a-1",
        kind: "you",
        text: "add a nullable updatedAt to User",
      },
      {
        id: "rb-a-2",
        kind: "tool_call",
        text: "$ pnpm build",
      },
      {
        id: "rb-a-3",
        kind: "tool_result_err",
        text: "✗ exit 2 · TS2322 on user.ts:41",
      },
      {
        id: "rb-a-4",
        kind: "agent",
        text: "user.ts:41 assigns Date to Date | null. Narrowing…",
      },
      {
        id: "rb-a-5",
        kind: "tool_call",
        text: "$ pnpm build",
      },
      {
        id: "rb-a-6",
        kind: "tool_result_ok",
        text: "✓ exit 0 · 12.4s",
      },
    ],
  },
};

// ────────────────────────────────────────────────────────────────────────────
// Scenario 3 — Mixed signals: wrong test runner (jest instead of vitest)
// ────────────────────────────────────────────────────────────────────────────

const wrongTestRunner: PlaygroundScenario = {
  id: "wrong-test-runner",
  title: "Wrong test runner",
  subtitle: "Defaults to jest · this repo is on vitest.",
  signalKinds: ["explicit", "tool_retry"],
  transcript: [
    {
      id: "wr-s1-h",
      kind: "system",
      text: "## Session 3e9b01 — cursor · wed 16:10",
      sessionHeader: "3e9b01",
    },
    {
      id: "wr-s1-you",
      kind: "you",
      text: "run the tests for the new parser",
    },
    {
      id: "wr-s1-call",
      kind: "tool_call",
      text: "$ npx jest src/parser.test.ts",
    },
    {
      id: "wr-s1-err",
      kind: "tool_result_err",
      text: "✗ exit 1 · cannot find module 'jest'",
      signalId: "sig-wr-1",
    },
    {
      id: "wr-s1-call-2",
      kind: "tool_call",
      text: "$ npx jest src/parser.test.ts --config jest.config.js",
    },
    {
      id: "wr-s1-err-2",
      kind: "tool_result_err",
      text: "✗ exit 1 · cannot find module 'jest'",
      signalId: "sig-wr-2",
    },
    {
      id: "wr-s1-you-2",
      kind: "you",
      text: "we use vitest. not jest.",
      signalId: "sig-wr-3",
    },
    { id: "wr-blank", kind: "blank", text: "" },

    {
      id: "wr-s2-h",
      kind: "system",
      text: "## Session a7c2f4 — claude-code · fri 10:02",
      sessionHeader: "a7c2f4",
    },
    {
      id: "wr-s2-you",
      kind: "you",
      text: "add a test for normalizeEvents",
    },
    {
      id: "wr-s2-agent",
      kind: "agent",
      text: "I'll scaffold a jest test with describe/it…",
    },
    {
      id: "wr-s2-you-2",
      kind: "you",
      text: "stop. this repo is vitest. use `import { describe, it, expect } from 'vitest'`.",
      signalId: "sig-wr-4",
    },
  ],
  signals: [
    {
      id: "sig-wr-1",
      kind: "tool_retry",
      label: "Tool retry · npx jest (1/2)",
      evidence: "exit 1 → jest re-invoked within 7s",
      eventId: "wr-s1-err",
      intensity: 2,
      rule: "Non-zero exit_code followed by same-tool call in <60s",
    },
    {
      id: "sig-wr-2",
      kind: "tool_retry",
      label: "Tool retry · npx jest (2/2)",
      evidence: "exit 1 → jest re-invoked within 6s",
      eventId: "wr-s1-err-2",
      intensity: 2,
      rule: "Non-zero exit_code followed by same-tool call in <60s",
    },
    {
      id: "sig-wr-3",
      kind: "explicit",
      label: "Negation · “we use vitest. not jest.”",
      evidence: "we use vitest. not jest.",
      eventId: "wr-s1-you-2",
      intensity: 1,
      rule: "User text matched NEGATION_RE in friction.ts",
    },
    {
      id: "sig-wr-4",
      kind: "explicit",
      label: "Negation · “stop … not jest”",
      evidence:
        "stop. this repo is vitest. use `import { describe, it, expect } from 'vitest'`.",
      eventId: "wr-s2-you-2",
      intensity: 1,
      rule: "User text matched NEGATION_RE in friction.ts",
    },
  ],
  cluster: {
    key: "jest vitest wrong test runner",
    count: 4,
    totalIntensity: 6,
    samples: [
      { quote: "we use vitest. not jest.", sessionId: "3e9b01" },
      {
        quote:
          "stop. this repo is vitest. use `import { describe, it, expect } from 'vitest'`.",
        sessionId: "a7c2f4",
      },
      {
        quote: "jest re-invoked 2× after 'cannot find module jest'",
        sessionId: "3e9b01",
      },
    ],
  },
  frictionScore: 0.83,
  diff: {
    path: "AGENTS.md",
    beforeLines: [
      "## Testing",
      "",
      "- Tests live next to the module as `*.test.ts`.",
    ],
    afterLines: [
      "## Testing",
      "",
      "- Tests live next to the module as `*.test.ts`.",
      "- **This repo uses Vitest, not Jest.** Import from `vitest`:",
      "  `import { describe, it, expect } from 'vitest'`. Run tests with",
      "  `pnpm test` (never `npx jest`). If a command complains it",
      "  cannot find `jest`, you are using the wrong runner.",
    ],
    reasoning: [
      {
        rule: "This repo uses Vitest, not Jest",
        evidence:
          "Two sessions reached for jest; the first retried 'cannot find module jest' twice before the user intervened.",
        sessionIds: ["3e9b01", "a7c2f4"],
      },
    ],
  },
  before: {
    label: "Before merge · next test task",
    verdict: "friction · wrong runner, 2 retries",
    verdictTone: "red",
    events: [
      {
        id: "wr-b-1",
        kind: "you",
        text: "add a test for the ingest route",
      },
      {
        id: "wr-b-2",
        kind: "tool_call",
        text: "$ npx jest ingest.test.ts",
      },
      {
        id: "wr-b-3",
        kind: "tool_result_err",
        text: "✗ exit 1 · cannot find module 'jest'",
      },
      {
        id: "wr-b-4",
        kind: "you",
        text: "vitest. stop trying jest.",
      },
    ],
  },
  after: {
    label: "After merge · next test task",
    verdict: "clean run · picks vitest on first try",
    verdictTone: "green",
    events: [
      {
        id: "wr-a-0",
        kind: "system",
        text: "(loaded AGENTS.md · rule: this repo uses vitest)",
      },
      {
        id: "wr-a-1",
        kind: "you",
        text: "add a test for the ingest route",
      },
      {
        id: "wr-a-2",
        kind: "agent",
        text: "Scaffolding with `import { describe, it, expect } from 'vitest'`.",
      },
      {
        id: "wr-a-3",
        kind: "tool_call",
        text: "$ pnpm test ingest.test.ts",
      },
      {
        id: "wr-a-4",
        kind: "tool_result_ok",
        text: "✓ exit 0 · 3 passed · 0.8s",
      },
    ],
  },
};

// ────────────────────────────────────────────────────────────────────────────

export const PLAYGROUND_SCENARIOS: PlaygroundScenario[] = [
  barrelExports,
  rebuildLoop,
  wrongTestRunner,
];

export function getScenario(id: string): PlaygroundScenario {
  return (
    PLAYGROUND_SCENARIOS.find((s) => s.id === id) ?? PLAYGROUND_SCENARIOS[0]
  );
}
