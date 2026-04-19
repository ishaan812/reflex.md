import type { PlaygroundScenario } from "@/data/playground-scenarios";

export function ScenarioTabs({
  scenarios,
  activeId,
  onSelect,
}: {
  scenarios: PlaygroundScenario[];
  activeId: string;
  onSelect: (id: string) => void;
}) {
  return (
    <div
      role="tablist"
      aria-label="Playground scenarios"
      className="grid grid-cols-1 md:grid-cols-3 gap-3 w-full"
    >
      {scenarios.map((s, i) => {
        const active = s.id === activeId;
        return (
          <button
            key={s.id}
            role="tab"
            aria-selected={active}
            aria-controls={`scenario-${s.id}`}
            type="button"
            onClick={() => onSelect(s.id)}
            className={`btn-clip text-left p-5 border transition-all duration-200 ${
              active
                ? "border-border-green bg-[rgba(0,255,65,0.06)] shadow-[0_0_30px_rgba(0,255,65,0.15)]"
                : "border-border-main bg-bg-card hover:border-text-dim hover:bg-white/[0.02]"
            }`}
          >
            <div
              className={`font-mono text-[10px] tracking-[2px] uppercase mb-2 ${
                active ? "text-green" : "text-text-dim"
              }`}
            >
              {String(i + 1).padStart(2, "0")} // Scenario
            </div>
            <div
              className={`font-display text-base font-semibold mb-1 ${
                active ? "text-green" : "text-text-primary"
              }`}
            >
              {s.title}
            </div>
            <div className="text-[12px] text-text-secondary leading-[1.6]">
              {s.subtitle}
            </div>
          </button>
        );
      })}
    </div>
  );
}
