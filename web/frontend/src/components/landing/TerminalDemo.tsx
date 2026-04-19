export function TerminalDemo() {
  return (
    <section className="px-6 pb-20 flex justify-center" aria-label="Terminal demo">
      <figure
        className="w-full max-w-[720px] bg-bg-terminal border border-border-main rounded-lg overflow-hidden shadow-[0_20px_60px_rgba(0,0,0,0.5)]"
        role="img"
        aria-label="Demo transcript showing Reflex.md detecting a repeated correction and opening a PR"
      >
        <div
          className="flex items-center gap-2 py-3 px-4 bg-[#161b22] border-b border-border-main"
          aria-hidden="true"
        >
          <span className="w-3 h-3 rounded-full bg-[#ff5f57]" />
          <span className="w-3 h-3 rounded-full bg-[#febc2e]" />
          <span className="w-3 h-3 rounded-full bg-[#28c840]" />
          <span className="flex-1 text-center text-xs text-text-dim">reflex@your-repo:~</span>
        </div>
        <div className="py-5 px-6 text-[13px] leading-[1.7]">
          <span className="block mb-0.5">
            <span className="text-green">$ </span>
            <span className="text-text-primary font-medium">reflex ingest your-repo</span>
          </span>
          <span className="block mb-0.5">
            <span className="text-[#58a6ff]">→</span>
            <span className="text-text-dim"> Cloning entire/checkpoints/v1...</span>
          </span>
          <span className="block mb-0.5">
            <span className="text-green">✓</span>
            <span className="text-text-dim"> Parsed 3 checkpoints (7 sessions)</span>
          </span>

          <div className="h-3" />

          <span className="block mb-0.5">
            <span className="text-[#febc2e] font-semibold">## Session cp_0ff8ca6d — claude-code</span>
          </span>
          <span className="block mb-0.5 pl-3 border-l-2 border-red-correction">
            <span className="text-text-dim">user: </span>
            <span className="text-red-correction">
              no — don't use barrel exports, import directly
            </span>
          </span>

          <div className="h-2" />

          <span className="block mb-0.5">
            <span className="text-[#febc2e] font-semibold">## Session cp_1aaa11bb — claude-code</span>
          </span>
          <span className="block mb-0.5 pl-3 border-l-2 border-red-correction">
            <span className="text-text-dim">user: </span>
            <span className="text-red-correction">
              stop. don't re-export from index.ts
            </span>
          </span>

          <div className="h-3" />

          <span className="block mb-0.5">
            <span className="text-green">$ </span>
            <span className="text-text-primary font-medium">reflex analyze</span>
          </span>
          <span className="block mb-0.5">
            <span className="text-[#58a6ff]">→</span>
            <span className="text-text-dim"> Clustered 4 corrections → </span>
            <span className="text-green">1 pattern</span>
          </span>

          <div className="h-2" />

          <span className="block mb-0.5">
            <span className="text-[#febc2e]">diff --git a/AGENTS.md b/AGENTS.md</span>
          </span>
          <span className="block mb-0.5">
            <span className="text-green">+ </span>
            <span className="text-text-primary">
              Never use barrel exports. Import directly from the source module.
            </span>
          </span>
          <span className="block mb-0.5">
            <span className="text-green">+ </span>
            <span className="text-text-dim">
              Evidence: cp_0ff8ca6d, cp_1aaa11bb (2 sessions, explicit corrections)
            </span>
          </span>

          <div className="h-3" />

          <span className="block mb-0.5">
            <span className="text-green">$ </span>
            <span className="text-text-primary font-medium">reflex open-pr</span>
          </span>
          <span className="block mb-0.5">
            <span className="text-green">✓</span>
            <span className="text-text-dim"> PR #42 opened on </span>
            <span className="text-[#58a6ff]">github.com/you/your-repo </span>
            <span
              className="inline-block w-2 h-4 bg-green animate-blink align-text-bottom"
              aria-hidden="true"
            />
          </span>
        </div>
      </figure>
    </section>
  );
}
