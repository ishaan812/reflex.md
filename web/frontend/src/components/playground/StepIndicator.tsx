import { useEffect, useState } from "react";

/**
 * Sticky left-rail indicator that highlights the stage currently in view.
 * Falls back to a horizontal chip row on mobile.
 *
 * Steps are rendered as real anchor links (<a href="#id">) so in-page jumps
 * work and screen readers can navigate the tour linearly.
 */
export interface StepDescriptor {
  id: string;
  num: string;
  label: string;
}

export function StepIndicator({ steps }: { steps: StepDescriptor[] }) {
  const [activeId, setActiveId] = useState<string>(steps[0]?.id ?? "");

  useEffect(() => {
    if (typeof window === "undefined") return;
    const observer = new IntersectionObserver(
      (entries) => {
        const visible = entries
          .filter((e) => e.isIntersecting)
          .sort((a, b) => b.intersectionRatio - a.intersectionRatio);
        if (visible[0]?.target.id) setActiveId(visible[0].target.id);
      },
      {
        rootMargin: "-25% 0px -55% 0px",
        threshold: [0, 0.25, 0.5, 0.75, 1],
      },
    );
    for (const s of steps) {
      const el = document.getElementById(s.id);
      if (el) observer.observe(el);
    }
    return () => observer.disconnect();
  }, [steps]);

  return (
    <>
      {/* Desktop: sticky vertical rail */}
      <nav
        aria-label="Playground stages"
        className="hidden lg:flex sticky top-[88px] flex-col gap-3 text-sm self-start pr-4"
      >
        {steps.map((s) => {
          const active = s.id === activeId;
          return (
            <a
              key={s.id}
              href={`#${s.id}`}
              aria-current={active ? "step" : undefined}
              className={`group flex items-center gap-3 py-1.5 pl-1 pr-2 transition-colors duration-200 border-l-2 ${
                active
                  ? "border-green text-green"
                  : "border-transparent text-text-dim hover:text-text-secondary"
              }`}
            >
              <span
                className={`font-mono text-[10px] tracking-[2px] uppercase ${
                  active ? "text-green" : "text-text-dim"
                }`}
              >
                {s.num}
              </span>
              <span
                className={`font-mono text-[11px] tracking-[1px] uppercase ${
                  active ? "text-text-primary" : ""
                }`}
              >
                {s.label}
              </span>
            </a>
          );
        })}
      </nav>

      {/* Mobile: horizontal chip row, scrollable */}
      <nav
        aria-label="Playground stages"
        className="lg:hidden flex gap-2 overflow-x-auto pb-2 -mx-5 px-5 [scrollbar-width:none] [&::-webkit-scrollbar]:hidden"
      >
        {steps.map((s) => {
          const active = s.id === activeId;
          return (
            <a
              key={s.id}
              href={`#${s.id}`}
              aria-current={active ? "step" : undefined}
              className={`shrink-0 font-mono text-[10px] tracking-[1.5px] uppercase py-1.5 px-3 border rounded-full transition-colors duration-200 ${
                active
                  ? "border-border-green text-green bg-[rgba(0,255,65,0.08)]"
                  : "border-border-main text-text-dim"
              }`}
            >
              {s.num} · {s.label}
            </a>
          );
        })}
      </nav>
    </>
  );
}
