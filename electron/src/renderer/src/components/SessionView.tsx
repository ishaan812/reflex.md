import { useMemo, useState } from "react";

import type { SessionDetail, SessionEntry } from "../../../shared/types";
import type { SessionRating } from "../../../shared/turn";
import type { SessionJudgment } from "../../../shared/judge";
import { RatingPanel } from "./RatingPanel";
import { JudgePanel } from "./JudgePanel";
import { PlaygroundPanel } from "./PlaygroundPanel";
import { ContextTimelinePanel } from "./ContextTimelinePanel";

interface Props {
  session: SessionDetail | null;
  rating: SessionRating | null;
  judgment: SessionJudgment | null;
  hasGemini: boolean;
  hasGithub: boolean;
  judgmentStale: boolean;
  onJudgmentComputed: (v: SessionJudgment) => void;
}

const EMPTY: SessionEntry[] = [];

type SessionTab = "transcript" | "playground" | "context";

export function SessionView({
  session,
  rating,
  judgment,
  hasGemini,
  hasGithub,
  judgmentStale,
  onJudgmentComputed,
}: Props): JSX.Element {
  const [hideHousekeeping, setHideHousekeeping] = useState(true);
  const [activeTab, setActiveTab] = useState<SessionTab>("transcript");

  // IMPORTANT: all hooks must run on every render, in the same order.
  // Do NOT early-return before the hooks below; compute against a
  // potentially-empty entries array instead.
  const allEntries = session?.entries ?? EMPTY;
  const entries = useMemo(() => {
    if (!hideHousekeeping) return allEntries;
    return allEntries.filter(
      (e) =>
        e.kind !== "system" &&
        e.kind !== "step-start" &&
        e.kind !== "step-finish" &&
        !e.kind.startsWith("event:") &&
        !(e.kind === "message" && !e.content),
    );
  }, [allEntries, hideHousekeeping]);

  if (!session) {
    return (
      <div className="flex h-full items-center justify-center text-slate-600">
        Select a session on the left
      </div>
    );
  }

  return (
    <div className="flex h-full min-h-0 flex-col">
      <header className="shrink-0 border-b border-slate-800 p-4">
        <div className="flex items-baseline gap-2">
          <SourcePill source={session.source} />
          <span className="truncate text-slate-200 selectable">
            {session.first_user_text ?? session.session_id}
          </span>
        </div>
        <div className="mt-1 flex flex-wrap items-center gap-x-3 gap-y-1 text-xs text-slate-500">
          <span>id {session.session_id.slice(0, 16)}…</span>
          <span>·</span>
          <span>{session.entry_count} entries</span>
          {session.model && (
            <>
              <span>·</span>
              <span>{session.model}</span>
            </>
          )}
          {session.project && (
            <>
              <span>·</span>
              <span className="selectable truncate" title={session.project}>
                {session.project}
              </span>
            </>
          )}
          <span className="ml-auto">
            {formatRange(session.first_ts, session.last_ts)}
          </span>
        </div>
        <div className="mt-2 flex items-center gap-3 text-xs text-slate-400">
          <label className="flex items-center gap-1.5 cursor-pointer">
            <input
              type="checkbox"
              checked={hideHousekeeping}
              onChange={(e) => setHideHousekeeping(e.target.checked)}
              className="accent-sky-500"
            />
            hide housekeeping
          </label>
        </div>
      </header>

      {/* Tabs sit directly under the header so they're always visible,
          regardless of how tall the rating/judge panels get. */}
      <nav
        role="tablist"
        className="relative z-10 flex shrink-0 gap-1 border-b border-slate-800 bg-slate-950 px-4"
      >
        <TabBtn
          active={activeTab === "transcript"}
          onClick={() => setActiveTab("transcript")}
        >
          Transcript
          <span className="ml-1.5 text-slate-600">{entries.length}</span>
        </TabBtn>
        <TabBtn
          active={activeTab === "playground"}
          onClick={() => setActiveTab("playground")}
        >
          Playground
        </TabBtn>
        <TabBtn
          active={activeTab === "context"}
          onClick={() => setActiveTab("context")}
        >
          Context
        </TabBtn>
      </nav>

      {/* Tab content: exactly one panel is visible at a time via `hidden`
          (= display:none), which keeps it out of layout completely.
          The active one is a normal flex child so its width is a clean
          100% of the parent — no absolute-positioning width quirks. */}

      {/* Transcript tab */}
      <div
        role="tabpanel"
        aria-hidden={activeTab !== "transcript"}
        className={`${
          activeTab === "transcript" ? "flex" : "hidden"
        } min-h-0 flex-1 flex-col`}
      >
        <div className="min-h-0 flex-1 overflow-y-auto">
          <RatingPanel rating={rating} />
          <JudgePanel
            sessionId={session.session_id}
            judgment={judgment}
            hasGemini={hasGemini}
            stale={judgmentStale}
            onRequested={onJudgmentComputed}
          />
          <ol className="divide-y divide-slate-900">
            {entries.map((e) => (
              <li key={e.id}>
                <EntryRow entry={e} />
              </li>
            ))}
            {entries.length === 0 && (
              <li className="p-6 text-center text-slate-600">
                (no visible entries — toggle hide housekeeping off to see
                raw events)
              </li>
            )}
          </ol>
        </div>
      </div>

      {/* Playground tab */}
      <div
        role="tabpanel"
        aria-hidden={activeTab !== "playground"}
        className={`${
          activeTab === "playground" ? "flex" : "hidden"
        } min-h-0 flex-1 flex-col`}
      >
        <div className="min-h-0 flex-1 overflow-y-auto">
          <PlaygroundPanel
            sessionId={session.session_id}
            hasGemini={hasGemini}
            repo={judgment?.repo ?? null}
          />
        </div>
      </div>

      {/* Context tab: AGENTS.md timeline */}
      <div
        role="tabpanel"
        aria-hidden={activeTab !== "context"}
        className={`${
          activeTab === "context" ? "flex" : "hidden"
        } min-h-0 flex-1 flex-col`}
      >
        <div className="min-h-0 flex-1 overflow-y-auto">
          <ContextTimelinePanel
            repo={judgment?.repo ?? null}
            sessionLastTs={session.last_ts}
            hasGithub={hasGithub}
          />
        </div>
      </div>
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
      type="button"
      role="tab"
      aria-selected={active}
      onClick={onClick}
      className={`relative cursor-pointer select-none px-4 py-2.5 text-xs font-medium transition ${
        active
          ? "text-slate-100"
          : "text-slate-400 hover:bg-slate-900/60 hover:text-slate-200"
      }`}
    >
      {children}
      {active && (
        <span className="absolute inset-x-0 bottom-0 block h-[2px] bg-indigo-500" />
      )}
    </button>
  );
}

function EntryRow({ entry }: { entry: SessionEntry }): JSX.Element {
  const [expanded, setExpanded] = useState(entry.content.length < 1200);

  const headerColor =
    entry.role === "user"
      ? "text-sky-300"
      : entry.role === "assistant"
        ? "text-emerald-300"
        : entry.role === "tool" || entry.kind === "tool_result"
          ? "text-amber-300"
          : entry.kind === "reasoning"
            ? "text-fuchsia-300"
            : entry.kind.startsWith("tool_call:")
              ? "text-cyan-300"
              : "text-slate-400";

  const label = entry.kind.startsWith("tool_call:")
    ? entry.kind
    : entry.kind === "reasoning"
      ? "reasoning"
      : entry.kind === "tool_result"
        ? "tool_result"
        : entry.role ?? entry.kind;

  const preview = collapseWhitespace(entry.content).slice(0, 160);

  return (
    <div className="px-4 py-2.5">
      <div className="flex items-baseline gap-2 text-xs">
        <span className={`font-semibold uppercase tracking-wide ${headerColor}`}>
          {label}
        </span>
        {entry.model && (
          <span className="text-slate-500">{entry.model}</span>
        )}
        <span className="ml-auto shrink-0 tabular-nums text-slate-600">
          {formatTime(entry.ts)}
        </span>
      </div>
      {entry.content && (
        <div className="mt-1.5">
          {expanded ? (
            <pre className="selectable whitespace-pre-wrap break-words text-xs leading-relaxed text-slate-300">
              {entry.content}
            </pre>
          ) : (
            <button
              onClick={() => setExpanded(true)}
              className="text-xs text-slate-400 hover:text-slate-200"
            >
              {preview}
              {entry.content.length > preview.length && (
                <span className="ml-1 text-sky-400">
                  [+{entry.byte_len - preview.length}B]
                </span>
              )}
            </button>
          )}
          {expanded && entry.content.length > 1200 && (
            <button
              onClick={() => setExpanded(false)}
              className="mt-1 text-[10px] text-slate-500 hover:text-slate-300"
            >
              collapse
            </button>
          )}
        </div>
      )}
    </div>
  );
}

function SourcePill({ source }: { source: string }): JSX.Element {
  const map: Record<string, string> = {
    opencode: "bg-sky-950 text-sky-300",
    "claude-code": "bg-amber-950 text-amber-300",
    codex: "bg-fuchsia-950 text-fuchsia-300",
  };
  const color = map[source] ?? "bg-slate-800 text-slate-300";
  return (
    <span
      className={`inline-block rounded px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wide ${color}`}
    >
      {source}
    </span>
  );
}

function formatTime(ts: string): string {
  try {
    const d = new Date(ts);
    return d.toLocaleTimeString(undefined, {
      hour: "2-digit",
      minute: "2-digit",
      second: "2-digit",
    });
  } catch {
    return ts;
  }
}

function formatRange(first: string, last: string): string {
  try {
    const a = new Date(first);
    const b = new Date(last);
    const sameDay =
      a.getFullYear() === b.getFullYear() &&
      a.getMonth() === b.getMonth() &&
      a.getDate() === b.getDate();
    const datePart = a.toLocaleDateString(undefined, {
      month: "short",
      day: "numeric",
    });
    if (sameDay) {
      return `${datePart} ${a.toLocaleTimeString(undefined, {
        hour: "2-digit",
        minute: "2-digit",
      })} → ${b.toLocaleTimeString(undefined, {
        hour: "2-digit",
        minute: "2-digit",
      })}`;
    }
    return `${datePart} → ${b.toLocaleDateString(undefined, {
      month: "short",
      day: "numeric",
    })}`;
  } catch {
    return `${first} → ${last}`;
  }
}

function collapseWhitespace(s: string): string {
  return s.replace(/\s+/g, " ").trim();
}
