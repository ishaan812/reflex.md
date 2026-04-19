import { Github } from "lucide-react";

export function Navbar() {
  return (
    <nav
      className="fixed top-0 inset-x-0 z-[100] flex items-center justify-between px-5 md:px-12 h-14 bg-[rgba(10,10,10,0.85)] backdrop-blur-[12px] border-b border-border-main"
      aria-label="Main navigation"
    >
      <a
        href="/"
        className="font-mono text-base font-bold text-green no-underline flex items-center gap-1 tracking-[-0.5px]"
        aria-label="Reflex.md home"
      >
        <span className="opacity-50" aria-hidden="true">&gt;_</span> Reflex.md
      </a>
      <div className="flex items-center gap-4 md:gap-8">
        <a
          href="#how"
          className="hidden md:inline font-mono text-xs text-text-secondary no-underline tracking-[1px] uppercase transition-colors duration-200 hover:text-green"
        >
          /How it works
        </a>
        <a
          href="#features"
          className="hidden md:inline font-mono text-xs text-text-secondary no-underline tracking-[1px] uppercase transition-colors duration-200 hover:text-green"
        >
          /Features
        </a>
        <a
          href="/playground"
          className="hidden md:inline font-mono text-xs text-text-secondary no-underline tracking-[1px] uppercase transition-colors duration-200 hover:text-green"
        >
          /Playground
        </a>
        <a
          href="/download"
          className="font-mono text-xs text-green no-underline tracking-[1px] uppercase transition-colors duration-200 hover:text-green-dim"
        >
          /Download
        </a>
        <a
          href="https://github.com/ishaan812/reflex.md"
          target="_blank"
          rel="noopener noreferrer"
          className="flex items-center text-text-secondary transition-colors duration-200 hover:text-green"
          aria-label="Reflex.md on GitHub"
        >
          <Github size={18} aria-hidden="true" />
        </a>
      </div>
    </nav>
  );
}
