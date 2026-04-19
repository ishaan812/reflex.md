import { useState } from "react";
import { Apple, ArrowRight, Check, Copy, Terminal } from "lucide-react";
import { Navbar } from "@/components/landing/Navbar";
import { Footer } from "@/components/landing/Footer";
import { RequireAuth } from "@/components/RequireAuth";

const REPO = "ishaan812/reflex.md";
const RELEASE_PAGE = `https://github.com/${REPO}/releases/latest`;
// Predictable GitHub Releases asset pattern. electron-builder currently
// emits Reflex-<version>-arm64.dmg. Users can fall back to the releases
// page if a given version is missing.
const DMG_ARM64 = `https://github.com/${REPO}/releases/latest/download/Reflex-0.1.0-arm64.dmg`;

const INSTALL_STEPS = [
  {
    title: "Download the .dmg",
    desc: "Apple Silicon build. 1-click install, no Developer ID required — ad-hoc signed.",
  },
  {
    title: "Drag Reflex to Applications",
    desc: "Standard macOS install. The app bundles the Rust capture sidecar and all dependencies.",
  },
  {
    title: "Launch & sign in",
    desc: "Reflex picks up your GitHub session and starts watching your agent workflows.",
  },
];

export function Download() {
  return (
    <RequireAuth>
      {({ login }) => <DownloadContent login={login} />}
    </RequireAuth>
  );
}

function DownloadContent({ login }: { login: string }) {
  const [copied, setCopied] = useState(false);

  const copyLink = async () => {
    try {
      await navigator.clipboard.writeText(DMG_ARM64);
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    } catch {
      /* ignore */
    }
  };

  return (
    <>
      <a
        href="#main-content"
        className="sr-only focus:not-sr-only focus:fixed focus:top-2 focus:left-2 focus:z-[200] focus:bg-green focus:text-bg-primary focus:px-4 focus:py-2 focus:rounded focus:font-mono focus:text-sm"
      >
        Skip to main content
      </a>
      <Navbar />
      <main
        id="main-content"
        className="min-h-[calc(100vh-56px)] pt-[120px] md:pt-[140px] px-5 md:px-6 pb-20"
      >
        <section
          className="max-w-[720px] mx-auto text-center hero-glow relative"
          aria-labelledby="download-title"
        >
          <div
            className="inline-flex items-center gap-2 py-1.5 px-4 bg-[rgba(0,255,65,0.08)] border border-border-green rounded-[20px] text-[10px] tracking-[2px] uppercase text-green mb-8"
            aria-live="polite"
          >
            <Check size={12} aria-hidden="true" />
            <span>
              Signed in as <span className="font-bold">{login}</span>
            </span>
          </div>

          <div
            className="font-display text-4xl md:text-[56px] font-bold text-green tracking-[-1.5px] mb-4 italic [text-shadow:0_0_40px_rgba(0,255,65,0.3)]"
            aria-hidden="true"
          >
            Reflex.md
          </div>

          <h1
            id="download-title"
            className="font-display text-[28px] md:text-[40px] font-bold leading-[1.15] tracking-[-1px] mb-4"
          >
            <span className="text-text-primary">Download the </span>
            <span className="text-green [text-shadow:0_0_30px_rgba(0,255,65,0.3)]">
              desktop app
            </span>
          </h1>

          <p className="font-mono text-[13px] md:text-sm text-text-secondary leading-[1.8] max-w-[520px] mx-auto mb-10">
            Reflex runs locally on macOS. It watches your agent workflows,
            clusters the corrections you keep repeating, and opens a PR on
            AGENTS.md with what it learned.
          </p>

          <div className="flex flex-col sm:flex-row gap-4 justify-center items-center mb-6">
            <a
              href={DMG_ARM64}
              className="btn-clip inline-flex items-center gap-2 py-4 px-8 bg-gradient-to-r from-green to-green-dim text-bg-primary font-mono text-sm font-bold no-underline border-none cursor-pointer tracking-[1px] uppercase transition-all duration-200 hover:shadow-[0_0_30px_rgba(0,255,65,0.5)] hover:scale-[1.03] group"
              aria-label="Download Reflex for macOS Apple Silicon"
            >
              <Apple size={18} className="fill-bg-primary" aria-hidden="true" />
              Download for macOS
              <ArrowRight
                size={14}
                className="group-hover:translate-x-0.5 transition-transform"
                aria-hidden="true"
              />
            </a>

            <button
              type="button"
              onClick={copyLink}
              className="btn-clip inline-flex items-center gap-2 py-3.5 px-5 border border-border-main text-text-secondary font-mono text-[12px] font-medium cursor-pointer tracking-[1px] uppercase transition-all duration-200 hover:bg-white/5 hover:text-text-primary hover:border-text-dim"
              aria-label="Copy download link"
            >
              {copied ? (
                <>
                  <Check size={14} aria-hidden="true" /> Copied
                </>
              ) : (
                <>
                  <Copy size={14} aria-hidden="true" /> Copy link
                </>
              )}
            </button>
          </div>

          <div className="font-mono text-[11px] text-text-dim">
            macOS 12+ · Apple Silicon (arm64) ·{" "}
            <a
              href={RELEASE_PAGE}
              target="_blank"
              rel="noopener noreferrer"
              className="text-text-secondary hover:text-green transition-colors"
            >
              all releases →
            </a>
          </div>
        </section>

        <section
          className="max-w-[720px] mx-auto mt-20"
          aria-labelledby="install-title"
        >
          <h2
            id="install-title"
            className="font-mono text-[10px] text-green tracking-[3px] uppercase text-center mb-8"
          >
            &lt; 3 steps to get going /&gt;
          </h2>
          <ol className="grid grid-cols-1 md:grid-cols-3 gap-4" role="list">
            {INSTALL_STEPS.map((step, i) => (
              <li
                key={step.title}
                className="p-6 bg-bg-card border border-border-main rounded-[4px] transition-all duration-300 hover:border-border-green hover:shadow-[0_0_30px_rgba(0,255,65,0.12)]"
              >
                <div
                  className="text-[11px] text-text-dim tracking-[2px] uppercase mb-3 font-mono"
                  aria-hidden="true"
                >
                  0{i + 1}
                </div>
                <h3 className="font-display text-base font-semibold text-text-primary mb-2">
                  {step.title}
                </h3>
                <p className="text-[12px] text-text-secondary leading-[1.7]">
                  {step.desc}
                </p>
              </li>
            ))}
          </ol>
        </section>

        <section
          className="max-w-[720px] mx-auto mt-16 p-6 bg-bg-terminal border border-border-main rounded-lg"
          aria-labelledby="gatekeeper-title"
        >
          <div className="flex items-center gap-2 mb-3">
            <Terminal size={14} className="text-green" aria-hidden="true" />
            <h2
              id="gatekeeper-title"
              className="font-mono text-[11px] text-green tracking-[2px] uppercase"
            >
              First launch on macOS
            </h2>
          </div>
          <p className="font-mono text-[12px] text-text-secondary leading-[1.8]">
            Reflex ships ad-hoc signed (no Apple Developer ID). If Gatekeeper
            blocks it, right-click{" "}
            <span className="text-text-primary">Reflex.app</span> →{" "}
            <span className="text-text-primary">Open</span> once. Or run:
          </p>
          <pre className="mt-3 font-mono text-[12px] text-green bg-[#0a0a0a] border border-border-main rounded p-3 overflow-x-auto">
            <code>xattr -dr com.apple.quarantine /Applications/Reflex.app</code>
          </pre>
        </section>
      </main>
      <Footer />
    </>
  );
}
