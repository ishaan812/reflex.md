import { Github, ArrowRight } from "lucide-react";

export function CTA() {
  return (
    <section className="py-[120px] px-6 text-center" aria-labelledby="cta-title">
      <span
        className="text-green text-[40px] font-bold font-display"
        aria-hidden="true"
      >
        &gt;{" "}
      </span>
      <h2
        id="cta-title"
        className="font-display text-[32px] md:text-5xl font-bold tracking-[-1.5px] mb-4"
      >
        Ready to stop re-typing corrections?
      </h2>
      <p className="text-sm text-text-secondary mb-10 max-w-[520px] mx-auto">
        Requires <span className="text-green">entire-cli</span> installed on the
        target repo. Reflex.md reads the shadow branch; your source code is never
        modified.
      </p>

      <a
        href="/auth/github"
        className="btn-clip inline-flex items-center gap-2 py-4 px-8 bg-gradient-to-r from-green to-green-dim text-bg-primary font-mono text-sm font-bold no-underline cursor-pointer tracking-[1px] uppercase transition-all duration-200 hover:shadow-[0_0_30px_rgba(0,255,65,0.5)] hover:scale-105 group"
      >
        <Github size={16} className="fill-bg-primary" aria-hidden="true" />
        Install on GitHub
        <ArrowRight
          size={16}
          className="group-hover:translate-x-0.5 transition-transform"
          aria-hidden="true"
        />
      </a>

      <span className="block mt-6 text-xs text-text-dim">
        Open source. MIT License. Your data never leaves your machine without consent.
      </span>
    </section>
  );
}
