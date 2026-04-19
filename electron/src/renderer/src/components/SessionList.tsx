import type { SessionSummary } from "../../../shared/types";
import type { SessionRating } from "../../../shared/turn";
import { ScoreBadge } from "./ScoreBadge";

interface Props {
  sessions: SessionSummary[];
  ratings: Map<string, SessionRating>;
  selectedId: string | null;
  onSelect: (id: string) => void;
}

export function SessionList({
  sessions,
  ratings,
  selectedId,
  onSelect,
}: Props): JSX.Element {
  if (sessions.length === 0) {
    return (
      <div className="p-6 text-slate-500">
        No sessions yet. Run any AI CLI (opencode, claude, codex) with Reflex
        running — turns will appear here automatically.
      </div>
    );
  }

  return (
    <ul className="divide-y divide-slate-800">
      {sessions.map((s) => (
        <li key={`${s.source}:${s.session_id}`}>
          <button
            onClick={() => onSelect(s.session_id)}
            className={`flex w-full flex-col gap-0.5 px-3 py-2 text-left transition hover:bg-slate-900 ${
              selectedId === s.session_id ? "bg-slate-900" : ""
            }`}
          >
            <div className="flex items-center gap-2 text-xs">
              <SourceBadge source={s.source} />
              <ScoreBadge score={ratings.get(s.session_id)?.score ?? null} />
              <span className="truncate text-slate-300">
                {s.first_user_text ?? s.session_id.slice(0, 24)}
              </span>
              <span className="ml-auto shrink-0 tabular-nums text-slate-500">
                {s.entry_count}
              </span>
            </div>
            <div className="flex items-center gap-2 truncate text-xs text-slate-500">
              <span>{formatTs(s.last_ts)}</span>
              {s.model && <span>· {s.model}</span>}
              {s.project && (
                <span className="truncate" title={s.project}>
                  · {basename(s.project)}
                </span>
              )}
            </div>
          </button>
        </li>
      ))}
    </ul>
  );
}

function SourceBadge({ source }: { source: string }): JSX.Element {
  const map: Record<string, string> = {
    opencode: "bg-sky-950 text-sky-300",
    "claude-code": "bg-amber-950 text-amber-300",
    codex: "bg-fuchsia-950 text-fuchsia-300",
  };
  const color = map[source] ?? "bg-slate-800 text-slate-300";
  return (
    <span
      className={`inline-block rounded px-1.5 text-[10px] font-medium uppercase tracking-wide ${color}`}
    >
      {source}
    </span>
  );
}

function formatTs(ts: string): string {
  try {
    const d = new Date(ts);
    const now = new Date();
    const sameDay =
      d.getFullYear() === now.getFullYear() &&
      d.getMonth() === now.getMonth() &&
      d.getDate() === now.getDate();
    if (sameDay)
      return d.toLocaleTimeString(undefined, {
        hour: "2-digit",
        minute: "2-digit",
      });
    return d.toLocaleDateString(undefined, {
      month: "short",
      day: "numeric",
    });
  } catch {
    return ts;
  }
}

function basename(p: string): string {
  const parts = p.split("/").filter(Boolean);
  return parts[parts.length - 1] ?? p;
}
