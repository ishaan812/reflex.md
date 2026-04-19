import { contextBridge, ipcRenderer } from "electron";
import type {
  CaptureStatus,
  FlowDetail,
  FlowSummary,
  SessionDetail,
  SessionSummary,
} from "../shared/types";
import type { SessionRating } from "../shared/turn";
import type {
  RepoInsight,
  RepoSummary,
  SessionJudgment,
} from "../shared/judge";

interface ConfigStatus {
  has_gemini: boolean;
  has_anthropic: boolean;
  has_github: boolean;
  gemini_model: string;
  github_token_overrides: string[];
}

interface GitHubRemote {
  owner: string;
  repo: string;
}

interface OpenPrResult {
  pr_url: string;
  pr_number: number;
  branch: string;
  target_file: string;
  action: "created" | "updated" | "replaced-reflex-block";
}

interface TeamContextFile {
  path: string;
  content: string;
  reflex_block: string | null;
  sha: string;
  default_branch: string;
}

interface TeamHistoryEntry {
  sha: string;
  short_sha: string;
  message: string;
  headline: string;
  author_login: string | null;
  author_name: string;
  author_avatar: string | null;
  authored_at: string;
  html_url: string;
  path: string;
}

interface TeamOpenPr {
  number: number;
  title: string;
  html_url: string;
  author_login: string | null;
  author_avatar: string | null;
  branch: string;
  updated_at: string;
  draft: boolean;
}

interface TeamSharedJudgment {
  path: string;
  session_id: string;
  source: string;
  author_login: string | null;
  author_avatar: string | null;
  judge: string;
  judged_at: string;
  score: number;
  summary: string;
  repo: string | null;
  issues: Array<{
    title: string;
    severity: "low" | "med" | "high";
    description: string;
    recurring: boolean;
  }>;
  user_patterns: string[];
  agent_patterns: string[];
  actionable_advice: string[];
}

interface PushedJudgmentResult {
  committed_path: string;
  sha: string;
  html_url: string;
}

interface PlaygroundRow {
  id: number;
  session_id: string;
  role: "user" | "assistant";
  content: string;
  ts: string;
  tokens_in: number | null;
  tokens_out: number | null;
  model: string | null;
}

interface TeamSharedPlayground {
  path: string;
  session_id: string;
  source: string;
  author_login: string | null;
  author_avatar: string | null;
  updated_at: string;
  messages: Array<{
    role: "user" | "assistant";
    content: string;
    ts: string;
    model: string | null;
    tokens_in: number | null;
    tokens_out: number | null;
  }>;
}

const api = {
  listFlows: (limit?: number): Promise<FlowSummary[]> =>
    ipcRenderer.invoke("reflex:list-flows", limit),

  getFlow: (id: string): Promise<FlowDetail | null> =>
    ipcRenderer.invoke("reflex:get-flow", id),

  listSessions: (limit?: number): Promise<SessionSummary[]> =>
    ipcRenderer.invoke("reflex:list-sessions", limit),

  getSession: (id: string): Promise<SessionDetail | null> =>
    ipcRenderer.invoke("reflex:get-session", id),

  getRating: (id: string): Promise<SessionRating | null> =>
    ipcRenderer.invoke("reflex:get-rating", id),

  listRatings: (limit?: number): Promise<SessionRating[]> =>
    ipcRenderer.invoke("reflex:list-ratings", limit),

  exportMistakes: (): Promise<string> =>
    ipcRenderer.invoke("reflex:export-mistakes"),

  onRating: (cb: (rating: SessionRating) => void): (() => void) => {
    const handler = (
      _e: Electron.IpcRendererEvent,
      r: SessionRating,
    ): void => cb(r);
    ipcRenderer.on("reflex:rating", handler);
    return () => ipcRenderer.off("reflex:rating", handler);
  },

  getStatus: (): Promise<CaptureStatus> => ipcRenderer.invoke("reflex:status"),

  // --- AI Judge (Gemini) ---
  configStatus: (): Promise<ConfigStatus> =>
    ipcRenderer.invoke("reflex:config-status"),

  saveConfig: (patch: {
    gemini_api_key?: string;
    gemini_model?: string;
    anthropic_api_key?: string;
    github_token?: string;
  }): Promise<ConfigStatus> => ipcRenderer.invoke("reflex:save-config", patch),

  setRepoToken: (
    ownerRepo: string,
    token?: string,
  ): Promise<ConfigStatus> =>
    ipcRenderer.invoke("reflex:set-repo-token", ownerRepo, token),

  testGemini: (
    key: string,
    model?: string,
  ): Promise<{ ok: boolean; detail: string; tokens?: number }> =>
    ipcRenderer.invoke("reflex:test-gemini", { key, model }),

  testGitHub: (
    token: string,
  ): Promise<{
    ok: boolean;
    detail: string;
    login?: string;
    scopes?: string[];
  }> => ipcRenderer.invoke("reflex:test-github", { token }),

  getJudgment: (id: string): Promise<SessionJudgment | null> =>
    ipcRenderer.invoke("reflex:get-judgment", id),

  judgeSession: (id: string): Promise<SessionJudgment> =>
    ipcRenderer.invoke("reflex:judge-session", id),

  listJudgments: (limit?: number): Promise<SessionJudgment[]> =>
    ipcRenderer.invoke("reflex:list-judgments", limit),

  judgmentStale: (id: string): Promise<boolean> =>
    ipcRenderer.invoke("reflex:judgment-stale", id),

  onJudgment: (cb: (v: SessionJudgment) => void): (() => void) => {
    const handler = (
      _e: Electron.IpcRendererEvent,
      v: SessionJudgment,
    ): void => cb(v);
    ipcRenderer.on("reflex:judgment", handler);
    return () => ipcRenderer.off("reflex:judgment", handler);
  },

  // --- Repos (cross-session insights) ---
  listRepos: (): Promise<RepoSummary[]> =>
    ipcRenderer.invoke("reflex:list-repos"),

  getRepoInsight: (repo: string): Promise<RepoInsight | null> =>
    ipcRenderer.invoke("reflex:get-repo-insight", repo),

  analyzeRepo: (repo: string): Promise<RepoInsight> =>
    ipcRenderer.invoke("reflex:analyze-repo", repo),

  writeRepoContext: (
    repo: string,
    filename?: string,
  ): Promise<string> =>
    ipcRenderer.invoke("reflex:write-repo-context", repo, filename),

  githubDetect: (repo: string): Promise<GitHubRemote | null> =>
    ipcRenderer.invoke("reflex:github-detect", repo),

  githubOpenPr: (repo: string): Promise<OpenPrResult> =>
    ipcRenderer.invoke("reflex:github-open-pr", repo),

  githubOpenPrForSession: (
    sessionId: string,
    repoOverride?: string,
  ): Promise<OpenPrResult> =>
    ipcRenderer.invoke(
      "reflex:github-open-pr-for-session",
      sessionId,
      repoOverride,
    ),

  teamContext: (repo: string): Promise<TeamContextFile | null> =>
    ipcRenderer.invoke("reflex:team-context", repo),

  teamHistory: (repo: string): Promise<TeamHistoryEntry[]> =>
    ipcRenderer.invoke("reflex:team-history", repo),

  teamOpenPrs: (repo: string): Promise<TeamOpenPr[]> =>
    ipcRenderer.invoke("reflex:team-open-prs", repo),

  teamShareJudgment: (
    sessionId: string,
    repoOverride?: string,
  ): Promise<PushedJudgmentResult> =>
    ipcRenderer.invoke(
      "reflex:team-share-judgment",
      sessionId,
      repoOverride,
    ),

  teamFetchJudgments: (repo: string): Promise<TeamSharedJudgment[]> =>
    ipcRenderer.invoke("reflex:team-fetch-judgments", repo),

  // --- Playground ---
  playgroundList: (sessionId: string): Promise<PlaygroundRow[]> =>
    ipcRenderer.invoke("reflex:playground-list", sessionId),

  playgroundSend: (
    sessionId: string,
    userMessage: string,
  ): Promise<PlaygroundRow> =>
    ipcRenderer.invoke("reflex:playground-send", sessionId, userMessage),

  playgroundClear: (sessionId: string): Promise<number> =>
    ipcRenderer.invoke("reflex:playground-clear", sessionId),

  teamSharePlayground: (
    sessionId: string,
    repoOverride?: string,
  ): Promise<PushedJudgmentResult> =>
    ipcRenderer.invoke(
      "reflex:team-share-playground",
      sessionId,
      repoOverride,
    ),

  teamFetchPlaygrounds: (repo: string): Promise<TeamSharedPlayground[]> =>
    ipcRenderer.invoke("reflex:team-fetch-playgrounds", repo),

  onRepoInsight: (cb: (i: RepoInsight) => void): (() => void) => {
    const handler = (
      _e: Electron.IpcRendererEvent,
      i: RepoInsight,
    ): void => cb(i);
    ipcRenderer.on("reflex:repo-insight", handler);
    return () => ipcRenderer.off("reflex:repo-insight", handler);
  },

  onFlow: (cb: (flow: FlowSummary) => void): (() => void) => {
    const handler = (_e: Electron.IpcRendererEvent, flow: FlowSummary): void =>
      cb(flow);
    ipcRenderer.on("reflex:flow", handler);
    return () => ipcRenderer.off("reflex:flow", handler);
  },

  onSession: (cb: (session: SessionSummary) => void): (() => void) => {
    const handler = (
      _e: Electron.IpcRendererEvent,
      session: SessionSummary,
    ): void => cb(session);
    ipcRenderer.on("reflex:session", handler);
    return () => ipcRenderer.off("reflex:session", handler);
  },

  onStatus: (cb: (status: CaptureStatus) => void): (() => void) => {
    const handler = (
      _e: Electron.IpcRendererEvent,
      status: CaptureStatus,
    ): void => cb(status);
    ipcRenderer.on("reflex:status", handler);
    return () => ipcRenderer.off("reflex:status", handler);
  },
};

contextBridge.exposeInMainWorld("reflex", api);

export type ReflexApi = typeof api;
