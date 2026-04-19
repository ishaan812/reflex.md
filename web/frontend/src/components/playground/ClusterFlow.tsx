import { ArrowRight } from "lucide-react";
import type { Cluster } from "@/data/playground-scenarios";

/**
 * Stage 3: shows how N friction signals collapse into 1 cluster → 1 rule.
 * A horizontal N → cluster → rule chain dramatizes the compression.
 */
export function ClusterFlow({
  cluster,
  signalCount,
  frictionScore,
  ruleText,
}: {
  cluster: Cluster;
  signalCount: number;
  frictionScore: number;
  ruleText: string;
}) {
  return (
    <div className="flex flex-col gap-6">
      <div className="flex items-center gap-4 font-mono text-[11px] uppercase tracking-[2px] text-text-dim flex-wrap">
        <Pill label={`${signalCount} signals`} tone="red" />
        <ArrowRight size={14} className="text-green" aria-hidden="true" />
        <Pill label="1 cluster" tone="amber" />
        <ArrowRight size={14} className="text-green" aria-hidden="true" />
        <Pill label="1 rule" tone="green" />
        <div className="ml-auto text-[11px] text-text-secondary">
          Headline FQ:{" "}
          <span className="text-green font-mono">
            {frictionScore.toFixed(2)}
          </span>
        </div>
      </div>

      <div className="border border-border-main bg-bg-card p-5 rounded-[4px]">
        <div className="flex items-center justify-between gap-3 mb-3">
          <div className="font-mono text-xs text-text-primary">
            cluster · <span className="text-green">{cluster.key}</span>
          </div>
          <div className="flex items-center gap-2">
            <span className="font-mono text-[10px] py-0.5 px-2 rounded-full border border-red-correction/50 text-red-correction">
              ×{cluster.count}
            </span>
            <span className="font-mono text-[10px] py-0.5 px-2 rounded-full border border-border-main text-text-secondary">
              intensity {cluster.totalIntensity}
            </span>
          </div>
        </div>
        <ul className="flex flex-col gap-1.5">
          {cluster.samples.map((s, i) => (
            <li
              key={i}
              className="pl-3 border-l-2 border-red-correction/70 text-[12px] text-text-secondary italic font-mono leading-[1.65]"
            >
              "{s.quote}"
              <span className="not-italic ml-2 text-[10px] text-text-dim">
                · {s.sessionId}
              </span>
            </li>
          ))}
        </ul>
      </div>

      <div className="border border-border-green bg-[rgba(0,255,65,0.04)] p-5 rounded-[4px]">
        <div className="font-mono text-[10px] uppercase tracking-[2px] text-green mb-2">
          Proposed rule
        </div>
        <div className="font-display text-[15px] md:text-base text-text-primary leading-[1.55]">
          {ruleText}
        </div>
      </div>
    </div>
  );
}

function Pill({
  label,
  tone,
}: {
  label: string;
  tone: "red" | "amber" | "green";
}) {
  const classes =
    tone === "red"
      ? "border-red-correction/50 text-red-correction bg-[rgba(185,28,28,0.06)]"
      : tone === "amber"
        ? "border-amber-warn/40 text-amber-warn bg-[rgba(217,119,6,0.06)]"
        : "border-border-green text-green bg-[rgba(0,255,65,0.06)]";
  return (
    <span
      className={`font-mono text-[10px] tracking-[2px] uppercase py-1 px-3 border rounded-full ${classes}`}
    >
      {label}
    </span>
  );
}
