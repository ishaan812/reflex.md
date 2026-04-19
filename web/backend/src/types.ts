export interface TokenUsage {
  input_tokens?: number;
  cache_creation_tokens?: number;
  cache_read_tokens?: number;
  output_tokens?: number;
  api_call_count?: number;
}

export interface InitialAttribution {
  calculated_at?: string;
  agent_lines?: number;
  human_added?: number;
  human_modified?: number;
  human_removed?: number;
  total_committed?: number;
  agent_percentage?: number;
}

export interface ParsedSession {
  index: number;
  sessionId: string | null;
  agent: string;
  strategy: string;
  branch: string | null;
  turnId: string | null;
  filesTouched: string[];
  tokenUsage: TokenUsage;
  startedAt: string;
  endedAt: string | null;
  prompt: string | null;
  context: string | null;
  attribution: InitialAttribution | null;
  events: unknown[];
}

export interface ParsedCheckpoint {
  checkpointId: string;
  createdAt: string;
  branch: string | null;
  strategy: string;
  filesTouched: string[];
  tokenUsage: TokenUsage;
  sessions: ParsedSession[];
}

export type NormalizedKind =
  | "user"
  | "assistant"
  | "tool_call"
  | "tool_result"
  | "file_write"
  | "todo"
  | "raw";

export interface NormalizedEvent {
  kind: NormalizedKind;
  ts?: string;
  text?: string;
  toolName?: string;
  toolUseId?: string;
  args?: unknown;
  exitCode?: number;
  path?: string;
  bytes?: number;
  todos?: Array<{ content: string; status: string; priority?: string }>;
  raw: unknown;
}

export interface CorrectionSignal {
  kind: "explicit" | "tool_retry";
  intensity: number;
  text: string;
  ts?: string;
}

export interface CorrectionCluster {
  key: string;
  count: number;
  samples: string[];
  totalIntensity: number;
}

export interface ReasoningItem {
  rule: string;
  checkpointIds: string[];
  evidenceText: string;
}

export interface ProposedEdit {
  targetFile: string;
  afterText: string;
  reasoning: ReasoningItem[];
}
