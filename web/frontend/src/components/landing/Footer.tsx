export function Footer() {
  return (
    <footer className="py-6 px-5 md:px-12 flex flex-col md:flex-row items-center justify-between gap-4 md:gap-0 text-center md:text-left border-t border-border-main text-[11px] text-text-dim">
      <div className="flex flex-col gap-1 items-center md:items-start">
        <span className="font-mono font-bold text-green text-[13px]">
          <span className="opacity-50" aria-hidden="true">&gt;_ </span>
          Reflex.md
        </span>
        <span className="text-text-dim text-[10px]">
          Instructions that learn from your mistakes.
        </span>
      </div>
      <nav className="flex gap-6" aria-label="Footer navigation">
        <a
          href="https://github.com/ishaan812/reflex.md"
          target="_blank"
          rel="noopener noreferrer"
          className="text-text-dim no-underline uppercase tracking-[1px] text-[11px] transition-colors duration-200 hover:text-green"
        >
          GitHub
        </a>
        <a
          href="https://github.com/entire-dev/entire-cli"
          target="_blank"
          rel="noopener noreferrer"
          className="text-text-dim no-underline uppercase tracking-[1px] text-[11px] transition-colors duration-200 hover:text-green"
        >
          entire-cli
        </a>
        <a
          href="/repos"
          className="text-text-dim no-underline uppercase tracking-[1px] text-[11px] transition-colors duration-200 hover:text-green"
        >
          Dashboard
        </a>
      </nav>
    </footer>
  );
}
