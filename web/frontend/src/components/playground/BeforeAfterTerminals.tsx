import { useEffect, useRef, useState } from "react";
import type { BehaviorTerminal } from "@/data/playground-scenarios";
import { TerminalFrame } from "./TerminalFrame";
import { TranscriptLine } from "./TranscriptLine";
import { usePrefersReducedMotion } from "./usePrefersReducedMotion";

/**
 * Mini looping transcript used in the Before/After stage. Intentionally
 * smaller + noisier footprint than TranscriptPlayer so the two read as
 * paired "example runs" rather than a single canonical capture.
 */
function MiniTerminal({ data }: { data: BehaviorTerminal }) {
  const reduceMotion = usePrefersReducedMotion();
  const [visible, setVisible] = useState(reduceMotion ? data.events.length : 1);
  const [paused, setPaused] = useState(false);
  const bodyRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    setVisible(reduceMotion ? data.events.length : 1);
  }, [data, reduceMotion]);

  useEffect(() => {
    if (reduceMotion || paused) return;
    const timer = window.setTimeout(
      () => {
        setVisible((v) => (v >= data.events.length ? 1 : v + 1));
      },
      visible >= data.events.length ? 2200 : 700,
    );
    return () => window.clearTimeout(timer);
  }, [visible, paused, reduceMotion, data.events.length]);

  const tone = data.verdictTone;
  const toneClasses =
    tone === "green"
      ? "border-border-green text-green bg-[rgba(0,255,65,0.06)]"
      : "border-red-correction/50 text-red-correction bg-[rgba(185,28,28,0.06)]";

  return (
    <TerminalFrame
      title={data.label}
      ariaLabel={`${data.label} — ${data.verdict}`}
      onMouseEnter={() => setPaused(true)}
      onMouseLeave={() => setPaused(false)}
      className="h-full"
    >
      <div
        ref={bodyRef}
        className="py-4 px-4 md:px-5 min-h-[260px] max-h-[340px] overflow-y-auto flex flex-col"
      >
        <div className="flex flex-col gap-0.5 flex-1">
          {data.events.slice(0, visible).map((e) => (
            <TranscriptLine key={e.id} event={e} />
          ))}
        </div>

        <div
          className={`mt-4 self-start font-mono text-[10px] tracking-[2px] uppercase py-1 px-3 border rounded-full ${toneClasses}`}
        >
          {data.verdict}
        </div>
      </div>
    </TerminalFrame>
  );
}

export function BeforeAfterTerminals({
  before,
  after,
}: {
  before: BehaviorTerminal;
  after: BehaviorTerminal;
}) {
  return (
    <div className="grid grid-cols-1 md:grid-cols-2 gap-5 items-stretch">
      <div className="flex flex-col gap-2">
        <div className="font-mono text-[10px] uppercase tracking-[2px] text-red-correction">
          Before merge
        </div>
        <MiniTerminal data={before} />
      </div>
      <div className="flex flex-col gap-2">
        <div className="font-mono text-[10px] uppercase tracking-[2px] text-green">
          After merge
        </div>
        <MiniTerminal data={after} />
      </div>
    </div>
  );
}
