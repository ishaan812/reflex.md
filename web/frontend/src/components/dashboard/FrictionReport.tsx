import { Badge } from "@/components/ui/badge";
import { Card } from "@/components/ui/card";
import type { ClusterOut } from "@/api";

export function FrictionReport({
  clusters,
  frictionScore,
}: {
  clusters: ClusterOut[];
  frictionScore: number;
}) {
  if (!clusters.length) {
    return (
      <Card className="p-5 text-xs text-text-secondary">
        No repeated corrections detected. Headline FQ:{" "}
        <span className="text-green font-mono">{frictionScore.toFixed(2)}</span>.
      </Card>
    );
  }
  return (
    <div className="space-y-3">
      <div className="flex items-center justify-between">
        <div className="text-[10px] uppercase tracking-[2px] text-text-dim">
          Top correction clusters
        </div>
        <div className="text-xs text-text-secondary">
          Headline FQ:{" "}
          <span className="text-green font-mono">
            {frictionScore.toFixed(2)}
          </span>
        </div>
      </div>
      {clusters.map((c, i) => (
        <Card key={c.key + i} className="p-4">
          <div className="flex items-center justify-between gap-3 mb-2">
            <div className="font-mono text-xs text-text-primary truncate">
              {c.key || "(unclassified)"}
            </div>
            <div className="flex gap-2 shrink-0">
              <Badge variant="red">×{c.count}</Badge>
              <Badge variant="outline">
                intensity {c.totalIntensity}
              </Badge>
            </div>
          </div>
          <ul className="space-y-1">
            {c.samples.map((s, j) => (
              <li
                key={j}
                className="pl-3 border-l-2 border-red-correction text-[12px] text-text-secondary italic"
              >
                "{s}"
              </li>
            ))}
          </ul>
        </Card>
      ))}
    </div>
  );
}
