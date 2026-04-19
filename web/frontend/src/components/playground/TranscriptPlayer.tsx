import { useEffect, useRef, useState } from "react";
import type { TranscriptEvent } from "@/data/playground-scenarios";
import { TerminalFrame } from "./TerminalFrame";
import { TranscriptLine } from "./TranscriptLine";
import { usePrefersReducedMotion } from "./usePrefersReducedMotion";

/**
 * Looping auto-animated transcript. Reveals events one by one, holds at the
 * end, then restarts. Pauses on hover and respects reduced-motion.
 *
 * Hovering a signal pill in the sibling DetectionPanel sets `highlightEventId`,
 * which:
 *   1. ensures that line is visible (skip forward if needed),
 *   2. adds the red glow / background treatment to that line.
 */
export function TranscriptPlayer({
  events,
  highlightEventId,
  onLineHover,
  stepDelay = 650,
  restartDelay = 2200,
}: {
  events: TranscriptEvent[];
  highlightEventId?: string | null;
  onLineHover?: (eventId: string | null) => void;
  stepDelay?: number;
  restartDelay?: number;
}) {
  const reduceMotion = usePrefersReducedMotion();
  const [visible, setVisible] = useState(reduceMotion ? events.length : 1);
  const [paused, setPaused] = useState(false);
  const lineRefs = useRef(new Map<string, HTMLSpanElement | null>());

  // Reset + re-initialize counter when the scenario (events) changes.
  useEffect(() => {
    setVisible(reduceMotion ? events.length : 1);
  }, [events, reduceMotion]);

  useEffect(() => {
    if (reduceMotion || paused) return;
    const timer = window.setTimeout(
      () => {
        setVisible((v) => {
          if (v >= events.length) return 1; // loop
          return v + 1;
        });
      },
      visible >= events.length ? restartDelay : stepDelay,
    );
    return () => window.clearTimeout(timer);
  }, [visible, events.length, paused, reduceMotion, stepDelay, restartDelay]);

  // If the user hovers a signal whose event isn't yet revealed, jump forward.
  useEffect(() => {
    if (!highlightEventId) return;
    const idx = events.findIndex((e) => e.id === highlightEventId);
    if (idx >= 0 && idx + 1 > visible) {
      setVisible(idx + 1);
    }
    // Scroll the highlighted line into view within the terminal body.
    const el = lineRefs.current.get(highlightEventId);
    if (el) {
      el.scrollIntoView({ behavior: "smooth", block: "nearest" });
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [highlightEventId]);

  return (
    <TerminalFrame
      title="reflex — session timeline"
      ariaLabel="Recorded agent session transcript"
      onMouseEnter={() => setPaused(true)}
      onMouseLeave={() => setPaused(false)}
    >
      <div
        className="relative py-5 px-5 md:px-6 text-[13px] leading-[1.75] min-h-[360px] max-h-[480px] overflow-y-auto"
        aria-live="off"
      >
        <div className="flex flex-col gap-0.5">
          {events.slice(0, visible).map((e) => (
            <span
              key={e.id}
              ref={(node) => {
                lineRefs.current.set(e.id, node);
              }}
              onMouseEnter={() => onLineHover?.(e.id)}
              onMouseLeave={() => onLineHover?.(null)}
            >
              <TranscriptLine
                event={e}
                highlight={highlightEventId === e.id}
              />
            </span>
          ))}
          {!reduceMotion && visible < events.length && (
            <span
              className="inline-block w-2 h-4 bg-green animate-blink align-text-bottom mt-1"
              aria-hidden="true"
            />
          )}
        </div>

        <div
          className="pointer-events-none absolute top-2 right-3 text-[9px] tracking-[2px] uppercase text-text-dim/70 font-mono"
          aria-hidden="true"
        >
          {reduceMotion
            ? "static"
            : paused
              ? "paused"
              : `rec · ${visible}/${events.length}`}
        </div>
      </div>
    </TerminalFrame>
  );
}
