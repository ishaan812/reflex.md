/**
 * Static reference table: everything Reflex's detector looks for today, plus
 * one signal stubbed as "coming soon" to signal product direction without
 * over-promising.
 */
const DETECTORS = [
  {
    signal: "Explicit correction",
    lookFor:
      "User text containing no / don't / stop / revert / actually / instead / that's wrong",
    intensity: "×1",
    example: "\"no, don't use barrel exports\"",
    status: "live" as const,
  },
  {
    signal: "Tool retry",
    lookFor:
      "Non-zero exit_code then same tool re-called within 60 seconds (without human input)",
    intensity: "×2",
    example: "pnpm build (exit 2) → pnpm build (exit 2) → pnpm build",
    status: "live" as const,
  },
  {
    signal: "Spec drift",
    lookFor:
      "Agent re-reads the same file more than 3× in one session without editing it",
    intensity: "—",
    example: "(soon — watch for it in the next release)",
    status: "soon" as const,
  },
  {
    signal: "Test-before-build",
    lookFor:
      "Running the test suite before a failing type-check, repeatedly",
    intensity: "—",
    example: "(soon — watch for it in the next release)",
    status: "soon" as const,
  },
];

export function DetectorReference() {
  return (
    <section
      id="stage-6"
      aria-labelledby="detector-ref-title"
      className="flex flex-col gap-6"
    >
      <header>
        <div className="text-[10px] text-text-dim tracking-[2px] uppercase font-mono mb-2">
          06 // Reference
        </div>
        <h2
          id="detector-ref-title"
          className="font-display text-2xl md:text-[28px] font-bold tracking-[-0.5px]"
        >
          What the <span className="text-green">detector</span> looks for
        </h2>
        <p className="text-[13px] text-text-secondary mt-2 max-w-[620px]">
          The surface is small on purpose. Every rule is cheap to reason
          about and cites the exact evidence it came from. No hidden LLM
          judgement calls in the signal layer.
        </p>
      </header>

      <div className="border border-border-main bg-bg-card overflow-hidden rounded-[4px]">
        {/* Header row */}
        <div
          className="hidden md:grid grid-cols-[180px_1fr_70px_1fr] gap-4 py-3 px-5 border-b border-border-main font-mono text-[10px] uppercase tracking-[2px] text-text-dim"
          aria-hidden="true"
        >
          <span>Signal</span>
          <span>What we look for</span>
          <span>Weight</span>
          <span>Example</span>
        </div>

        <ul role="list" className="divide-y divide-border-main">
          {DETECTORS.map((d) => (
            <li
              key={d.signal}
              className={`grid grid-cols-1 md:grid-cols-[180px_1fr_70px_1fr] gap-3 md:gap-4 py-4 px-5 ${
                d.status === "soon" ? "opacity-60" : ""
              }`}
            >
              <div className="flex items-center gap-2">
                <span
                  className={`w-1.5 h-1.5 rounded-full ${
                    d.status === "live"
                      ? "bg-green animate-pulse-dot"
                      : "bg-text-dim"
                  }`}
                  aria-hidden="true"
                />
                <span className="font-display text-sm font-semibold text-text-primary">
                  {d.signal}
                </span>
                {d.status === "soon" && (
                  <span className="font-mono text-[9px] tracking-[1.5px] uppercase text-text-dim border border-border-main rounded-full py-0.5 px-2 ml-1">
                    soon
                  </span>
                )}
              </div>
              <div className="text-[12.5px] text-text-secondary leading-[1.65]">
                {d.lookFor}
              </div>
              <div className="font-mono text-[11px] text-text-dim">
                {d.intensity}
              </div>
              <div className="font-mono text-[11.5px] text-text-secondary italic leading-[1.6]">
                {d.example}
              </div>
            </li>
          ))}
        </ul>
      </div>
    </section>
  );
}
