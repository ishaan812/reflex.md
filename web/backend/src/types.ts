export interface ParsedSession {
  index: number;
  strategy: string;
  branch: string | null;
  filesTouched: string[];
  tokenUsage: Record<string, unknown>;
  startedAt: string;
  endedAt: string | null;
  events: TranscriptEvent[];
}

export interface ParsedCheckpoint {
  checkpointId: string;
  createdAt: string;
  sessions: ParsedSession[];
}

export type TranscriptEvent =
  | { type: "user_prompt"; ts: string; role: "user"; text: string }
  | { type: "agent_response"; ts: string; role: "assistant"; text: string; toolCalls?: unknown[] }
  | { type: "tool_call"; ts: string; tool_call_id?: string; tool_name: string; args?: unknown; exit_code?: number }
  | { type: "tool_result"; ts: string; tool_call_id?: string; output?: string; exit_code?: number }
  | { type: "file_write"; ts: string; path: string; bytes?: number; hash?: string }
  | { type: string; ts: string; [key: string]: unknown };

export interface CorrectionSignal {
  kind: "explicit" | "tool_retry";
  intensity: number;
  text: string;
  ts: string;
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
