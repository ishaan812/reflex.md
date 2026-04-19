import type { DetectedSignal } from "@/data/playground-scenarios";

/**
 * Two-column list of friction signals that Reflex extracted from the
 * transcript. Hovering a signal cross-links to the source transcript line
 * via `onSignalHover`.
 */
export function DetectionPanel({
  signals,
  onSignalHover,
  hoveredSignalId,
}: {
  signals: DetectedSignal[];
  onSignalHover: (eventId: string | null, signalId: string | null) => void;
  hoveredSignalId?: string | null;
}) {
  const explicit = signals.filter((s) => s.kind === "explicit");
  const retries = signals.filter((s) => s.kind === "tool_retry");

  return (
    <div className="grid grid-cols-1 md:grid-cols-2 gap-5">
      <SignalColumn
        title="Explicit corrections"
        eyebrow="NEGATION_RE match"
        description="User text contained no / don't / stop / revert / actually / instead."
        signals={explicit}
        onSignalHover={onSignalHover}
        hoveredSignalId={hoveredSignalId}
        emptyText="— none in this scenario —"
      />
      <SignalColumn
        title="Tool retries"
        eyebrow="non-zero exit + re-call < 60s"
        description="Same tool re-invoked within 60 seconds of a non-zero exit."
        signals={retries}
        onSignalHover={onSignalHover}
        hoveredSignalId={hoveredSignalId}
        emptyText="— none in this scenario —"
      />
    </div>
  );
}

function SignalColumn({
  title,
  eyebrow,
  description,
  signals,
  onSignalHover,
  hoveredSignalId,
  emptyText,
}: {
  title: string;
  eyebrow: string;
  description: string;
  signals: DetectedSignal[];
  onSignalHover: (eventId: string | null, signalId: string | null) => void;
  hoveredSignalId?: string | null;
  emptyText: string;
}) {
  return (
    <div className="flex flex-col gap-3">
      <div>
        <div className="text-[10px] uppercase tracking-[2px] text-text-dim font-mono mb-1">
          {eyebrow}
        </div>
        <h3 className="font-display text-base font-semibold text-text-primary mb-1">
          {title}
        </h3>
        <p className="text-[12px] text-text-secondary leading-[1.6]">
          {description}
        </p>
      </div>

      <ul className="flex flex-col gap-2" role="list">
        {signals.length === 0 && (
          <li className="text-[12px] text-text-dim italic font-mono">
            {emptyText}
          </li>
        )}
        {signals.map((s) => {
          const hovered = s.id === hoveredSignalId;
          return (
            <li key={s.id}>
              <button
                type="button"
                onMouseEnter={() => onSignalHover(s.eventId, s.id)}
                onMouseLeave={() => onSignalHover(null, null)}
                onFocus={() => onSignalHover(s.eventId, s.id)}
                onBlur={() => onSignalHover(null, null)}
                className={`w-full text-left p-3 border transition-all duration-200 ${
                  hovered
                    ? "border-red-correction/60 bg-[rgba(185,28,28,0.08)]"
                    : "border-border-main bg-bg-card hover:border-text-dim"
                }`}
              >
                <div className="flex items-center justify-between gap-3 mb-1.5">
                  <span className="font-mono text-[11px] text-red-correction tracking-[0.5px]">
                    {s.label}
                  </span>
                  <span
                    className={`font-mono text-[10px] px-2 py-0.5 rounded-full border ${
                      s.intensity === 2
                        ? "border-red-correction/50 text-red-correction"
                        : "border-amber-warn/40 text-amber-warn"
                    }`}
                  >
                    ×{s.intensity}
                  </span>
                </div>
                <div className="pl-2 border-l-2 border-red-correction/50 text-[12px] text-text-secondary italic font-mono leading-[1.6]">
                  {s.evidence}
                </div>
                <div className="mt-1.5 text-[10px] text-text-dim font-mono">
                  {s.rule}
                </div>
              </button>
            </li>
          );
        })}
      </ul>
    </div>
  );
}
