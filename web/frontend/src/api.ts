async function j<T>(r: Response): Promise<T> {
  if (r.ok) return (await r.json()) as T;
  const body = await r.text();
  let msg = body;
  try {
    const parsed = JSON.parse(body);
    msg = parsed.error ?? body;
  } catch {
    /* plain text */
  }
  const err = new Error(msg || `HTTP ${r.status}`);
  (err as any).status = r.status;
  throw err;
}

const init: RequestInit = { credentials: "include" };

export interface RepoSummary {
  owner: string;
  name: string;
  full_name: string;
  defaultBranch: string;
  private: boolean;
  pushedAt: string | null;
  description: string | null;
}

export interface SessionSummary {
  id: string;
  checkpointId: string;
  idx: number;
  agent: string | null;
  sessionId: string | null;
  turnId: string | null;
  strategy: string;
  branch: string | null;
  startedAt: string;
  endedAt: string | null;
  filesTouched: string[];
  tokenUsage: Record<string, unknown>;
  frictionScore: number;
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

export interface SessionDetail extends SessionSummary {
  prompt: string | null;
  context: string | null;
  attribution: Record<string, any> | null;
  events: unknown[];
  normalizedEvents: NormalizedEvent[];
  repo: { owner: string; name: string };
}

export interface ClusterOut {
  key: string;
  count: number;
  samples: string[];
  totalIntensity: number;
}

export interface AnalysisOut {
  id: string;
  repoId: string;
  createdAt: string;
  frictionScore: number;
  targetFile: string;
  beforeText: string;
  afterText: string;
  unifiedDiff: string;
  reasoning: Array<{ rule: string; checkpointIds: string[]; evidenceText: string }>;
  clusters: ClusterOut[];
  prNumber?: number | null;
  prUrl?: string | null;
}

export const api = {
  me: () => fetch("/api/me", init).then(j<{ login: string }>),
  logout: () => fetch("/auth/logout", { ...init, method: "POST" }).then(j),
  repos: () => fetch("/api/repos", init).then(j<RepoSummary[]>),
  session: (id: string) =>
    fetch(`/api/sessions/${id}`, init).then(j<SessionDetail>),
  ingest: (owner: string, name: string) =>
    fetch(`/api/repos/${owner}/${name}/ingest`, { ...init, method: "POST" }).then(
      j<{ repo: { id: string; owner: string; name: string }; sessions: SessionSummary[] }>,
    ),
  analyze: (owner: string, name: string) =>
    fetch(`/api/repos/${owner}/${name}/analyze`, { ...init, method: "POST" }).then(
      j<AnalysisOut>,
    ),
  openPr: (analysisId: string) =>
    fetch(`/api/analyses/${analysisId}/open-pr`, { ...init, method: "POST" }).then(
      j<{ prUrl: string; prNumber: number }>,
    ),
};
