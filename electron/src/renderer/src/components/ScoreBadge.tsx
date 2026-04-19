interface Props {
  score: number | null | undefined;
  compact?: boolean;
}

/** Small pill used in SessionList; color-coded by score band. */
export function ScoreBadge({ score, compact = false }: Props): JSX.Element {
  if (score === null || score === undefined) {
    return (
      <span
        className={`inline-block rounded px-1.5 text-[10px] font-medium bg-slate-800 text-slate-500 ${compact ? "" : "tabular-nums"}`}
        title="not yet rated"
      >
        –
      </span>
    );
  }
  const color = bandColor(score);
  return (
    <span
      className={`inline-block rounded px-1.5 text-[10px] font-semibold tabular-nums ${color}`}
      title={`quality score ${score}/100`}
    >
      {score}
    </span>
  );
}

function bandColor(score: number): string {
  if (score >= 85) return "bg-emerald-950 text-emerald-300";
  if (score >= 70) return "bg-sky-950 text-sky-300";
  if (score >= 50) return "bg-amber-950 text-amber-300";
  return "bg-rose-950 text-rose-300";
}
