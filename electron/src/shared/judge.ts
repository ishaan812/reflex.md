// Structured verdict returned by the AI judge (Gemini today, Claude/other
// later). Kept source-agnostic on purpose so multiple judges can coexist.

export interface JudgeIssue {
  title: string;
  severity: "low" | "med" | "high";
  description: string;
  /** True if the judge thinks this is a pattern the user/agent keeps repeating. */
  recurring: boolean;
  /** Optional pointer into the transcript (turn index). */
  at_turn_index?: number;
}

export interface SessionJudgment {
  session_id: string;
  source: string;
  judge: string; // "gemini-2.5-flash" etc.
  judged_at: string;

  /** 0..100, independent of the heuristic rating. */
  score: number;
  /** One-line headline for this session. */
  summary: string;

  strengths: string[];
  issues: JudgeIssue[];

  /** Things the *user* is repeatedly doing that hurt results. */
  user_patterns: string[];
  /** Things the *agent* is repeatedly doing that hurt results. */
  agent_patterns: string[];

  /** Concrete next-time-do-this advice, prioritized. */
  actionable_advice: string[];

  /** Inferred repo / working directory from the transcript, if any. */
  repo?: string | null;

  /** Tokens used by the judge call (for metering). */
  tokens?: {
    prompt?: number;
    completion?: number;
  };
  /** Raw judge output (prompt + response) for debugging — truncated. */
  raw?: string;
}

// --- Cross-session / repo-wide analysis -----------------------------------

export interface RepoInsight {
  repo: string;
  session_count: number;
  /** Average score across per-session judgments in this repo. */
  score_avg: number;
  judge: string;
  evaluated_at: string;

  /** One/two-sentence headline across all sessions for this repo. */
  summary: string;
  /** Issues that actually recur across multiple sessions. */
  recurring_issues: JudgeIssue[];
  /** User patterns that recur (across sessions). */
  recurring_user_patterns: string[];
  /** Agent patterns that recur (across sessions). */
  recurring_agent_patterns: string[];
  /** Prioritised do-this advice for this repo specifically. */
  actionable_advice: string[];

  /** The actual AGENTS_CONTEXT.md body — paste into the repo's agent context file. */
  context_md: string;

  tokens?: {
    prompt?: number;
    completion?: number;
  };
}

export interface RepoSummary {
  repo: string;
  session_count: number;
  /** Oldest → newest session timestamps in this repo. */
  first_ts: string;
  last_ts: string;
  judgment_count: number;
  score_avg: number | null; // null if no judgments yet
  has_insight: boolean;
}
