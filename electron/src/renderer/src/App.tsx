import { useCallback, useEffect, useMemo, useState } from "react";

import type {
  CaptureStatus,
  FlowDetail,
  FlowSummary,
  SessionDetail,
  SessionSummary,
} from "../../shared/types";
import type { SessionRating } from "../../shared/turn";
import type {
  RepoInsight,
  RepoSummary,
  SessionJudgment,
} from "../../shared/judge";
import { FlowList } from "./components/FlowList";
import { FlowDetailView } from "./components/FlowDetail";
import { RepoInsightView } from "./components/RepoInsightView";
import { RepoList } from "./components/RepoList";
import { SessionList } from "./components/SessionList";
import { SessionView } from "./components/SessionView";
import { StatusBar } from "./components/StatusBar";

type Tab = "sessions" | "repos" | "flows";

export function App(): JSX.Element {
  const [tab, setTab] = useState<Tab>("sessions");

  // Flows state
  const [flows, setFlows] = useState<FlowSummary[]>([]);
  const [selectedFlowId, setSelectedFlowId] = useState<string | null>(null);
  const [flowDetail, setFlowDetail] = useState<FlowDetail | null>(null);

  // Sessions state
  const [sessions, setSessions] = useState<SessionSummary[]>([]);
  const [selectedSessionId, setSelectedSessionId] = useState<string | null>(null);
  const [sessionDetail, setSessionDetail] = useState<SessionDetail | null>(null);
  const [ratings, setRatings] = useState<Map<string, SessionRating>>(
    () => new Map(),
  );
  const [selectedRating, setSelectedRating] = useState<SessionRating | null>(
    null,
  );
  const [selectedJudgment, setSelectedJudgment] = useState<SessionJudgment | null>(
    null,
  );
  const [judgmentStale, setJudgmentStale] = useState(false);
  const [hasGemini, setHasGemini] = useState(false);

  // Repos state
  const [repos, setRepos] = useState<RepoSummary[]>([]);
  const [selectedRepo, setSelectedRepo] = useState<string | null>(null);
  const [selectedInsight, setSelectedInsight] = useState<RepoInsight | null>(
    null,
  );

  // Global status
  const [status, setStatus] = useState<CaptureStatus | null>(null);

  // Initial data load
  useEffect(() => {
    void window.reflex.listFlows(500).then(setFlows);
    void window.reflex.listSessions(500).then(setSessions);
    void window.reflex.listRatings(1000).then((rs) => {
      const m = new Map<string, SessionRating>();
      for (const r of rs) m.set(r.session_id, r);
      setRatings(m);
    });
    void window.reflex.getStatus().then(setStatus);
    void window.reflex.configStatus().then((c) => setHasGemini(c.has_gemini));
    void window.reflex.listRepos().then(setRepos);
  }, []);

  // Live repo insight updates (triggered after an analyze-repo completes).
  useEffect(() => {
    return window.reflex.onRepoInsight((i) => {
      // Refresh the list so the "ai" badge appears.
      void window.reflex.listRepos().then(setRepos);
      if (selectedRepo === i.repo) setSelectedInsight(i);
    });
  }, [selectedRepo]);

  // Load insight on repo selection
  useEffect(() => {
    if (!selectedRepo) {
      setSelectedInsight(null);
      return;
    }
    void window.reflex
      .getRepoInsight(selectedRepo)
      .then(setSelectedInsight);
  }, [selectedRepo]);

  // When a judgment completes we also want the repos list to refresh
  // (it's possible a new repo just became visible).
  useEffect(() => {
    return window.reflex.onJudgment(() => {
      void window.reflex.listRepos().then(setRepos);
    });
  }, []);

  // Live flow stream
  useEffect(() => {
    return window.reflex.onFlow((flow) => {
      setFlows((prev) => upsert(prev, flow, (f) => f.id));
    });
  }, []);

  // Live session stream
  useEffect(() => {
    return window.reflex.onSession((s) => {
      setSessions((prev) => upsert(prev, s, (x) => x.session_id, (a, b) =>
        new Date(b.last_ts).getTime() - new Date(a.last_ts).getTime(),
      ));
      // If this is the currently selected session, re-fetch details so the
      // detail view gets the newest entries.
      if (selectedSessionId === s.session_id) {
        void window.reflex.getSession(s.session_id).then(setSessionDetail);
      }
    });
  }, [selectedSessionId]);

  // Status updates
  useEffect(() => window.reflex.onStatus(setStatus), []);

  // Live rating stream — update both the list map and, if selected, the detail view.
  useEffect(() => {
    return window.reflex.onRating((r) => {
      setRatings((prev) => {
        const next = new Map(prev);
        next.set(r.session_id, r);
        return next;
      });
      if (selectedSessionId === r.session_id) setSelectedRating(r);
    });
  }, [selectedSessionId]);

  // Load flow detail on selection
  useEffect(() => {
    if (!selectedFlowId) {
      setFlowDetail(null);
      return;
    }
    void window.reflex.getFlow(selectedFlowId).then(setFlowDetail);
  }, [selectedFlowId]);

  // Load session detail + rating + judgment on selection
  useEffect(() => {
    if (!selectedSessionId) {
      setSessionDetail(null);
      setSelectedRating(null);
      setSelectedJudgment(null);
      setJudgmentStale(false);
      return;
    }
    void window.reflex.getSession(selectedSessionId).then(setSessionDetail);
    void window.reflex.getRating(selectedSessionId).then(setSelectedRating);
    void window.reflex.getJudgment(selectedSessionId).then(setSelectedJudgment);
    void window.reflex.judgmentStale(selectedSessionId).then(setJudgmentStale);
  }, [selectedSessionId]);

  // Live judgment stream — cheap because we only emit when a judge call finishes
  useEffect(() => {
    return window.reflex.onJudgment((v) => {
      if (selectedSessionId === v.session_id) {
        setSelectedJudgment(v);
        setJudgmentStale(false);
      }
    });
  }, [selectedSessionId]);

  const handleSelectFlow = useCallback(
    (id: string) => setSelectedFlowId(id),
    [],
  );
  const handleSelectSession = useCallback(
    (id: string) => setSelectedSessionId(id),
    [],
  );

  const [exportStatus, setExportStatus] = useState<string | null>(null);
  const onExport = useCallback(async () => {
    setExportStatus("exporting…");
    try {
      const path = await window.reflex.exportMistakes();
      setExportStatus(`wrote ${path}`);
      setTimeout(() => setExportStatus(null), 4000);
    } catch (e) {
      setExportStatus(`failed: ${(e as Error).message}`);
    }
  }, []);

  const header = useMemo(
    () => (
      <header className="flex h-10 shrink-0 items-center gap-4 border-b border-slate-800 px-4">
        <div className="flex items-center gap-2 text-sm font-medium">
          <span className="inline-block h-2 w-2 rounded-full bg-emerald-500" />
          <span>Reflex</span>
        </div>

        <nav className="flex gap-1 text-xs">
          <TabBtn active={tab === "sessions"} onClick={() => setTab("sessions")}>
            Sessions
            <span className="ml-1.5 text-slate-500">{sessions.length}</span>
          </TabBtn>
          <TabBtn active={tab === "repos"} onClick={() => setTab("repos")}>
            Repos
            <span className="ml-1.5 text-slate-500">{repos.length}</span>
          </TabBtn>
          <TabBtn active={tab === "flows"} onClick={() => setTab("flows")}>
            Flows
            <span className="ml-1.5 text-slate-500">{flows.length}</span>
          </TabBtn>
        </nav>

        <div className="ml-auto flex items-center gap-3 text-xs text-slate-400">
          {exportStatus && <span>{exportStatus}</span>}
          <button
            onClick={onExport}
            className="rounded border border-slate-700 px-2 py-0.5 text-xs hover:bg-slate-800"
            title="Write ~/.reflex/mistakes.md summarising cross-session errors + retries"
          >
            Export mistakes.md
          </button>
        </div>
      </header>
    ),
    [tab, sessions.length, flows.length, exportStatus, onExport],
  );

  return (
    <div className="flex h-full flex-col font-mono text-sm">
      {header}
      <div className="flex min-h-0 flex-1">
        <aside className="w-[420px] shrink-0 overflow-y-auto border-r border-slate-800">
          {tab === "sessions" ? (
            <SessionList
              sessions={sessions}
              ratings={ratings}
              selectedId={selectedSessionId}
              onSelect={handleSelectSession}
            />
          ) : tab === "repos" ? (
            <RepoList
              repos={repos}
              selectedRepo={selectedRepo}
              onSelect={setSelectedRepo}
            />
          ) : (
            <FlowList
              flows={flows}
              selectedId={selectedFlowId}
              onSelect={handleSelectFlow}
            />
          )}
        </aside>
        <main className="min-w-0 flex-1 overflow-y-auto">
          {tab === "sessions" ? (
            <SessionView
              session={sessionDetail}
              rating={selectedRating}
              judgment={selectedJudgment}
              hasGemini={hasGemini}
              judgmentStale={judgmentStale}
              onJudgmentComputed={(v) => {
                setSelectedJudgment(v);
                setJudgmentStale(false);
              }}
            />
          ) : tab === "repos" ? (
            <RepoInsightView
              repo={selectedRepo}
              insight={selectedInsight}
              hasGemini={hasGemini}
              onAnalyzed={(i) => setSelectedInsight(i)}
            />
          ) : (
            <FlowDetailView flow={flowDetail} />
          )}
        </main>
      </div>
      <StatusBar status={status} />
    </div>
  );
}

function TabBtn({
  active,
  onClick,
  children,
}: {
  active: boolean;
  onClick: () => void;
  children: React.ReactNode;
}): JSX.Element {
  return (
    <button
      onClick={onClick}
      className={`px-3 py-1 rounded transition ${
        active
          ? "bg-slate-800 text-slate-100"
          : "text-slate-400 hover:text-slate-200 hover:bg-slate-900"
      }`}
    >
      {children}
    </button>
  );
}

/** Insert-or-update a list item matched by `keyFn`, keeping the list sorted
 *  by `cmp` (defaults to reverse-insertion order, i.e. newest first). */
function upsert<T>(
  prev: T[],
  next: T,
  keyFn: (t: T) => string,
  cmp?: (a: T, b: T) => number,
): T[] {
  const key = keyFn(next);
  const idx = prev.findIndex((t) => keyFn(t) === key);
  const arr = idx >= 0 ? prev.map((t, i) => (i === idx ? next : t)) : [next, ...prev];
  return cmp ? arr.slice().sort(cmp) : arr.slice(0, 1000);
}
