const FEATURES = [
  {
    num: "01 // Connect",
    title: "GitHub OAuth, Zero Config",
    desc: "One click to authorize. Install the desktop app and point it at your repo. Your source code never leaves your machine.",
  },
  {
    num: "02 // Observe",
    title: "Watch Agents Work",
    desc: "Reflex sits alongside Claude Code, Cursor, Copilot, and friends. It records what your agents do and where you push back — a friction timeline with a per-run Friction Quotient.",
  },
  {
    num: "03 // Detect",
    title: "Find Repeated Mistakes",
    desc: "Clusters the corrections you keep typing, across sessions and agents, and surfaces the patterns your tooling keeps violating.",
  },
  {
    num: "04 // Propose",
    title: "Open an Auditable PR",
    desc: "Writes a minimal edit to AGENTS.md or CLAUDE.md. Every rule cites the exact session it came from. You review. You merge. Done.",
  },
];

export function Features() {
  return (
    <section
      className="py-[100px] px-6 max-w-[1100px] mx-auto"
      id="features"
      aria-labelledby="features-title"
    >
      <header className="mb-16">
        <h2
          id="features-title"
          className="font-display text-[28px] md:text-4xl font-bold leading-[1.2] tracking-[-1px]"
        >
          Stop Paying the
          <br />
          <span className="text-green">Correction Tax</span>
        </h2>
        <p className="mt-3 text-sm text-text-secondary max-w-[560px]">
          You tell the agent "don't use barrel exports" on Monday. It uses them on
          Tuesday. Reflex.md mines the signal that's already in your workflow and
          ships a PR that actually sticks.
        </p>
      </header>
      <div className="grid grid-cols-1 md:grid-cols-2 gap-6" role="list">
        {FEATURES.map((f) => (
          <article
            className="p-8 bg-bg-card border border-border-main rounded-[4px] transition-all duration-300 relative hover:border-border-green hover:shadow-[0_0_30px_rgba(0,255,65,0.15)]"
            key={f.num}
            role="listitem"
          >
            <div
              className="text-[11px] text-text-dim tracking-[2px] uppercase mb-4"
              aria-hidden="true"
            >
              {f.num}
            </div>
            <h3 className="font-display text-xl font-semibold text-text-primary mb-3">
              {f.title}
            </h3>
            <p className="text-[13px] text-text-secondary leading-[1.7]">{f.desc}</p>
          </article>
        ))}
      </div>
    </section>
  );
}
