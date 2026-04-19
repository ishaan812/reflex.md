import { useState } from "react";

import type { SessionJudgment, JudgeIssue } from "../../../shared/judge";
import { ScoreBadge } from "./ScoreBadge";

interface Props {
  sessionId: string;
  judgment: SessionJudgment | null;
  hasGemini: boolean;
  onRequested: (v: SessionJudgment) => void;
  stale: boolean;
}

export function JudgePanel({
  sessionId,
  judgment,
  hasGemini,
  onRequested,
  stale,
}: Props): JSX.Element {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [prBusy, setPrBusy] = useState(false);
  const [prStatus, setPrStatus] = useState<string | null>(null);
  const [prUrl, setPrUrl] = useState<string | null>(null);
  const [shareBusy, setShareBusy] = useState(false);
  const [shareStatus, setShareStatus] = useState<string | null>(null);
  const [shareUrl, setShareUrl] = useState<string | null>(null);

  const runJudge = async (): Promise<void> => {
    setBusy(true);
    setError(null);
    try {
      const v = await window.reflex.judgeSession(sessionId);
      onRequested(v);
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  };

  const openPr = async (): Promise<void> => {
    setPrBusy(true);
    setPrStatus(null);
    setPrUrl(null);
    try {
      const res = await window.reflex.githubOpenPrForSession(sessionId);
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

  const shareToTeam = async (): Promise<void> => {
    setShareBusy(true);
    setShareStatus(null);
    setShareUrl(null);
    try {
      const res = await window.reflex.teamShareJudgment(sessionId);
      setShareStatus(`committed ${res.committed_path}`);
      setShareUrl(res.html_url);
    } catch (e) {
      setShareStatus(`failed: ${(e as Error).message}`);
    } finally {
      setShareBusy(false);
    }
  };

  if (!hasGemini) {
    return (
      <section className="border-b border-slate-800 bg-slate-900/40 px-4 py-3 text-xs">
        <div className="flex items-center gap-2">
          <span className="inline-block rounded bg-slate-800 px-1.5 text-[10px] font-medium text-slate-400">
            AI JUDGE
          </span>
          <span className="text-slate-500">
            set `gemini_api_key` in ~/.reflex/config.json to enable Gemini
            analysis
          </span>
        </div>
      </section>
    );
  }

  if (!judgment) {
    return (
      <section className="border-b border-slate-800 bg-slate-900/40 px-4 py-3 text-xs">
        <div className="flex items-center gap-3">
          <span className="inline-block rounded bg-violet-950 px-1.5 text-[10px] font-medium text-violet-300">
            AI JUDGE
          </span>
          <span className="text-slate-400">No verdict yet.</span>
          <button
            onClick={() => void runJudge()}
            disabled={busy}
            className="ml-auto rounded border border-violet-700 bg-violet-950/40 px-2 py-0.5 text-xs text-violet-200 hover:bg-violet-900/50 disabled:opacity-50"
          >
            {busy ? "judging…" : "Judge with Gemini"}
          </button>
        </div>
        {error && <div className="mt-1.5 text-rose-400">{error}</div>}
      </section>
    );
  }

  return (
    <section className="border-b border-slate-800 bg-slate-900/40 px-4 py-3 text-xs">
      <div className="flex items-center gap-3">
        <span className="inline-block rounded bg-violet-950 px-1.5 text-[10px] font-medium text-violet-300">
          AI JUDGE
        </span>
        <ScoreBadge score={judgment.score} />
        <span className="truncate text-slate-200">{judgment.summary}</span>
        <span className="ml-auto shrink-0 text-slate-500">
          {judgment.judge}
          {judgment.tokens?.prompt ? (
            <span title="tokens">
              {" "}
              · {(judgment.tokens.prompt ?? 0) +
                (judgment.tokens.completion ?? 0)}{" "}
              tok
            </span>
          ) : null}
        </span>
        <button
          onClick={() => void runJudge()}
          disabled={busy}
          className={`shrink-0 rounded border px-2 py-0.5 text-xs ${
            stale
              ? "border-amber-600 bg-amber-950/40 text-amber-200 hover:bg-amber-900/50"
              : "border-slate-700 text-slate-400 hover:bg-slate-800"
          } disabled:opacity-50`}
          title={stale ? "session has new entries since last judgment" : "re-run"}
        >
          {busy ? "…" : stale ? "refresh" : "re-run"}
        </button>
      </div>

      {error && <div className="mt-1.5 text-rose-400">{error}</div>}

      <div className="mt-2 grid grid-cols-2 gap-x-6 gap-y-2 text-slate-300">
        <Block title="Strengths" items={judgment.strengths} tone="emerald" />
        <Block
          title="Actionable advice"
          items={judgment.actionable_advice}
          tone="sky"
        />
        <Block
          title="User patterns"
          items={judgment.user_patterns}
          tone="amber"
        />
        <Block
          title="Agent patterns"
          items={judgment.agent_patterns}
          tone="fuchsia"
        />
      </div>

      {judgment.issues.length > 0 && (
        <div className="mt-2">
          <div className="text-[10px] font-semibold uppercase tracking-wide text-slate-500">
            Issues
          </div>
          <ul className="mt-1 space-y-1">
            {judgment.issues.slice(0, 8).map((iss, i) => (
              <IssueRow key={i} issue={iss} />
            ))}
          </ul>
        </div>
      )}

      <div className="mt-3 flex flex-wrap items-center gap-2 border-t border-slate-800 pt-2">
        <button
          onClick={() => void openPr()}
          disabled={prBusy || !judgment.repo}
          className="rounded bg-violet-700 px-3 py-1 text-xs font-medium text-white hover:bg-violet-600 disabled:opacity-50"
          title={
            judgment.repo
              ? "Open a PR that adds this session's advice to the repo's AGENTS.md / CLAUDE.md"
              : "No repo inferred for this session — can't open a PR"
          }
        >
          {prBusy ? "opening PR…" : "Open PR for this session"}
        </button>
        <button
          onClick={() => void shareToTeam()}
          disabled={shareBusy || !judgment.repo}
          className="rounded border border-cyan-700 bg-cyan-950/40 px-3 py-1 text-xs text-cyan-200 hover:bg-cyan-900/50 disabled:opacity-50"
          title={
            judgment.repo
              ? "Commit this judgment summary to .reflex/sessions/ in the repo so teammates can see it"
              : "No repo inferred"
          }
        >
          {shareBusy ? "sharing…" : "Share to team"}
        </button>
        {judgment.repo && (
          <span
            className="truncate text-[11px] text-slate-500"
            title={judgment.repo}
          >
            → {basename(judgment.repo)}
          </span>
        )}
        {(prUrl || shareUrl) && (
          <a
            href={prUrl ?? shareUrl ?? "#"}
            onClick={(e) => {
              e.preventDefault();
              window.open(prUrl ?? shareUrl ?? "", "_blank", "noopener");
            }}
            className="ml-auto text-xs text-emerald-300 hover:underline"
          >
            {prUrl ? "open PR on GitHub ↗" : "open commit on GitHub ↗"}
          </a>
        )}
      </div>
      {prStatus && (
        <div className="mt-1 text-[11px] text-slate-400">{prStatus}</div>
      )}
      {shareStatus && (
        <div className="mt-1 text-[11px] text-slate-400">{shareStatus}</div>
      )}
    </section>
  );
}

function basename(p: string): string {
  const parts = p.split("/").filter(Boolean);
  return parts[parts.length - 1] ?? p;
}

function Block({
  title,
  items,
  tone,
}: {
  title: string;
  items: string[];
  tone: "emerald" | "sky" | "amber" | "fuchsia";
}): JSX.Element {
  const tc =
    tone === "emerald"
      ? "text-emerald-300"
      : tone === "sky"
        ? "text-sky-300"
        : tone === "amber"
          ? "text-amber-300"
          : "text-fuchsia-300";
  return (
    <div className="min-w-0">
      <div className={`text-[10px] font-semibold uppercase tracking-wide ${tc}`}>
        {title}
      </div>
      {items.length === 0 ? (
        <div className="text-slate-600 text-[11px]">—</div>
      ) : (
        <ul className="mt-0.5 space-y-0.5 text-[11px]">
          {items.slice(0, 5).map((s, i) => (
            <li key={i} className="text-slate-400">
              <span className="text-slate-600">·</span> {s}
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

function IssueRow({ issue }: { issue: JudgeIssue }): JSX.Element {
  const sevColor =
    issue.severity === "high"
      ? "bg-rose-950 text-rose-300"
      : issue.severity === "med"
        ? "bg-amber-950 text-amber-300"
        : "bg-slate-800 text-slate-400";
  return (
    <li className="flex items-start gap-2 text-[11px]">
      <span
        className={`mt-0.5 inline-block shrink-0 rounded px-1.5 text-[9px] font-semibold uppercase ${sevColor}`}
      >
        {issue.severity}
      </span>
      <div className="min-w-0 flex-1">
        <div className="text-slate-200">
          {issue.title}
          {issue.recurring && (
            <span className="ml-1.5 text-[10px] text-amber-400">(recurring)</span>
          )}
        </div>
        <div className="mt-0.5 text-slate-400">{issue.description}</div>
      </div>
    </li>
  );
}
