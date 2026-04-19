// Per-session view of the repo's AGENTS.md lifecycle: what the context
// looks like *right now* in the repo, plus the timeline of commits that
// have shaped it. Commits that landed after this session's end are
// highlighted because those are (often) the direct downstream of what
// Reflex learned from this session.

import { useEffect, useMemo, useState } from "react";

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

interface Props {
  /** Local repo path (from judgment.repo); null disables fetching. */
  repo: string | null;
  /** This session's last entry timestamp; used to split timeline into
   *  "before" vs "after this session." */
  sessionLastTs: string;
  hasGithub: boolean;
}

export function ContextTimelinePanel({
  repo,
  sessionLastTs,
  hasGithub,
}: Props): JSX.Element {
  const [context, setContext] = useState<TeamContextFile | null>(null);
  const [history, setHistory] = useState<TeamHistoryEntry[]>([]);
  const [openPrs, setOpenPrs] = useState<TeamOpenPr[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const refresh = async (): Promise<void> => {
    if (!repo || !hasGithub) return;
    setLoading(true);
    setError(null);
    try {
      const [c, h, p] = await Promise.all([
        window.reflex.teamContext(repo),
        window.reflex.teamHistory(repo),
        window.reflex.teamOpenPrs(repo),
      ]);
      setContext(c);
      setHistory(h);
      setOpenPrs(p);
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    void refresh();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [repo, hasGithub]);

  // Split history into "after this session" (most interesting — those are
  // the commits that LANDED as a downstream of this session's learnings)
  // and "before".
  const { after, before } = useMemo(() => {
    const a: TeamHistoryEntry[] = [];
    const b: TeamHistoryEntry[] = [];
    for (const h of history) {
      if (!h.authored_at) {
        b.push(h);
        continue;
      }
      if (h.authored_at > sessionLastTs) a.push(h);
      else b.push(h);
    }
    return { after: a, before: b };
  }, [history, sessionLastTs]);

  if (!hasGithub) {
    return (
      <EmptyState
        title="Connect GitHub to see the timeline"
        body="Open Settings and paste a GitHub token. Reflex will then pull this repo's AGENTS.md history so you can see every time the agent context has changed."
      />
    );
  }

  if (!repo) {
    return (
      <EmptyState
        title="No repo inferred for this session yet"
        body="Run `Judge with Gemini` on the session first — that's how Reflex figures out which repo this session belonged to."
      />
    );
  }

  return (
    <div className="p-4">
      <Header
        repo={repo}
        loading={loading}
        onRefresh={() => void refresh()}
      />

      {error && (
        <div className="mt-3 rounded bg-rose-950/40 px-3 py-2 text-xs text-rose-300">
          {error}
        </div>
      )}

      {/* What's live right now */}
      <Section title="Live agent context in this repo">
        {context ? (
          <div>
            <div className="mb-2 flex flex-wrap items-center gap-2 text-[11px] text-slate-500">
              <span>
                file:{" "}
                <code className="text-slate-300">{context.path}</code>
              </span>
              <span>·</span>
              <span>
                branch:{" "}
                <code className="text-slate-300">{context.default_branch}</code>
              </span>
              <span>·</span>
              <span>
                sha: <code className="text-slate-500">{context.sha.slice(0, 7)}</code>
              </span>
              <span>·</span>
              <span>
                {context.reflex_block
                  ? `Reflex block: ${context.reflex_block.length} chars`
                  : "no Reflex block yet — open a PR to seed it"}
              </span>
            </div>
            {context.reflex_block && (
              <pre className="selectable max-h-[280px] overflow-auto rounded bg-slate-950 p-3 text-[11px] leading-relaxed text-slate-300">
                {context.reflex_block}
              </pre>
            )}
          </div>
        ) : loading ? (
          <Loading>loading live context…</Loading>
        ) : (
          <EmptyInline>
            No AGENTS.md / CLAUDE.md in this repo yet — open a Reflex PR to
            seed one.
          </EmptyInline>
        )}
      </Section>

      {/* Open PRs = mid-flight updates */}
      {openPrs.length > 0 && (
        <Section title={`Open Reflex PRs (${openPrs.length})`}>
          <ul className="space-y-1">
            {openPrs.map((pr) => (
              <li
                key={pr.number}
                className="flex items-center gap-2 rounded border border-slate-800 bg-slate-900/40 px-2 py-1 text-[11px]"
              >
                <Avatar
                  url={pr.author_avatar}
                  fallback={pr.author_login ?? "?"}
                />
                <a
                  href={pr.html_url}
                  onClick={(e) => {
                    e.preventDefault();
                    window.open(pr.html_url, "_blank", "noopener");
                  }}
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
                  {pr.author_login ? `@${pr.author_login}` : ""}
                </span>
              </li>
            ))}
          </ul>
        </Section>
      )}

      {/* Timeline */}
      <Section title={`Context commits (${history.length})`}>
        {history.length === 0 ? (
          <EmptyInline>
            {loading
              ? "loading…"
              : "No commits have touched AGENTS.md yet — once a Reflex PR lands, this timeline fills."}
          </EmptyInline>
        ) : (
          <div>
            {after.length > 0 && (
              <TimelineGroup
                label={`After this session (${after.length})`}
                tone="emerald"
                entries={after}
                hint="These are the commits that landed AFTER this session's last turn — typically the downstream of what this session surfaced."
              />
            )}
            {before.length > 0 && (
              <TimelineGroup
                label={`Before this session (${before.length})`}
                tone="slate"
                entries={before.slice(0, 20)}
                hint="Earlier context updates — what the agent already knew going into this session."
              />
            )}
          </div>
        )}
      </Section>
    </div>
  );
}

// --- subcomponents --------------------------------------------------------

function Header({
  repo,
  loading,
  onRefresh,
}: {
  repo: string;
  loading: boolean;
  onRefresh: () => void;
}): JSX.Element {
  return (
    <div className="flex items-center gap-2">
      <span className="inline-block rounded bg-cyan-950 px-1.5 text-[10px] font-semibold uppercase tracking-wide text-cyan-300">
        Timeline
      </span>
      <span className="truncate text-xs text-slate-400" title={repo}>
        {repo}
      </span>
      <button
        onClick={onRefresh}
        disabled={loading}
        className="ml-auto rounded border border-slate-700 px-2 py-0.5 text-[10px] text-slate-300 hover:bg-slate-800 disabled:opacity-50"
      >
        {loading ? "refreshing…" : "refresh"}
      </button>
    </div>
  );
}

function Section({
  title,
  children,
}: {
  title: string;
  children: React.ReactNode;
}): JSX.Element {
  return (
    <section className="mt-4">
      <h3 className="mb-2 text-[10px] font-semibold uppercase tracking-wide text-slate-500">
        {title}
      </h3>
      {children}
    </section>
  );
}

function TimelineGroup({
  label,
  tone,
  entries,
  hint,
}: {
  label: string;
  tone: "emerald" | "slate";
  entries: TeamHistoryEntry[];
  hint: string;
}): JSX.Element {
  const pillColor =
    tone === "emerald"
      ? "bg-emerald-950 text-emerald-300"
      : "bg-slate-800 text-slate-400";
  const lineColor = tone === "emerald" ? "bg-emerald-900" : "bg-slate-800";
  return (
    <div className="mb-4">
      <div className="mb-1 flex items-center gap-2">
        <span
          className={`inline-block rounded px-1.5 text-[9px] font-semibold uppercase ${pillColor}`}
        >
          {label}
        </span>
        <span className="truncate text-[10px] text-slate-600">{hint}</span>
      </div>
      <ol className="relative ml-3 border-l border-slate-800 pl-4">
        {entries.map((h) => (
          <li key={h.sha} className="relative mb-2 last:mb-0">
            <span
              className={`absolute -left-[22px] top-1 inline-block h-2 w-2 rounded-full ${lineColor}`}
            />
            <div className="flex items-start gap-2 text-[11px]">
              <Avatar
                url={h.author_avatar}
                fallback={h.author_login ?? h.author_name}
              />
              <div className="min-w-0 flex-1">
                <a
                  href={h.html_url}
                  onClick={(e) => {
                    e.preventDefault();
                    window.open(h.html_url, "_blank", "noopener");
                  }}
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
            </div>
          </li>
        ))}
      </ol>
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
        className="mt-0.5 h-5 w-5 shrink-0 rounded-full border border-slate-800"
      />
    );
  }
  const initials = fallback.slice(0, 1).toUpperCase();
  return (
    <div className="mt-0.5 flex h-5 w-5 shrink-0 items-center justify-center rounded-full bg-slate-800 text-[9px] font-semibold text-slate-300">
      {initials}
    </div>
  );
}

function EmptyState({
  title,
  body,
}: {
  title: string;
  body: string;
}): JSX.Element {
  return (
    <div className="flex h-full flex-col items-center justify-center p-6 text-center">
      <div className="text-sm text-slate-300">{title}</div>
      <div className="mt-1 max-w-md text-xs text-slate-500">{body}</div>
    </div>
  );
}

function EmptyInline({ children }: { children: React.ReactNode }): JSX.Element {
  return <div className="text-[11px] text-slate-600">{children}</div>;
}

function Loading({ children }: { children: React.ReactNode }): JSX.Element {
  return <div className="text-[11px] text-slate-500">{children}</div>;
}

function formatTs(ts: string): string {
  if (!ts) return "";
  try {
    const d = new Date(ts);
    const now = Date.now();
    const diffH = (now - d.getTime()) / 3600000;
    if (diffH < 1) return `${Math.round(diffH * 60)}m ago`;
    if (diffH < 24) return `${Math.round(diffH)}h ago`;
    if (diffH < 24 * 7) return `${Math.round(diffH / 24)}d ago`;
    return d.toLocaleDateString(undefined, {
      month: "short",
      day: "numeric",
    });
  } catch {
    return ts;
  }
}
