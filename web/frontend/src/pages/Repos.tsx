import { useEffect } from "react";
import { Link, useNavigate } from "react-router-dom";
import { useQuery } from "@tanstack/react-query";
import { Github, Lock, LogIn, AlertCircle } from "lucide-react";
import { api } from "@/api";
import { DashboardNav } from "@/components/dashboard/DashboardNav";
import { Card } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import { Button } from "@/components/ui/button";

export function Repos() {
  const navigate = useNavigate();
  const meQ = useQuery({ queryKey: ["me"], queryFn: api.me });
  const unauth = meQ.isError && (meQ.error as any)?.status === 401;

  useEffect(() => {
    if (unauth) {
      // stay on page but show login CTA
    }
  }, [unauth]);

  const reposQ = useQuery({
    queryKey: ["repos"],
    queryFn: api.repos,
    enabled: !!meQ.data,
  });

  if (unauth) {
    return (
      <>
        <DashboardNav login={null} />
        <main className="max-w-xl mx-auto px-6 py-24 text-center">
          <h1 className="font-display text-3xl font-bold mb-3">
            Sign in to continue
          </h1>
          <p className="text-sm text-text-secondary mb-8">
            Reflex.md needs access to your GitHub repositories to read the{" "}
            <span className="text-green">entire/checkpoints/v1</span> shadow
            branch.
          </p>
          <a
            href="/auth/github"
            className="btn-clip inline-flex items-center gap-2 py-3.5 px-6 bg-gradient-to-r from-green to-green-dim text-bg-primary font-mono text-sm font-bold uppercase tracking-[1px] hover:shadow-[0_0_30px_rgba(0,255,65,0.5)]"
          >
            <Github size={16} className="fill-bg-primary" />
            Install on GitHub
          </a>
        </main>
      </>
    );
  }

  return (
    <>
      <DashboardNav login={meQ.data?.login ?? null} />
      <main className="max-w-6xl mx-auto px-6 py-10">
        <header className="mb-8">
          <div className="text-[10px] uppercase tracking-[2px] text-text-dim mb-2">
            /repos
          </div>
          <h1 className="font-display text-3xl font-bold">
            Pick a repository to analyze
          </h1>
          <p className="text-sm text-text-secondary mt-2 max-w-xl">
            Reflex reads only the{" "}
            <span className="text-green">entire/checkpoints/v1</span> branch. If
            a repo doesn't have one, install{" "}
            <span className="text-green">entire-cli</span> first.
          </p>
        </header>

        {reposQ.isLoading && (
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            {Array.from({ length: 6 }).map((_, i) => (
              <Skeleton key={i} className="h-28" />
            ))}
          </div>
        )}

        {reposQ.isError && (
          <Card className="p-6 flex items-center gap-3">
            <AlertCircle className="text-red-correction" size={18} />
            <div className="text-sm text-text-secondary">
              Could not load repos.{" "}
              <button
                className="text-green underline"
                onClick={() => reposQ.refetch()}
              >
                Retry
              </button>
            </div>
          </Card>
        )}

        {reposQ.data && (
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
            {reposQ.data.map((r) => (
              <Card
                key={r.full_name}
                className="p-5 cursor-pointer hover:border-border-green hover:shadow-[0_0_18px_rgba(0,255,65,0.12)] transition-all"
                onClick={() => navigate(`/repos/${r.owner}/${r.name}`)}
                role="button"
                tabIndex={0}
                onKeyDown={(e) => {
                  if (e.key === "Enter")
                    navigate(`/repos/${r.owner}/${r.name}`);
                }}
              >
                <div className="flex items-center justify-between mb-2">
                  <span className="font-mono text-[11px] text-text-dim truncate">
                    {r.owner}
                  </span>
                  {r.private ? (
                    <Badge variant="outline">
                      <Lock size={10} /> private
                    </Badge>
                  ) : (
                    <Badge variant="default">public</Badge>
                  )}
                </div>
                <div className="font-display text-lg font-semibold text-text-primary truncate">
                  {r.name}
                </div>
                {r.description && (
                  <p className="text-xs text-text-secondary mt-2 line-clamp-2">
                    {r.description}
                  </p>
                )}
                <div className="flex items-center gap-3 mt-4 text-[11px] text-text-dim font-mono">
                  <span>default: {r.defaultBranch}</span>
                  {r.pushedAt && (
                    <span>
                      · pushed {new Date(r.pushedAt).toLocaleDateString()}
                    </span>
                  )}
                </div>
              </Card>
            ))}
          </div>
        )}

        {reposQ.data?.length === 0 && (
          <Card className="p-8 text-center">
            <p className="text-sm text-text-secondary">
              No repositories found.{" "}
              <Link to="/" className="text-green underline">
                Back to landing
              </Link>
            </p>
          </Card>
        )}

        {meQ.isLoading && (
          <div className="flex items-center gap-2 text-xs text-text-dim">
            <LogIn size={12} /> checking session...
          </div>
        )}
      </main>
    </>
  );
}
