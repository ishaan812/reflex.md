import { useMemo, useState } from "react";
import { Apple, ArrowRight, Github, Sparkles } from "lucide-react";
import { Navbar } from "@/components/landing/Navbar";
import { Footer } from "@/components/landing/Footer";
import {
  PLAYGROUND_SCENARIOS,
  getScenario,
} from "@/data/playground-scenarios";
import { ScenarioTabs } from "@/components/playground/ScenarioTabs";
import {
  StepIndicator,
  type StepDescriptor,
} from "@/components/playground/StepIndicator";
import { TranscriptPlayer } from "@/components/playground/TranscriptPlayer";
import { DetectionPanel } from "@/components/playground/DetectionPanel";
import { ClusterFlow } from "@/components/playground/ClusterFlow";
import { DiffPanel } from "@/components/playground/DiffPanel";
import { BeforeAfterTerminals } from "@/components/playground/BeforeAfterTerminals";
import { DetectorReference } from "@/components/playground/DetectorReference";

const STEPS: StepDescriptor[] = [
  { id: "stage-1", num: "01", label: "Transcript" },
  { id: "stage-2", num: "02", label: "Detect" },
  { id: "stage-3", num: "03", label: "Cluster" },
  { id: "stage-4", num: "04", label: "AGENTS.md" },
  { id: "stage-5", num: "05", label: "After" },
  { id: "stage-6", num: "06", label: "Reference" },
];

export function Playground() {
  const [activeId, setActiveId] = useState<string>(PLAYGROUND_SCENARIOS[0].id);
  const scenario = useMemo(() => getScenario(activeId), [activeId]);

  // Cross-highlighting between signal pills and transcript lines.
  const [hoveredEventId, setHoveredEventId] = useState<string | null>(null);
  const [hoveredSignalId, setHoveredSignalId] = useState<string | null>(null);

  const ruleText =
    scenario.diff.reasoning[0]?.rule ?? "Capture the repeated correction as a rule.";

  return (
    <>
      <a
        href="#main-content"
        className="sr-only focus:not-sr-only focus:fixed focus:top-2 focus:left-2 focus:z-[200] focus:bg-green focus:text-bg-primary focus:px-4 focus:py-2 focus:rounded focus:font-mono focus:text-sm"
      >
        Skip to main content
      </a>
      <Navbar />

      <main id="main-content" className="pt-[96px] md:pt-[120px] pb-20">
        {/* ────────────────────────────── HERO ─────────────────────────────── */}
        <section
          className="hero-glow px-5 md:px-6 pb-12 md:pb-16 text-center relative overflow-hidden"
          aria-labelledby="playground-title"
        >
          <div className="inline-flex items-center gap-2 py-1.5 px-4 bg-[rgba(0,255,65,0.08)] border border-border-green rounded-[20px] text-[10px] tracking-[2px] uppercase text-green mb-8">
            <Sparkles size={11} className="text-green" aria-hidden="true" />
            <span>Playground // no sign-up</span>
          </div>

          <h1
            id="playground-title"
            className="font-display text-[30px] md:text-[48px] font-bold leading-[1.1] tracking-[-1.5px] mb-5"
          >
            <span className="text-text-primary">Tour the </span>
            <span className="text-green [text-shadow:0_0_30px_rgba(0,255,65,0.3)]">
              detector
            </span>
          </h1>

          <p className="font-mono text-[13px] md:text-sm text-text-secondary leading-[1.8] max-w-[620px] mx-auto">
            Pick a scenario. Watch Reflex turn noisy agent sessions into one
            clean <span className="text-green">AGENTS.md</span> edit — then see
            how the agent behaves once the rule is merged.
          </p>
        </section>

        {/* ─────────────────────────── SCENARIO TABS ───────────────────────── */}
        <section
          aria-label="Scenario picker"
          className="max-w-[1100px] mx-auto px-5 md:px-6 mb-10"
        >
          <ScenarioTabs
            scenarios={PLAYGROUND_SCENARIOS}
            activeId={activeId}
            onSelect={(id) => {
              setActiveId(id);
              setHoveredEventId(null);
              setHoveredSignalId(null);
            }}
          />
        </section>

        {/* ─────────────────────────── MAIN LAYOUT ─────────────────────────── */}
        <div
          id={`scenario-${scenario.id}`}
          role="tabpanel"
          className="max-w-[1200px] mx-auto px-5 md:px-6 grid grid-cols-1 lg:grid-cols-[180px_1fr] gap-8 lg:gap-12"
        >
          <StepIndicator steps={STEPS} />

          <div className="flex flex-col gap-20 min-w-0">
            {/* ───────── STAGE 1 · Transcript ───────── */}
            <Stage
              id="stage-1"
              num="01 // Transcript"
              title="Real agent sessions, captured verbatim"
              lede={
                <>
                  Reflex shadow-reads your agent CLI transcripts — user
                  messages, assistant replies, tool calls, tool results. No
                  telemetry, no cloud upload; everything parses locally first.
                </>
              }
            >
              <TranscriptPlayer
                events={scenario.transcript}
                highlightEventId={hoveredEventId}
                onLineHover={(id) => {
                  // Hovering a line doesn't select a signal — it only updates
                  // the highlight so cursor-driven exploration feels alive.
                  setHoveredEventId(id);
                }}
              />
            </Stage>

            {/* ───────── STAGE 2 · Detect ───────── */}
            <Stage
              id="stage-2"
              num="02 // Detect"
              title="Two cheap, explainable signals"
              lede={
                <>
                  Hover a pill to highlight where Reflex saw it in the
                  transcript above. Every signal is backed by a rule you can
                  read in{" "}
                  <code className="text-green">friction.ts</code>.
                </>
              }
            >
              <DetectionPanel
                signals={scenario.signals}
                hoveredSignalId={hoveredSignalId}
                onSignalHover={(eventId, signalId) => {
                  setHoveredEventId(eventId);
                  setHoveredSignalId(signalId);
                }}
              />
            </Stage>

            {/* ───────── STAGE 3 · Cluster ───────── */}
            <Stage
              id="stage-3"
              num="03 // Cluster"
              title="Many signals collapse into one rule"
              lede={
                <>
                  A token-based cluster key groups semantically similar
                  corrections together so noisy sessions don't generate noisy
                  edits. Only clusters above a minimum intensity make it to
                  the proposed-diff stage.
                </>
              }
            >
              <ClusterFlow
                cluster={scenario.cluster}
                signalCount={scenario.signals.length}
                frictionScore={scenario.frictionScore}
                ruleText={ruleText}
              />
            </Stage>

            {/* ───────── STAGE 4 · AGENTS.md diff ───────── */}
            <Stage
              id="stage-4"
              num="04 // AGENTS.md"
              title="A minimal, auditable edit"
              lede={
                <>
                  Reflex writes the smallest change that encodes the rule,
                  with a "why this change" block that cites the exact sessions
                  it saw. You review, you merge — the diff is human-sized on
                  purpose.
                </>
              }
            >
              <DiffPanel diff={scenario.diff} />
            </Stage>

            {/* ───────── STAGE 5 · Before / After ───────── */}
            <Stage
              id="stage-5"
              num="05 // After"
              title="Same prompt, different day"
              lede={
                <>
                  The rule doesn't live in a checklist — your agent loads
                  AGENTS.md at the start of the next session and the behavior
                  shifts. Same task, no friction.
                </>
              }
            >
              <BeforeAfterTerminals
                before={scenario.before}
                after={scenario.after}
              />
            </Stage>

            {/* ───────── STAGE 6 · Detector reference ───────── */}
            <DetectorReference />

            {/* ─────────────────────────── CTA ─────────────────────────── */}
            <section
              aria-labelledby="playground-cta"
              className="text-center border-t border-border-main pt-16"
            >
              <h2
                id="playground-cta"
                className="font-display text-2xl md:text-[32px] font-bold leading-[1.2] tracking-[-0.5px] mb-4"
              >
                <span className="text-text-primary">Ready to point it at </span>
                <span className="text-green">your repo?</span>
              </h2>
              <p className="font-mono text-[13px] text-text-secondary max-w-[520px] mx-auto mb-8">
                One GitHub sign-in. The desktop app watches locally. Merge PRs
                when they make sense.
              </p>
              <div className="flex gap-4 flex-wrap justify-center">
                <a
                  href="/auth/github"
                  className="btn-clip inline-flex items-center gap-2 py-3.5 px-7 bg-gradient-to-r from-green to-green-dim text-bg-primary font-mono text-[13px] font-bold no-underline border-none cursor-pointer tracking-[1px] uppercase transition-all duration-200 hover:shadow-[0_0_30px_rgba(0,255,65,0.5)] hover:scale-105 group"
                >
                  <Github
                    size={16}
                    className="fill-bg-primary"
                    aria-hidden="true"
                  />
                  Sign in with GitHub
                  <ArrowRight
                    size={14}
                    className="group-hover:translate-x-0.5 transition-transform"
                    aria-hidden="true"
                  />
                </a>
                <a
                  href="/download"
                  className="btn-clip inline-flex items-center gap-2 py-3 px-5 border border-border-main text-text-secondary font-mono text-[12px] font-medium no-underline cursor-pointer tracking-[1px] uppercase transition-all duration-200 hover:bg-white/5 hover:text-text-primary hover:border-text-dim"
                >
                  <Apple size={14} aria-hidden="true" />
                  Download for macOS
                </a>
              </div>
            </section>
          </div>
        </div>
      </main>

      <Footer />
    </>
  );
}

// ────────────────────────────────────────────────────────────────────────────

function Stage({
  id,
  num,
  title,
  lede,
  children,
}: {
  id: string;
  num: string;
  title: string;
  lede: React.ReactNode;
  children: React.ReactNode;
}) {
  return (
    <section
      id={id}
      aria-labelledby={`${id}-title`}
      className="scroll-mt-28 flex flex-col gap-6"
    >
      <header>
        <div className="text-[10px] text-text-dim tracking-[2px] uppercase font-mono mb-2">
          {num}
        </div>
        <h2
          id={`${id}-title`}
          className="font-display text-2xl md:text-[28px] font-bold tracking-[-0.5px] mb-2"
        >
          {title}
        </h2>
        <p className="text-[13px] text-text-secondary max-w-[620px] leading-[1.7]">
          {lede}
        </p>
      </header>
      <div>{children}</div>
    </section>
  );
}
