import type { SessionRating } from "../../../shared/turn";
import { ScoreBadge } from "./ScoreBadge";

interface Props {
  rating: SessionRating | null;
}

export function RatingPanel({ rating }: Props): JSX.Element | null {
  if (!rating) return null;

  return (
    <section className="border-b border-slate-800 bg-slate-900/40 px-4 py-3 text-xs">
      <div className="flex items-center gap-3">
        <ScoreBadge score={rating.score} />
        <span className="text-slate-300">
          {describeScore(rating.score)} — {rating.turn_count} turns
        </span>
        <span className="ml-auto text-slate-500">
          {rating.tool_call_count} tool calls ·{" "}
          <span className={rating.tool_error_count > 0 ? "text-rose-400" : ""}>
            {rating.tool_error_count} errored
          </span>
        </span>
      </div>
      {(rating.mistakes.length ||
        rating.retries.length ||
        rating.corrections.length ||
        rating.reversals.length) > 0 ? (
        <div className="mt-2 grid grid-cols-2 gap-x-6 gap-y-1 text-slate-400">
          {rating.mistakes.length > 0 && (
            <Row
              label="Mistakes"
              count={rating.mistakes.length}
              detail={rating.mistakes
                .slice(0, 3)
                .map((m) => `${m.tool_name}: ${shorten(m.error, 60)}`)
                .join(" · ")}
              tone="rose"
            />
          )}
          {rating.retries.length > 0 && (
            <Row
              label="Retries"
              count={rating.retries.length}
              detail={rating.retries
                .slice(0, 3)
                .map(
                  (r) =>
                    `${r.tool_name}×${r.indices.length}${r.resolved ? "" : " unresolved"}`,
                )
                .join(" · ")}
              tone="amber"
            />
          )}
          {rating.corrections.length > 0 && (
            <Row
              label="Corrections"
              count={rating.corrections.length}
              detail={shorten(
                rating.corrections.map((c) => c.phrase).join(" · "),
                140,
              )}
              tone="fuchsia"
            />
          )}
          {rating.reversals.length > 0 && (
            <Row
              label="Reversals"
              count={rating.reversals.length}
              detail={rating.reversals
                .slice(0, 3)
                .map((r) => r.file_path)
                .join(" · ")}
              tone="sky"
            />
          )}
        </div>
      ) : (
        <div className="mt-2 text-slate-500">
          no mistakes, retries, or corrections detected in this session
        </div>
      )}
    </section>
  );
}

function Row({
  label,
  count,
  detail,
  tone,
}: {
  label: string;
  count: number;
  detail: string;
  tone: "rose" | "amber" | "fuchsia" | "sky";
}): JSX.Element {
  const toneClass =
    tone === "rose"
      ? "text-rose-300"
      : tone === "amber"
        ? "text-amber-300"
        : tone === "fuchsia"
          ? "text-fuchsia-300"
          : "text-sky-300";
  return (
    <div className="min-w-0">
      <div className={`font-semibold ${toneClass}`}>
        {label} <span className="font-normal tabular-nums">({count})</span>
      </div>
      <div className="truncate text-[11px] text-slate-500" title={detail}>
        {detail}
      </div>
    </div>
  );
}

function describeScore(score: number): string {
  if (score >= 85) return "clean run";
  if (score >= 70) return "minor issues";
  if (score >= 50) return "bumpy";
  return "noisy";
}

function shorten(s: string, n: number): string {
  return s.length > n ? s.slice(0, n) + "…" : s;
}
