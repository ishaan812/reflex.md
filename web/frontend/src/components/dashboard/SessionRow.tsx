import { Clock, FileText, GitBranch, Sparkles } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { cn } from "@/lib/utils";
import {
  deriveSessionTitle,
  formatRelative,
  type SessionSummary,
} from "@/api";

function frictionBucket(score: number): "green" | "amber" | "red" {
  if (score < 0.3) return "green";
  if (score < 0.8) return "amber";
  return "red";
}

export function SessionRow({
  session,
  selected,
  onClick,
}: {
  session: SessionSummary;
  selected: boolean;
  onClick: () => void;
}) {
  const bucket = frictionBucket(session.frictionScore);
  const agent = session.agent ?? "Unknown Agent";
  const title = deriveSessionTitle(session);
  const relative = formatRelative(session.startedAt);
  const absolute = new Date(session.startedAt).toLocaleString();
  const hasSummary = !!session.summary?.intent || !!session.summary?.outcome;

  return (
    <button
      type="button"
      onClick={onClick}
      title={absolute}
      className={cn(
        "w-full text-left p-4 border border-border-main bg-bg-card transition-all duration-200 rounded-[4px]",
        "hover:border-border-green hover:shadow-[0_0_14px_rgba(0,255,65,0.08)]",
        selected &&
          "border-border-green shadow-[0_0_18px_rgba(0,255,65,0.18)] bg-[rgba(0,255,65,0.03)]",
      )}
    >
      {/* Row 1 — agent badges + FQ */}
      <div className="flex items-center justify-between gap-2 mb-2">
        <div className="flex items-center gap-1.5 min-w-0">
          <Badge variant="default" className="truncate">
            {agent}
          </Badge>
          <Badge variant="muted" className="shrink-0">
            {session.strategy}
          </Badge>
        </div>
        <Badge variant={bucket}>FQ {session.frictionScore.toFixed(2)}</Badge>
      </div>

      {/* Row 2 — derived title (the headline) */}
      <div
        className={cn(
          "font-display text-[14px] leading-[1.35] text-text-primary line-clamp-2 mb-1",
          selected && "text-green",
        )}
      >
        {hasSummary && (
          <Sparkles
            size={11}
            className="inline-block text-green mr-1 -translate-y-[1px]"
            aria-label="auto-summary"
          />
        )}
        {title}
      </div>

      {/* Row 3 — optional outcome subtitle from auto-summarize */}
      {session.summary?.outcome && session.summary.outcome !== title && (
        <div className="font-mono text-[11px] text-text-secondary line-clamp-1 mb-1">
          → {session.summary.outcome}
        </div>
      )}

      {/* Row 4 — metadata strip */}
      <div className="flex items-center gap-3 flex-wrap font-mono text-[11px] text-text-dim mt-1">
        <span className="flex items-center gap-1">
          <Clock size={10} /> {relative}
        </span>
        {session.branch && (
          <span className="flex items-center gap-1 truncate max-w-[160px]">
            <GitBranch size={10} />
            {session.branch}
          </span>
        )}
        {session.filesTouched.length > 0 && (
          <span className="flex items-center gap-1">
            <FileText size={10} />
            {session.filesTouched.length} file
            {session.filesTouched.length === 1 ? "" : "s"}
          </span>
        )}
        <span className="ml-auto opacity-70">
          {session.checkpointId.slice(0, 8)} · #{session.idx}
        </span>
      </div>
    </button>
  );
}
