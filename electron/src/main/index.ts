// Electron main process entry point.

import { app, BrowserWindow, ipcMain, shell } from "electron";
import fs from "node:fs";
import path from "node:path";

import { Sidecar } from "./sidecar";
import {
  applyEvent,
  computeRating,
  computeRatingsForAllSessions,
  countEntries,
  getFlow,
  getJudgment,
  getRating,
  getRepoInsight,
  getSession,
  getTurns,
  judgmentNeedsRefresh,
  listFlows,
  listJudgments,
  listJudgmentsForRepo,
  listRatings,
  listRepos,
  listSessions,
  saveJudgment,
  saveRepoInsight,
  summarize,
  summarizeSession,
} from "./db";
import { exportMistakesMd } from "./export";
import { judgeSessionWithGemini } from "./judge";
import { analyzeRepo } from "./repo_analyze";
import { configStatus, loadConfig, saveConfig } from "./config";
import type {
  CaptureEvent,
  FlowSummary,
  SessionSummary,
} from "@shared/types";
import type { SessionRating } from "@shared/turn";

let mainWindow: BrowserWindow | null = null;
const sidecar = new Sidecar();

function createWindow(): void {
  mainWindow = new BrowserWindow({
    width: 1200,
    height: 800,
    minWidth: 800,
    minHeight: 500,
    titleBarStyle: "hiddenInset",
    backgroundColor: "#0b0f14",
    webPreferences: {
      preload: path.join(__dirname, "../preload/index.js"),
      sandbox: false,
      contextIsolation: true,
    },
  });

  // Open external links in the system browser.
  mainWindow.webContents.setWindowOpenHandler(({ url }) => {
    shell.openExternal(url);
    return { action: "deny" };
  });

  const devUrl = process.env["ELECTRON_RENDERER_URL"];
  if (!app.isPackaged && devUrl) {
    void mainWindow.loadURL(devUrl);
    mainWindow.webContents.openDevTools({ mode: "detach" });
  } else {
    void mainWindow.loadFile(path.join(__dirname, "../renderer/index.html"));
  }

  mainWindow.on("closed", () => {
    mainWindow = null;
  });
}

function registerIpc(): void {
  ipcMain.handle("reflex:list-flows", (_e, limit?: number) =>
    listFlows(limit ?? 200),
  );
  ipcMain.handle("reflex:get-flow", (_e, id: string) => getFlow(id));
  ipcMain.handle("reflex:list-sessions", (_e, limit?: number) =>
    listSessions(limit ?? 200),
  );
  ipcMain.handle("reflex:get-session", (_e, id: string) => getSession(id));
  ipcMain.handle("reflex:get-rating", (_e, id: string) => getRating(id));
  ipcMain.handle("reflex:list-ratings", (_e, limit?: number) =>
    listRatings(limit ?? 500),
  );
  ipcMain.handle("reflex:export-mistakes", async () => {
    const ratings = listRatings(1000);
    const outDir = path.join(app.getPath("home"), ".reflex");
    fs.mkdirSync(outDir, { recursive: true });
    const outFile = path.join(outDir, "mistakes.md");
    const body = exportMistakesMd(ratings);
    fs.writeFileSync(outFile, body, "utf8");
    return outFile;
  });
  ipcMain.handle("reflex:status", () => sidecar.getStatus());

  // Config: the renderer never sees the actual key, only whether one is set.
  ipcMain.handle("reflex:config-status", () => configStatus());
  ipcMain.handle(
    "reflex:save-config",
    (_e, patch: Record<string, string | undefined>) => {
      saveConfig(patch);
      return configStatus();
    },
  );

  // Judge
  ipcMain.handle("reflex:get-judgment", (_e, id: string) => getJudgment(id));
  ipcMain.handle("reflex:judge-session", async (_e, id: string) => {
    const turns = getTurns(id);
    if (turns.length === 0) throw new Error("no entries for session");
    const source = turns[0].source;
    const verdict = await judgeSessionWithGemini(id, source, turns);
    saveJudgment(verdict, countEntries(id));
    if (mainWindow && !mainWindow.isDestroyed()) {
      mainWindow.webContents.send("reflex:judgment", verdict);
    }
    return verdict;
  });
  ipcMain.handle("reflex:list-judgments", (_e, limit?: number) =>
    listJudgments(limit ?? 500),
  );
  ipcMain.handle("reflex:judgment-stale", (_e, id: string) =>
    judgmentNeedsRefresh(id),
  );

  // Repos — cross-session insight.
  ipcMain.handle("reflex:list-repos", () => listRepos());
  ipcMain.handle("reflex:get-repo-insight", (_e, repo: string) =>
    getRepoInsight(repo),
  );
  ipcMain.handle("reflex:analyze-repo", async (_e, repo: string) => {
    const judgments = listJudgmentsForRepo(repo);
    if (judgments.length === 0) {
      throw new Error(
        `no session judgments for repo ${repo} — judge some sessions first`,
      );
    }
    const insight = await analyzeRepo(repo, judgments);
    saveRepoInsight(insight);
    if (mainWindow && !mainWindow.isDestroyed()) {
      mainWindow.webContents.send("reflex:repo-insight", insight);
    }
    return insight;
  });
  ipcMain.handle(
    "reflex:write-repo-context",
    async (_e, repo: string, filename?: string) => {
      const insight = getRepoInsight(repo);
      if (!insight) throw new Error("no insight yet — run analyze-repo first");
      const name = filename ?? "AGENTS_CONTEXT.md";
      const full = path.join(repo, name);
      fs.writeFileSync(full, insight.context_md, "utf8");
      return full;
    },
  );
}

// Coalesce rapid-fire session updates into one notification per tick per
// session. SessionEntry events arrive in bursts (hundreds per poll for
// backfilled history) and we don't want to flood the renderer with
// per-event IPC pushes.
const pendingSessionPushes = new Set<string>();
let sessionPushTimer: NodeJS.Timeout | null = null;

function schedulePushSession(sessionId: string): void {
  pendingSessionPushes.add(sessionId);
  if (sessionPushTimer) return;
  sessionPushTimer = setTimeout(() => {
    sessionPushTimer = null;
    const ids = [...pendingSessionPushes];
    pendingSessionPushes.clear();
    if (!mainWindow || mainWindow.isDestroyed()) return;
    for (const id of ids) {
      const summary: SessionSummary | null = summarizeSession(id);
      if (summary) mainWindow.webContents.send("reflex:session", summary);
      // Rate in the background — SQLite writes are fast but we don't want
      // to block the event loop on large sessions.
      queueMicrotask(() => {
        const r: SessionRating | null = computeRating(id);
        if (r && mainWindow && !mainWindow.isDestroyed()) {
          mainWindow.webContents.send("reflex:rating", r);
        }
      });
    }
  }, 250);
}

function wireSidecar(): void {
  sidecar.on("event", (ev: CaptureEvent) => {
    const res = applyEvent(ev);
    if (res.flowId) {
      const summary: FlowSummary | null = summarize(res.flowId);
      if (summary && mainWindow && !mainWindow.isDestroyed()) {
        mainWindow.webContents.send("reflex:flow", summary);
      }
    }
    if (res.sessionId) {
      schedulePushSession(res.sessionId);
    }
  });

  sidecar.on("status", (status) => {
    if (mainWindow && !mainWindow.isDestroyed()) {
      mainWindow.webContents.send("reflex:status", status);
    }
  });
}

app.whenReady().then(() => {
  // One-time migration: if we have a first-run-provided Gemini key in env,
  // stash it into ~/.reflex/config.json so the user doesn't have to set it
  // manually. `saveConfig` only overwrites keys explicitly passed.
  const envKey = process.env.REFLEX_GEMINI_API_KEY;
  if (envKey && !loadConfig().gemini_api_key) {
    saveConfig({ gemini_api_key: envKey });
    console.log("[reflex] Gemini key imported from REFLEX_GEMINI_API_KEY env");
  }

  registerIpc();
  wireSidecar();
  sidecar.start();
  createWindow();

  // Warm up ratings for existing sessions on first launch (cheap; runs
  // off the event loop).
  queueMicrotask(() => {
    try {
      const n = computeRatingsForAllSessions();
      if (n > 0) console.log(`[reflex] warmed ratings for ${n} sessions`);
    } catch (e) {
      console.warn("[reflex] rating warmup failed:", e);
    }
  });

  app.on("activate", () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow();
  });
});

app.on("window-all-closed", () => {
  if (process.platform !== "darwin") app.quit();
});

app.on("before-quit", () => {
  sidecar.stop();
});
