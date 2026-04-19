import { useEffect, useState } from "react";

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
  user_patterns: string[];
  agent_patterns: string[];
  actionable_advice: string[];
}

interface Props {
  repo: string;
  hasGithub: boolean;
}

export function TeamPanel({ repo, hasGithub }: Props): JSX.Element {
  const [context, setContext] = useState<TeamContextFile | null>(null);
  const [history, setHistory] = useState<TeamHistoryEntry[]>([]);
  const [openPrs, setOpenPrs] = useState<TeamOpenPr[]>([]);
  const [shared, setShared] = useState<TeamSharedJudgment[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const refresh = async (): Promise<void> => {
    setLoading(true);
    setError(null);
    try {
      const [c, h, p, s] = await Promise.all([
        window.reflex.teamContext(repo),
        window.reflex.teamHistory(repo),
        window.reflex.teamOpenPrs(repo),
        window.reflex.teamFetchJudgments(repo),
      ]);
      setContext(c);
      setHistory(h);
      setOpenPrs(p);
      setShared(s);
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    if (hasGithub) void refresh();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [repo, hasGithub]);

  if (!hasGithub) {
    return (
      <section className="border-b border-slate-800 bg-slate-900/40 px-4 py-3 text-xs">
        <div className="flex items-center gap-2">
          <span className="inline-block rounded bg-slate-800 px-1.5 text-[10px] font-medium text-slate-400">
            TEAM
          </span>
          <span className="text-slate-500">
            Set `github_token` in ~/.reflex/config.json to see what your team
            has shipped.
          </span>
        </div>
      </section>
    );
  }

  return (
    <section className="border-b border-slate-800 bg-slate-900/40 px-4 py-3">
      <div className="mb-2 flex items-center gap-2 text-xs">
        <span className="inline-block rounded bg-cyan-950 px-1.5 text-[10px] font-semibold uppercase tracking-wide text-cyan-300">
          TEAM
        </span>
        <span className="text-slate-400">
          What your collaborators have shipped to this repo
        </span>
        <button
          onClick={() => void refresh()}
          disabled={loading}
          className="ml-auto rounded border border-slate-700 px-2 py-0.5 text-[10px] text-slate-300 hover:bg-slate-800 disabled:opacity-50"
        >
          {loading ? "refreshing…" : "refresh"}
        </button>
      </div>

      {error && (
        <div className="mb-2 rounded bg-rose-950/40 px-2 py-1 text-xs text-rose-300">
          {error}
        </div>
      )}

      {/* Current repo state */}
      <div className="grid grid-cols-1 gap-4 md:grid-cols-3">
        <div className="md:col-span-1">
          <SubTitle>Current AGENTS file</SubTitle>
          {context ? (
            <div className="text-[11px] text-slate-400">
              <div>
                <code className="text-slate-200">{context.path}</code> on{" "}
                <code className="text-slate-200">
                  {context.default_branch}
                </code>
              </div>
              <div className="mt-0.5">
                {context.reflex_block
                  ? `Reflex block present (${context.reflex_block.length} chars)`
                  : "No Reflex block yet — open a PR to seed it"}
              </div>
            </div>
          ) : loading ? (
            <div className="text-[11px] text-slate-600">loading…</div>
          ) : (
            <div className="text-[11px] text-slate-600">
              No AGENTS.md / CLAUDE.md in this repo yet.
            </div>
          )}
        </div>

        {/* Open team PRs */}
        <div className="md:col-span-2">
          <SubTitle>Open Reflex PRs (teammates mid-refresh)</SubTitle>
          {openPrs.length === 0 ? (
            <div className="text-[11px] text-slate-600">
              {loading ? "loading…" : "No open Reflex PRs right now."}
            </div>
          ) : (
            <ul className="space-y-1 text-[11px]">
              {openPrs.map((pr) => (
                <li key={pr.number} className="flex items-center gap-2">
                  <Avatar
                    url={pr.author_avatar}
                    fallback={pr.author_login ?? "?"}
                  />
                  <a
                    onClick={(e) => {
                      e.preventDefault();
                      window.open(pr.html_url, "_blank", "noopener");
                    }}
                    href={pr.html_url}
                    className="truncate text-slate-200 hover:text-sky-300"
                    title={pr.title}
                  >
                    #{pr.number} {pr.title}
                  </a>
                  {pr.draft && (
                    <span className="shrink-0 rounded bg-slate-800 px-1 text-[9px] text-slate-400">
                      draft
                    </span>
                  )}
                  <span className="ml-auto shrink-0 text-slate-600">
                    {formatTs(pr.updated_at)} · {pr.author_login ?? "?"}
                  </span>
                </li>
              ))}
            </ul>
          )}
        </div>
      </div>

      {/* Shared session judgments from the team */}
      <div className="mt-3">
        <SubTitle>
          Teammates' recent judged sessions (.reflex/sessions/*.json)
        </SubTitle>
        {shared.length === 0 ? (
          <div className="text-[11px] text-slate-600">
            {loading
              ? "loading…"
              : "No shared judgments yet. Click 'Share to team' on a judged session."}
          </div>
        ) : (
          <ul className="space-y-2">
            {shared.slice(0, 10).map((s) => (
              <li
                key={s.path}
                className="rounded border border-slate-800 bg-slate-900/30 px-2 py-1.5 text-[11px]"
              >
                <div className="flex items-center gap-2">
                  <Avatar
                    url={s.author_avatar}
                    fallback={s.author_login ?? "?"}
                  />
                  <span className="font-medium text-slate-200">
                    @{s.author_login ?? "unknown"}
                  </span>
                  <ScorePill score={s.score} />
                  <span className="truncate text-slate-400" title={s.summary}>
                    {s.summary}
                  </span>
                  <span className="ml-auto shrink-0 text-slate-600">
                    {formatTs(s.judged_at)} · {s.source}
                  </span>
                </div>
                {(s.agent_patterns.length > 0 ||
                  s.user_patterns.length > 0) && (
                  <div className="mt-1 grid grid-cols-1 gap-1 text-[10px] md:grid-cols-2">
                    {s.agent_patterns.length > 0 && (
                      <div>
                        <span className="font-semibold text-fuchsia-300">
                          agent:
                        </span>{" "}
                        <span className="text-slate-400">
                          {s.agent_patterns.slice(0, 2).join(" · ")}
                        </span>
                      </div>
                    )}
                    {s.user_patterns.length > 0 && (
                      <div>
                        <span className="font-semibold text-amber-300">
                          user:
                        </span>{" "}
                        <span className="text-slate-400">
                          {s.user_patterns.slice(0, 2).join(" · ")}
                        </span>
                      </div>
                    )}
                  </div>
                )}
              </li>
            ))}
          </ul>
        )}
      </div>

      {/* History */}
      <div className="mt-3">
        <SubTitle>History of shipped context (most recent first)</SubTitle>
        {history.length === 0 ? (
          <div className="text-[11px] text-slate-600">
            {loading
              ? "loading…"
              : "No merged context updates yet — be the first to open a PR."}
          </div>
        ) : (
          <ol className="space-y-1 text-[11px]">
            {history.slice(0, 15).map((h) => (
              <li key={h.sha} className="flex items-start gap-2">
                <Avatar
                  url={h.author_avatar}
                  fallback={h.author_login ?? h.author_name}
                />
                <div className="min-w-0 flex-1">
                  <a
                    onClick={(e) => {
                      e.preventDefault();
                      window.open(h.html_url, "_blank", "noopener");
                    }}
                    href={h.html_url}
                    className="truncate text-slate-200 hover:text-sky-300"
                    title={h.message}
                  >
                    {h.headline}
                  </a>
                  <div className="text-[10px] text-slate-600">
                    {h.author_login ?? h.author_name} · {formatTs(h.authored_at)} ·{" "}
                    <code className="text-slate-500">{h.short_sha}</code> ·{" "}
                    <code className="text-slate-500">{h.path}</code>
                  </div>
                </div>
              </li>
            ))}
          </ol>
        )}
      </div>
    </section>
  );
}

function SubTitle({ children }: { children: React.ReactNode }): JSX.Element {
  return (
    <div className="mb-1 text-[10px] font-semibold uppercase tracking-wide text-slate-500">
      {children}
    </div>
  );
}

function Avatar({
  url,
  fallback,
}: {
  url: string | null;
  fallback: string;
}): JSX.Element {
  if (url) {
    return (
      <img
        src={url}
        alt={fallback}
        className="h-5 w-5 shrink-0 rounded-full border border-slate-800"
      />
    );
  }
  const initials = fallback.slice(0, 1).toUpperCase();
  return (
    <div className="flex h-5 w-5 shrink-0 items-center justify-center rounded-full bg-slate-800 text-[9px] font-semibold text-slate-300">
      {initials}
    </div>
  );
}

function ScorePill({ score }: { score: number }): JSX.Element {
  const color =
    score >= 85
      ? "bg-emerald-950 text-emerald-300"
      : score >= 70
        ? "bg-sky-950 text-sky-300"
        : score >= 50
          ? "bg-amber-950 text-amber-300"
          : "bg-rose-950 text-rose-300";
  return (
    <span
      className={`inline-block shrink-0 rounded px-1 text-[9px] font-semibold tabular-nums ${color}`}
    >
      {score}
    </span>
  );
}

function formatTs(ts: string): string {
  if (!ts) return "";
  const d = new Date(ts);
  const now = Date.now();
  const diffH = (now - d.getTime()) / 3600000;
  if (diffH < 1) return `${Math.round(diffH * 60)}m ago`;
  if (diffH < 24) return `${Math.round(diffH)}h ago`;
  if (diffH < 24 * 7) return `${Math.round(diffH / 24)}d ago`;
  return d.toLocaleDateString(undefined, { month: "short", day: "numeric" });
}
