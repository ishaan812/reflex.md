const STRATEGIES = [
  "CLAUDE-CODE",
  "CURSOR",
  "COPILOT",
  "GEMINI",
  "AIDER",
  "WINDSURF",
  "CODEX",
  "AMP",
];

export function Marquee() {
  const items = [...STRATEGIES, ...STRATEGIES, ...STRATEGIES];
  return (
    <section
      className="py-[60px] overflow-hidden border-y border-border-main"
      aria-label="Compatible agent strategies"
    >
      <div
        className="text-center text-[10px] text-green tracking-[3px] uppercase mb-8"
        aria-hidden="true"
      >
        &lt; Detects friction from any strategy /&gt;
      </div>
      <div
        className="flex w-max animate-marquee hover:[animation-play-state:paused]"
        aria-hidden="true"
      >
        {items.map((s, i) => (
          <span
            className="shrink-0 px-10 text-sm font-medium text-text-dim tracking-[3px] uppercase whitespace-nowrap transition-colors duration-200 hover:text-green"
            key={i}
          >
            {s}
          </span>
        ))}
      </div>
      <div className="sr-only">
        <p>Compatible with: {STRATEGIES.join(", ")}</p>
      </div>
    </section>
  );
}
