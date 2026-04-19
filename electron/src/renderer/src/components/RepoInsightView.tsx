import { useState } from "react";

import type { RepoInsight, JudgeIssue } from "../../../shared/judge";
import { ScoreBadge } from "./ScoreBadge";
import { TeamPanel } from "./TeamPanel";

interface Props {
  repo: string | null;
  insight: RepoInsight | null;
  hasGemini: boolean;
  hasGithub: boolean;
  onAnalyzed: (i: RepoInsight) => void;
}

export function RepoInsightView({
  repo,
  insight,
  hasGemini,
  hasGithub,
  onAnalyzed,
}: Props): JSX.Element {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [writeStatus, setWriteStatus] = useState<string | null>(null);
  const [prBusy, setPrBusy] = useState(false);
  const [prStatus, setPrStatus] = useState<string | null>(null);
  const [prUrl, setPrUrl] = useState<string | null>(null);

  if (!repo) {
    return (
      <div className="flex h-full items-center justify-center text-slate-600">
        Select a repo on the left
      </div>
    );
  }

  const analyze = async (): Promise<void> => {
    setBusy(true);
    setError(null);
    try {
      const res = await window.reflex.analyzeRepo(repo);
      onAnalyzed(res);
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  };

  const writeToRepo = async (): Promise<void> => {
    setWriteStatus("writing…");
    try {
      const file = await window.reflex.writeRepoContext(repo);
      setWriteStatus(`wrote ${file}`);
      setTimeout(() => setWriteStatus(null), 5000);
    } catch (e) {
      setWriteStatus(`failed: ${(e as Error).message}`);
    }
  };

  const openPr = async (): Promise<void> => {
    setPrBusy(true);
    setPrStatus(null);
    setPrUrl(null);
    try {
      const res = await window.reflex.githubOpenPr(repo);
      setPrUrl(res.pr_url);
      const verb =
        res.action === "created"
          ? "created"
          : res.action === "replaced-reflex-block"
            ? "refreshed"
            : "updated";
      setPrStatus(
        `PR #${res.pr_number} — ${verb} ${res.target_file} on ${res.branch}`,
      );
    } catch (e) {
      setPrStatus(`failed: ${(e as Error).message}`);
    } finally {
      setPrBusy(false);
    }
  };

  return (
    <div className="flex h-full min-h-0 flex-col">
      <header className="shrink-0 border-b border-slate-800 p-4">
        <div className="flex items-center gap-3">
          <span
            className="inline-block rounded bg-violet-950 px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wide text-violet-300"
          >
            repo
          </span>
          <span className="truncate text-slate-200 selectable">{repo}</span>
          <div className="ml-auto flex items-center gap-2">
            {insight && <ScoreBadge score={insight.score_avg} />}
            <button
              onClick={() => void analyze()}
              disabled={busy || !hasGemini}
              className="rounded border border-violet-700 bg-violet-950/40 px-2 py-0.5 text-xs text-violet-200 hover:bg-violet-900/50 disabled:opacity-50"
              title={
                !hasGemini
                  ? "set gemini_api_key in ~/.reflex/config.json first"
                  : "run cross-session analysis via Gemini"
              }
            >
              {busy
                ? "analyzing…"
                : insight
                  ? "re-analyze"
                  : "Analyze across sessions"}
            </button>
          </div>
        </div>
        {insight && (
          <div className="mt-1 flex items-center gap-3 text-[11px] text-slate-500">
            <span>{insight.session_count} sessions</span>
            <span>· avg {insight.score_avg}/100</span>
            <span>· judge {insight.judge}</span>
            <span>
              · last analyzed{" "}
              {new Date(insight.evaluated_at).toLocaleString(undefined, {
                month: "short",
                day: "numeric",
                hour: "2-digit",
                minute: "2-digit",
              })}
            </span>
          </div>
        )}
        {error && (
          <div className="mt-2 rounded bg-rose-950/40 px-2 py-1 text-xs text-rose-300">
            {error}
          </div>
        )}
      </header>

      {/* Always show team state — even pre-analysis. */}
      <TeamPanel repo={repo} hasGithub={hasGithub} />

      {!insight ? (
        <div className="flex flex-1 items-center justify-center p-6 text-center text-slate-500">
          No cross-session insight yet.
          <br />
          Click <em className="text-slate-300">Analyze across sessions</em> to
          distill recurring patterns from your judged sessions.
        </div>
      ) : (
        <div className="min-h-0 flex-1 overflow-y-auto p-4">
          <Section title="Summary">
            <p className="text-slate-200 selectable">{insight.summary}</p>
          </Section>

          {insight.recurring_issues.length > 0 && (
            <Section title="Recurring issues">
              <ul className="space-y-2">
                {insight.recurring_issues.map((iss, i) => (
                  <li key={i}>
                    <IssueItem issue={iss} />
                  </li>
                ))}
              </ul>
            </Section>
          )}

          <div className="grid grid-cols-2 gap-6">
            {insight.recurring_user_patterns.length > 0 && (
              <Section title="Recurring user patterns" tone="amber">
                <BulletList items={insight.recurring_user_patterns} />
              </Section>
            )}
            {insight.recurring_agent_patterns.length > 0 && (
              <Section title="Recurring agent patterns" tone="fuchsia">
                <BulletList items={insight.recurring_agent_patterns} />
              </Section>
            )}
          </div>

          {insight.actionable_advice.length > 0 && (
            <Section title="Actionable advice" tone="sky">
              <BulletList items={insight.actionable_advice} />
            </Section>
          )}

          <Section title="Ship it">
            <div className="rounded border border-slate-800 bg-slate-900/60 p-3">
              <div className="flex items-center gap-2">
                <button
                  onClick={() => void openPr()}
                  disabled={prBusy}
                  className="rounded bg-violet-700 px-3 py-1 text-xs font-medium text-white hover:bg-violet-600 disabled:opacity-50"
                  title="Opens a PR against your repo's default branch that updates AGENTS.md / CLAUDE.md"
                >
                  {prBusy ? "opening PR…" : "Open PR on GitHub"}
                </button>
                <button
                  onClick={() => void writeToRepo()}
                  className="rounded border border-slate-700 px-2 py-1 text-xs text-slate-200 hover:bg-slate-800"
                  title="Write AGENTS_CONTEXT.md locally (no GitHub)"
                >
                  Write locally
                </button>
                {prUrl && (
                  <a
                    href={prUrl}
                    className="ml-auto text-xs text-emerald-300 hover:underline"
                    onClick={(e) => {
                      e.preventDefault();
                      // Open in system browser via the preload bridge if added; fallback to location
                      window.open(prUrl, "_blank", "noopener");
                    }}
                  >
                    open PR on GitHub ↗
                  </a>
                )}
              </div>
              <div className="mt-2 space-y-0.5 text-[11px]">
                {prStatus && (
                  <div className="text-slate-300">{prStatus}</div>
                )}
                {writeStatus && (
                  <div className="text-slate-400">{writeStatus}</div>
                )}
                <div className="text-slate-500">
                  PR target: first of{" "}
                  <code className="text-slate-300">AGENTS.md</code> /{" "}
                  <code className="text-slate-300">CLAUDE.md</code> /{" "}
                  <code className="text-slate-300">
                    .github/copilot-instructions.md
                  </code>{" "}
                  that exists, else creates{" "}
                  <code className="text-slate-300">AGENTS.md</code>. The Reflex
                  block is delimited by{" "}
                  <code className="text-slate-300">
                    &lt;!-- reflex:context:start --&gt;
                  </code>{" "}
                  so future runs refresh in place.
                </div>
              </div>
            </div>
          </Section>

          <Section title="context_md preview">
            <div className="text-[11px] text-slate-500">
              {insight.context_md.length} chars — this is the body dropped into
              the PR.
            </div>
            <pre className="mt-2 max-h-[50vh] overflow-auto rounded bg-slate-950 p-3 text-xs text-slate-300 selectable">
              {insight.context_md}
            </pre>
          </Section>
        </div>
      )}
    </div>
  );
}

function Section({
  title,
  tone,
  children,
}: {
  title: string;
  tone?: "amber" | "fuchsia" | "sky";
  children: React.ReactNode;
}): JSX.Element {
  const tc =
    tone === "amber"
      ? "text-amber-300"
      : tone === "fuchsia"
        ? "text-fuchsia-300"
        : tone === "sky"
          ? "text-sky-300"
          : "text-slate-400";
  return (
    <section className="mb-5">
      <h3
        className={`mb-2 text-[10px] font-semibold uppercase tracking-wide ${tc}`}
      >
        {title}
      </h3>
      {children}
    </section>
  );
}

function BulletList({ items }: { items: string[] }): JSX.Element {
  return (
    <ul className="space-y-1 text-xs text-slate-300">
      {items.map((s, i) => (
        <li key={i}>
          <span className="text-slate-600">·</span> {s}
        </li>
      ))}
    </ul>
  );
}

function IssueItem({ issue }: { issue: JudgeIssue }): JSX.Element {
  const sev =
    issue.severity === "high"
      ? "bg-rose-950 text-rose-300"
      : issue.severity === "med"
        ? "bg-amber-950 text-amber-300"
        : "bg-slate-800 text-slate-400";
  return (
    <div className="flex items-start gap-2 text-xs">
      <span
        className={`mt-0.5 shrink-0 rounded px-1.5 text-[9px] font-semibold uppercase ${sev}`}
      >
        {issue.severity}
      </span>
      <div className="min-w-0">
        <div className="font-medium text-slate-200">{issue.title}</div>
        <div className="mt-0.5 text-slate-400">{issue.description}</div>
      </div>
    </div>
  );
}
