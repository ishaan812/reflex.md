import { DiffEditor } from "@monaco-editor/react";
import { Card } from "@/components/ui/card";
import type { AnalysisOut } from "@/api";

export function DiffView({ analysis }: { analysis: AnalysisOut }) {
  return (
    <div className="flex flex-col h-full min-h-0">
      <div className="flex items-center justify-between p-3 border-b border-border-main bg-bg-secondary">
        <div className="flex items-center gap-3">
          <span className="text-[10px] uppercase tracking-[2px] text-text-dim">
            Proposed edit
          </span>
          <span className="font-mono text-sm text-green">
            {analysis.targetFile}
          </span>
        </div>
        <span className="font-mono text-[11px] text-text-dim">
          {analysis.reasoning.length} rule
          {analysis.reasoning.length === 1 ? "" : "s"} cited
        </span>
      </div>
      <div className="flex-1 min-h-[300px]">
        <DiffEditor
          language="markdown"
          theme="vs-dark"
          original={analysis.beforeText || "(file did not exist)"}
          modified={analysis.afterText}
          options={{
            renderSideBySide: true,
            readOnly: true,
            minimap: { enabled: false },
            scrollBeyondLastLine: false,
            fontFamily:
              "'JetBrains Mono', 'Fira Code', 'SF Mono', monospace",
            fontSize: 12,
          }}
        />
      </div>
      {analysis.reasoning.length > 0 && (
        <Card className="rounded-none border-t-0 border-x-0 border-b-0 max-h-52 overflow-auto">
          <div className="p-4">
            <div className="text-[10px] uppercase tracking-[2px] text-text-dim mb-3">
              Why this change
            </div>
            <ul className="space-y-3">
              {analysis.reasoning.map((r, i) => (
                <li key={i}>
                  <div className="font-medium text-text-primary text-sm">
                    {r.rule}
                  </div>
                  <div className="text-text-secondary italic text-xs mt-0.5">
                    "{r.evidenceText}"
                  </div>
                  <div className="text-[10px] font-mono text-green mt-0.5">
                    {r.checkpointIds.map((c) => c.slice(0, 8)).join(" · ")}
                  </div>
                </li>
              ))}
            </ul>
          </div>
        </Card>
      )}
    </div>
  );
}
