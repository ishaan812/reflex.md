// Electron main process entry point.

import { app, BrowserWindow, ipcMain, shell } from "electron";
import fs from "node:fs";
import path from "node:path";

import { Sidecar } from "./sidecar";
import {
  appendPlaygroundMessage,
  applyEvent,
  clearPlayground,
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
  listPlaygroundMessages,
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
import { chatInPlayground } from "./playground";
import { analyzeRepo } from "./repo_analyze";
import {
  detectGitHubRemote,
  fetchRepoContext,
  fetchRepoContextHistory,
  fetchTeamJudgments,
  fetchTeamPlaygrounds,
  listOpenReflexPrs,
  openPrForInsight,
  openPrForJudgment,
  pushJudgmentToRepo,
  pushPlaygroundToRepo,
} from "./github";
import { configStatus, loadConfig, saveConfig, setRepoToken } from "./config";
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
  ipcMain.handle(
    "reflex:set-repo-token",
    (_e, ownerRepo: string, token?: string) => {
      setRepoToken(ownerRepo, token);
      return configStatus();
    },
  );

  // Live-validate keys without persisting them. Returns a short status.
  ipcMain.handle(
    "reflex:test-gemini",
    async (
      _e,
      args: { key: string; model?: string },
    ): Promise<{ ok: boolean; detail: string; tokens?: number }> => {
      const key = (args.key ?? "").trim();
      const model = args.model || "gemini-2.5-flash";
      if (!key) return { ok: false, detail: "empty key" };
      try {
        const res = await fetch(
          `https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(model)}:generateContent?key=${encodeURIComponent(key)}`,
          {
            method: "POST",
            headers: { "content-type": "application/json" },
            body: JSON.stringify({
              contents: [{ role: "user", parts: [{ text: "Reply with just PONG." }] }],
              generationConfig: { temperature: 0 },
            }),
          },
        );
        if (!res.ok) {
          const msg = await res.text().catch(() => "");
          return {
            ok: false,
            detail: `${res.status} ${res.statusText} ${msg.slice(0, 200)}`,
          };
        }
        const data = (await res.json()) as {
          candidates?: Array<{
            content?: { parts?: Array<{ text?: string }> };
          }>;
          usageMetadata?: { totalTokenCount?: number };
        };
        const text = data.candidates?.[0]?.content?.parts?.[0]?.text ?? "";
        return {
          ok: /pong/i.test(text),
          detail: text.trim().slice(0, 120) || "(empty response)",
          tokens: data.usageMetadata?.totalTokenCount,
        };
      } catch (e) {
        return { ok: false, detail: (e as Error).message };
      }
    },
  );

  ipcMain.handle(
    "reflex:test-github",
    async (
      _e,
      args: { token: string },
    ): Promise<{
      ok: boolean;
      detail: string;
      login?: string;
      scopes?: string[];
    }> => {
      const tok = (args.token ?? "").trim();
      if (!tok) return { ok: false, detail: "empty token" };
      try {
        const res = await fetch("https://api.github.com/user", {
          headers: {
            accept: "application/vnd.github+json",
            "x-github-api-version": "2022-11-28",
            authorization: `Bearer ${tok}`,
            "user-agent": "reflex-capture/0.1",
          },
        });
        if (!res.ok) {
          const msg = await res.text().catch(() => "");
          return {
            ok: false,
            detail: `${res.status} ${res.statusText} ${msg.slice(0, 200)}`,
          };
        }
        const body = (await res.json()) as { login?: string };
        // `x-oauth-scopes` is present for classic PATs; fine-grained don't expose it.
        const scopes = (res.headers.get("x-oauth-scopes") ?? "")
          .split(",")
          .map((s) => s.trim())
          .filter(Boolean);
        return {
          ok: true,
          detail: body.login ? `authenticated as @${body.login}` : "authenticated",
          login: body.login,
          scopes,
        };
      } catch (e) {
        return { ok: false, detail: (e as Error).message };
      }
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

  // GitHub: detect remote + open PR with the distilled insight.
  ipcMain.handle("reflex:github-detect", (_e, repo: string) => {
    const remote = detectGitHubRemote(repo);
    return remote;
  });
  ipcMain.handle("reflex:github-open-pr", async (_e, repo: string) => {
    const insight = getRepoInsight(repo);
    if (!insight) {
      throw new Error("no insight yet — run Analyze across sessions first");
    }
    return await openPrForInsight({ localRepoPath: repo, insight });
  });
  ipcMain.handle(
    "reflex:github-open-pr-for-session",
    async (_e, sessionId: string, repoOverride?: string) => {
      const j = getJudgment(sessionId);
      if (!j) {
        throw new Error(
          "no judgment for this session — click 'Judge with Gemini' first",
        );
      }
      const repoPath = repoOverride ?? j.repo ?? null;
      if (!repoPath) {
        throw new Error(
          "no local repo path known for this session — pass one explicitly",
        );
      }
      return await openPrForJudgment({ localRepoPath: repoPath, judgment: j });
    },
  );

  // Team sync: read the repo's current state + history + teammates' PRs.
  ipcMain.handle("reflex:team-context", (_e, repo: string) =>
    fetchRepoContext(repo),
  );
  ipcMain.handle("reflex:team-history", (_e, repo: string) =>
    fetchRepoContextHistory(repo),
  );
  ipcMain.handle("reflex:team-open-prs", (_e, repo: string) =>
    listOpenReflexPrs(repo),
  );

  // Team sync: share individual session judgments with the team via
  // .reflex/sessions/*.json in the repo (no PR, direct commit to default).
  ipcMain.handle(
    "reflex:team-share-judgment",
    async (_e, sessionId: string, repoOverride?: string) => {
      const j = getJudgment(sessionId);
      if (!j) throw new Error("judge this session first");
      const repoPath = repoOverride ?? j.repo ?? null;
      if (!repoPath) throw new Error("no repo inferred for this session");
      return await pushJudgmentToRepo({ localRepoPath: repoPath, judgment: j });
    },
  );
  ipcMain.handle("reflex:team-fetch-judgments", (_e, repo: string) =>
    fetchTeamJudgments(repo),
  );

  // --- Playground (per-session chat with Gemini, using the session transcript as context) ---
  ipcMain.handle("reflex:playground-list", (_e, sessionId: string) =>
    listPlaygroundMessages(sessionId),
  );
  ipcMain.handle(
    "reflex:playground-send",
    async (_e, sessionId: string, userMessage: string) => {
      const turns = getTurns(sessionId);
      if (turns.length === 0) throw new Error("no entries for session");
      const history = listPlaygroundMessages(sessionId).map((m) => ({
        role: m.role,
        content: m.content,
      }));
      // Persist the user message first so it's reflected even if the call
      // errors out mid-flight.
      appendPlaygroundMessage({
        session_id: sessionId,
        role: "user",
        content: userMessage,
      });
      const reply = await chatInPlayground({
        turns,
        history,
        userMessage,
      });
      const row = appendPlaygroundMessage({
        session_id: sessionId,
        role: "assistant",
        content: reply.reply,
        tokens_in: reply.tokens_prompt,
        tokens_out: reply.tokens_completion,
        model: reply.model,
      });
      return row;
    },
  );
  ipcMain.handle("reflex:playground-clear", (_e, sessionId: string) =>
    clearPlayground(sessionId),
  );

  // Team: share a playground conversation by committing it to
  // .reflex/playgrounds/<source>-<short>.jsonl in the target repo.
  ipcMain.handle(
    "reflex:team-share-playground",
    async (_e, sessionId: string, repoOverride?: string) => {
      const rows = listPlaygroundMessages(sessionId);
      if (rows.length === 0) {
        throw new Error("no playground messages to share on this session");
      }
      // Derive repo: prefer explicit override, then the session's judgment,
      // then walk the session's turns via the judge-inferring logic.
      const j = getJudgment(sessionId);
      const repoPath = repoOverride ?? j?.repo ?? null;
      if (!repoPath) {
        throw new Error(
          "no repo known for this session — judge the session first so Reflex can infer its repo",
        );
      }
      // Source: the first row's session (every row has the same session_id);
      // pull the source from our sessions table via getSession lookup would
      // be heavier than needed — grab it off the judgment if present.
      const source = j?.source ?? "unknown";
      return await pushPlaygroundToRepo({
        localRepoPath: repoPath,
        sessionId,
        source,
        messages: rows.map((r) => ({
          role: r.role,
          content: r.content,
          ts: r.ts,
          tokens_in: r.tokens_in,
          tokens_out: r.tokens_out,
          model: r.model,
        })),
      });
    },
  );
  ipcMain.handle("reflex:team-fetch-playgrounds", (_e, repo: string) =>
    fetchTeamPlaygrounds(repo),
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
