import { Github, ArrowRight, Apple } from "lucide-react";

export function Hero() {
  return (
    <section
      className="hero-glow pt-[120px] md:pt-[140px] px-5 md:px-6 pb-[60px] md:pb-20 text-center relative overflow-hidden"
      aria-labelledby="hero-title"
    >
      <div
        className="font-display text-5xl md:text-[72px] font-bold text-green tracking-[-2px] mb-4 relative italic [text-shadow:0_0_40px_rgba(0,255,65,0.3)]"
        aria-hidden="true"
      >
        Reflex.md
      </div>

      <div className="inline-flex items-center gap-2 py-1.5 px-4 bg-[rgba(0,255,65,0.08)] border border-border-green rounded-[20px] text-[10px] tracking-[2px] uppercase text-green mb-10">
        <span className="w-1.5 h-1.5 rounded-full bg-green animate-pulse-dot" aria-hidden="true" />
        <span>Agent Workflow Optimizer // v0.1.0</span>
      </div>

      <h1
        id="hero-title"
        className="font-display text-[32px] md:text-[52px] font-bold leading-[1.1] tracking-[-1.5px] mb-6"
      >
        <span className="text-text-primary">Instructions That</span>
        <br />
        <span className="text-green [text-shadow:0_0_30px_rgba(0,255,65,0.3)]">
          Learn From Your Mistakes
        </span>
      </h1>

      <p className="font-mono text-[13px] md:text-sm text-text-secondary leading-[1.8] max-w-[560px] mx-auto mb-10">
        <span className="text-green mr-1" aria-hidden="true">&gt;</span> Watches how your coding agents actually work.
        <br />
        <span className="text-green mr-1" aria-hidden="true">&gt;</span> Finds the mistakes they keep repeating.
        <br />
        <span className="text-green mr-1" aria-hidden="true">&gt;</span> Opens a PR on <span className="text-green">AGENTS.md</span> that teaches them not to.
        <br />
        <span className="text-green mr-1" aria-hidden="true">&gt;</span> You click merge.
      </p>

      <div className="flex gap-4 flex-wrap justify-center">
        <a
          href="/auth/github"
          className="btn-clip inline-flex items-center gap-2 py-3.5 px-7 bg-gradient-to-r from-green to-green-dim text-bg-primary font-mono text-[13px] font-bold no-underline border-none cursor-pointer tracking-[1px] uppercase transition-all duration-200 hover:shadow-[0_0_30px_rgba(0,255,65,0.5)] hover:scale-105 group"
          aria-label="Sign in with GitHub"
        >
          <Github size={16} className="fill-bg-primary" aria-hidden="true" />
          Sign in with GitHub
          <ArrowRight size={14} className="group-hover:translate-x-0.5 transition-transform" aria-hidden="true" />
        </a>
        <a
          href="/download"
          className="btn-clip inline-flex items-center gap-2 py-3 px-5 border border-border-main text-text-secondary font-mono text-[12px] font-medium no-underline cursor-pointer tracking-[1px] uppercase transition-all duration-200 hover:bg-white/5 hover:text-text-primary hover:border-text-dim"
        >
          <Apple size={14} aria-hidden="true" />
          Download for macOS
        </a>
      </div>

      <a
        href="/playground"
        className="mt-8 inline-flex items-center gap-1.5 font-mono text-[11px] tracking-[1.5px] uppercase text-text-dim hover:text-green transition-colors"
      >
        or see it working in the playground
        <ArrowRight size={12} aria-hidden="true" />
      </a>
    </section>
  );
}
