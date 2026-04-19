import type { RepoSummary } from "../../../shared/judge";
import { ScoreBadge } from "./ScoreBadge";

interface Props {
  repos: RepoSummary[];
  selectedRepo: string | null;
  onSelect: (repo: string) => void;
}

export function RepoList({ repos, selectedRepo, onSelect }: Props): JSX.Element {
  if (repos.length === 0) {
    return (
      <div className="p-6 text-slate-500">
        No repos yet. Judge a few sessions on the Sessions tab — their inferred
        repo paths will appear here for cross-session analysis.
      </div>
    );
  }

  return (
    <ul className="divide-y divide-slate-800">
      {repos.map((r) => (
        <li key={r.repo}>
          <button
            onClick={() => onSelect(r.repo)}
            className={`flex w-full flex-col gap-0.5 px-3 py-2 text-left transition hover:bg-slate-900 ${
              selectedRepo === r.repo ? "bg-slate-900" : ""
            }`}
          >
            <div className="flex items-center gap-2 text-xs">
              <ScoreBadge score={r.score_avg ?? null} />
              {r.has_insight && (
                <span
                  className="inline-block rounded bg-violet-950 px-1 text-[9px] font-semibold uppercase text-violet-300"
                  title="cross-session insight computed"
                >
                  ai
                </span>
              )}
              <span className="truncate font-medium text-slate-200">
                {basename(r.repo)}
              </span>
              <span className="ml-auto shrink-0 tabular-nums text-slate-500">
                {r.session_count}
              </span>
            </div>
            <div className="flex items-center gap-2 truncate text-[11px] text-slate-500">
              <span className="truncate" title={r.repo}>
                {r.repo}
              </span>
            </div>
          </button>
        </li>
      ))}
    </ul>
  );
}

function basename(p: string): string {
  const parts = p.split("/").filter(Boolean);
  return parts[parts.length - 1] ?? p;
}
