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
  gemini_model: string;
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
  }): Promise<ConfigStatus> => ipcRenderer.invoke("reflex:save-config", patch),

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
