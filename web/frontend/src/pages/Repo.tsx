import { useEffect, useState } from "react";
import { useParams } from "react-router-dom";
import { useMutation, useQuery } from "@tanstack/react-query";
import { ArrowLeft, Loader2, Play, RefreshCw } from "lucide-react";
import { Link } from "react-router-dom";
import { api, type AnalysisOut, type SessionSummary } from "@/api";
import { DashboardNav } from "@/components/dashboard/DashboardNav";
import { SessionRow } from "@/components/dashboard/SessionRow";
import { FrictionReport } from "@/components/dashboard/FrictionReport";
import { DiffView } from "@/components/dashboard/DiffView";
import { OpenPrDialog } from "@/components/dashboard/OpenPrDialog";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import { ScrollArea } from "@/components/ui/scroll-area";

export function Repo() {
  const { owner = "", name = "" } = useParams();
  const meQ = useQuery({ queryKey: ["me"], queryFn: api.me });
  const unauth = meQ.isError && (meQ.error as any)?.status === 401;

  const [sessions, setSessions] = useState<SessionSummary[] | null>(null);
  const [selected, setSelected] = useState<string | null>(null);
  const [analysis, setAnalysis] = useState<AnalysisOut | null>(null);
  const [ingestError, setIngestError] = useState<string | null>(null);
  const [analyzeError, setAnalyzeError] = useState<string | null>(null);

  const ingestMut = useMutation({
    mutationFn: () => api.ingest(owner, name),
    onSuccess: (r) => {
      setSessions(r.sessions);
      setIngestError(null);
    },
    onError: (e: any) => setIngestError(e.message ?? "Ingest failed"),
  });

  const analyzeMut = useMutation({
    mutationFn: () => api.analyze(owner, name),
    onSuccess: (a) => {
      setAnalysis(a);
      setAnalyzeError(null);
    },
    onError: (e: any) => setAnalyzeError(e.message ?? "Analyze failed"),
  });

  // auto-ingest on first mount
  useEffect(() => {
    if (meQ.data && !sessions && !ingestMut.isPending && !ingestMut.isError) {
      ingestMut.mutate();
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [meQ.data]);

  if (unauth) {
    return (
      <>
        <DashboardNav login={null} />
        <main className="max-w-xl mx-auto px-6 py-24 text-center">
          <p className="text-sm text-text-secondary mb-4">
            You need to sign in to view this repo.
          </p>
          <a
            href="/auth/github"
            className="text-green underline font-mono text-sm"
          >
            Sign in with GitHub →
          </a>
        </main>
      </>
    );
  }

  return (
    <>
      <DashboardNav login={meQ.data?.login ?? null} />
      <main className="max-w-[1400px] mx-auto px-5 py-6">
        <header className="mb-5 flex items-center gap-4">
          <Link
            to="/repos"
            className="text-text-dim hover:text-green transition"
          >
            <ArrowLeft size={16} />
          </Link>
          <div>
            <div className="text-[10px] uppercase tracking-[2px] text-text-dim">
              /repos/{owner}
            </div>
            <h1 className="font-display text-2xl font-bold">{name}</h1>
          </div>
          <div className="ml-auto flex items-center gap-2">
            <Button
              variant="outline"
              size="sm"
              onClick={() => ingestMut.mutate()}
              disabled={ingestMut.isPending}
            >
              <RefreshCw size={14} className={ingestMut.isPending ? "animate-spin" : ""} />
              Re-ingest
            </Button>
          </div>
        </header>

        {ingestError && (
          <Card className="p-4 mb-5 border-red-correction/40 bg-[rgba(185,28,28,0.06)] text-red-correction text-sm">
            {ingestError}
          </Card>
        )}

        <div className="grid grid-cols-1 lg:grid-cols-[320px_1fr] gap-5 items-start">
          {/* LEFT — Timeline */}
          <section className="flex flex-col gap-3 min-h-0">
            <div className="flex items-center justify-between">
              <div className="text-[10px] uppercase tracking-[2px] text-text-dim">
                Session timeline
              </div>
              {sessions && (
                <Badge variant="outline">{sessions.length} sessions</Badge>
              )}
            </div>
            <ScrollArea className="max-h-[calc(100vh-180px)]">
              <div className="flex flex-col gap-3 pr-2">
                {ingestMut.isPending &&
                  !sessions &&
                  Array.from({ length: 3 }).map((_, i) => (
                    <Skeleton key={i} className="h-24" />
                  ))}
                {sessions?.length === 0 && (
                  <Card className="p-4 text-xs text-text-secondary">
                    No sessions parsed. Is the shadow branch populated?
                  </Card>
                )}
                {sessions?.map((s) => (
                  <SessionRow
                    key={s.id}
                    session={s}
                    selected={selected === s.id}
                    onClick={() => setSelected(s.id)}
                  />
                ))}
              </div>
            </ScrollArea>
          </section>

          {/* RIGHT — Analyze + Diff */}
          <section className="flex flex-col gap-5 min-w-0">
            <div className="flex items-center justify-between">
              <div className="text-[10px] uppercase tracking-[2px] text-text-dim">
                Friction report
              </div>
              <Button
                onClick={() => analyzeMut.mutate()}
                disabled={
                  analyzeMut.isPending ||
                  !sessions ||
                  sessions.length === 0
                }
              >
                {analyzeMut.isPending ? (
                  <Loader2 size={16} className="animate-spin" />
                ) : (
                  <Play size={14} className="fill-bg-primary" />
                )}
                {analysis ? "Re-analyze" : "Analyze"}
              </Button>
            </div>

            {analyzeError && (
              <Card className="p-4 border-red-correction/40 bg-[rgba(185,28,28,0.06)] text-red-correction text-sm">
                {analyzeError}
              </Card>
            )}

            {analyzeMut.isPending && (
              <div className="flex flex-col gap-3">
                <Skeleton className="h-20" />
                <Skeleton className="h-20" />
              </div>
            )}

            {analysis && (
              <>
                <FrictionReport
                  clusters={analysis.clusters}
                  frictionScore={analysis.frictionScore}
                />
                <div className="flex items-center justify-between">
                  <div className="text-[10px] uppercase tracking-[2px] text-text-dim">
                    Proposed {analysis.targetFile}
                  </div>
                  <OpenPrDialog
                    analysisId={analysis.id}
                    existingPrUrl={analysis.prUrl}
                    existingPrNumber={analysis.prNumber}
                  />
                </div>
                <Card className="overflow-hidden h-[640px] flex flex-col">
                  <DiffView analysis={analysis} />
                </Card>
              </>
            )}

            {!analysis && !analyzeMut.isPending && (
              <Card className="p-6 text-sm text-text-secondary">
                <p className="mb-2">
                  Run <span className="text-green">Analyze</span> to cluster
                  corrections across these sessions and propose an{" "}
                  <span className="text-green">AGENTS.md</span> edit.
                </p>
                <p className="text-xs text-text-dim">
                  Uses Gemini. One call per analysis.
                </p>
              </Card>
            )}
          </section>
        </div>
      </main>
    </>
  );
}
