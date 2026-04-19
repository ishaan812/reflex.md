import { GitPullRequest } from "lucide-react";
import type { AgentsDiff } from "@/data/playground-scenarios";
import { TerminalFrame } from "./TerminalFrame";

/**
 * Renders an AGENTS.md edit as a unified, git-diff-style patch. Kept lines
 * are dimmed; added lines get the familiar "+ " gutter and a green wash.
 *
 * The PR button is intentionally disabled — this is a playground. Visitors
 * install the app to open real PRs.
 */
export function DiffPanel({ diff }: { diff: AgentsDiff }) {
  // Mark which of the `after` lines are new (i.e. not present in `before`).
  const beforeSet = new Set(diff.beforeLines);
  const rows = diff.afterLines.map((line) => ({
    line,
    added: !beforeSet.has(line),
  }));

  const addedCount = rows.filter((r) => r.added).length;

  return (
    <div className="flex flex-col gap-5">
      <div className="flex items-center justify-between flex-wrap gap-3">
        <div className="flex items-center gap-3">
          <span className="font-mono text-[10px] uppercase tracking-[2px] text-text-dim">
            Proposed edit
          </span>
          <span className="font-mono text-sm text-green">{diff.path}</span>
          <span className="font-mono text-[10px] text-text-dim">
            +{addedCount} line{addedCount === 1 ? "" : "s"}
          </span>
        </div>

        <button
          type="button"
          disabled
          aria-disabled="true"
          title="Install Reflex to open real PRs"
          className="btn-clip inline-flex items-center gap-2 py-2 px-4 border border-border-main text-text-dim font-mono text-[11px] tracking-[1.5px] uppercase cursor-not-allowed opacity-80"
        >
          <GitPullRequest size={13} aria-hidden="true" />
          Open PR
          <span className="ml-2 py-0.5 px-2 border border-border-main rounded-full text-[9px] tracking-[1.5px] text-text-dim">
            demo · install to open
          </span>
        </button>
      </div>

      <TerminalFrame
        title={`diff --git a/${diff.path} b/${diff.path}`}
        ariaLabel={`Unified diff for ${diff.path}`}
      >
        <pre className="py-4 px-4 md:px-6 font-mono text-[12.5px] leading-[1.8] overflow-x-auto">
          <div className="text-[#febc2e] mb-1.5">
            --- a/{diff.path}
          </div>
          <div className="text-[#febc2e] mb-3">
            +++ b/{diff.path}
          </div>
          {rows.map((r, i) => (
            <div
              key={i}
              className={`flex gap-3 px-2 -mx-2 ${
                r.added
                  ? "bg-[rgba(0,255,65,0.07)] text-green"
                  : "text-text-secondary"
              }`}
            >
              <span
                aria-hidden="true"
                className={`select-none w-3 shrink-0 ${
                  r.added ? "text-green" : "text-text-dim"
                }`}
              >
                {r.added ? "+" : " "}
              </span>
              <span className="whitespace-pre-wrap">
                {r.line || "\u00A0"}
              </span>
            </div>
          ))}
        </pre>
      </TerminalFrame>

      <div className="border border-border-main bg-bg-card p-5 rounded-[4px]">
        <div className="font-mono text-[10px] uppercase tracking-[2px] text-text-dim mb-3">
          Why this change
        </div>
        <ul className="flex flex-col gap-3">
          {diff.reasoning.map((r, i) => (
            <li key={i} className="flex flex-col gap-1">
              <div className="font-display text-sm font-semibold text-text-primary">
                {r.rule}
              </div>
              <div className="text-[12px] italic text-text-secondary leading-[1.6]">
                "{r.evidence}"
              </div>
              <div className="font-mono text-[10px] text-green tracking-[1px]">
                Evidence · {r.sessionIds.map((s) => s.slice(0, 8)).join(" · ")}
              </div>
            </li>
          ))}
        </ul>
      </div>
    </div>
  );
}
