import { Badge } from "@/components/ui/badge";
import { cn } from "@/lib/utils";
import type { SessionSummary } from "@/api";

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
  const started = new Date(session.startedAt);
  const dur =
    session.endedAt != null
      ? Math.round(
          (new Date(session.endedAt).getTime() - started.getTime()) / 60000,
        )
      : null;
  return (
    <button
      type="button"
      onClick={onClick}
      className={cn(
        "w-full text-left p-4 border border-border-main bg-bg-card transition-all duration-200 rounded-[4px]",
        "hover:border-border-green hover:shadow-[0_0_14px_rgba(0,255,65,0.08)]",
        selected && "border-border-green shadow-[0_0_18px_rgba(0,255,65,0.18)] bg-[rgba(0,255,65,0.03)]",
      )}
    >
      <div className="flex items-center justify-between gap-2 mb-2">
        <Badge variant="outline">{session.strategy}</Badge>
        <Badge variant={bucket}>
          FQ {session.frictionScore.toFixed(2)}
        </Badge>
      </div>
      <div className="font-mono text-[11px] text-text-secondary truncate">
        {session.checkpointId.slice(0, 12)} · session #{session.idx}
      </div>
      <div className="font-mono text-[11px] text-text-dim mt-1">
        {started.toLocaleString()}
        {dur != null && ` · ${dur}m`}
      </div>
      {session.branch && (
        <div className="font-mono text-[11px] text-text-dim mt-1 truncate">
          ↳ {session.branch}
        </div>
      )}
      {session.filesTouched.length > 0 && (
        <div className="font-mono text-[10px] text-text-dim mt-1 truncate">
          {session.filesTouched.length} file{session.filesTouched.length === 1 ? "" : "s"} touched
        </div>
      )}
    </button>
  );
}
