import { useMemo, useState } from "react";
import { Link, useNavigate } from "react-router-dom";
import { useQuery } from "@tanstack/react-query";
import {
  Github,
  Lock,
  LogIn,
  AlertCircle,
  Search,
  Plus,
  Globe,
  X,
} from "lucide-react";
import { api } from "@/api";
import { DashboardNav } from "@/components/dashboard/DashboardNav";
import { Card } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import { Button } from "@/components/ui/button";

/** Parse "owner/name", a github URL, or `git@github.com:owner/name.git` into {owner, name}. */
function parseRepoInput(raw: string): { owner: string; name: string } | null {
  const s = raw.trim();
  if (!s) return null;
  // owner/name shorthand
  const short = s.match(/^([\w.-]+)\s*\/\s*([\w.-]+?)(?:\.git)?$/);
  if (short) return { owner: short[1], name: short[2] };
  // full URL: https://github.com/owner/name(.git)?(/...)?
  try {
    const u = new URL(s.startsWith("http") ? s : `https://${s}`);
    if (!u.hostname.endsWith("github.com")) return null;
    const parts = u.pathname.replace(/^\/+/, "").split("/");
    if (parts.length < 2) return null;
    const owner = parts[0];
    const name = parts[1].replace(/\.git$/, "");
    if (!owner || !name) return null;
    return { owner, name };
  } catch {
    /* not a URL */
  }
  // git@github.com:owner/name.git
  const ssh = s.match(/^git@github\.com:([\w.-]+)\/([\w.-]+?)(?:\.git)?$/);
  if (ssh) return { owner: ssh[1], name: ssh[2] };
  return null;
}

export function Repos() {
  const navigate = useNavigate();
  const meQ = useQuery({ queryKey: ["me"], queryFn: api.me });
  const unauth = meQ.isError && (meQ.error as any)?.status === 401;

  const reposQ = useQuery({
    queryKey: ["repos"],
    queryFn: api.repos,
    enabled: !!meQ.data,
  });

  const [search, setSearch] = useState("");
  const [pasteOpen, setPasteOpen] = useState(false);
  const [pasteValue, setPasteValue] = useState("");
  const [pasteError, setPasteError] = useState<string | null>(null);

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    const list = reposQ.data ?? [];
    if (!q) return list;
    return list.filter((r) => {
      const hay = `${r.full_name} ${r.description ?? ""} ${r.defaultBranch}`.toLowerCase();
      return hay.includes(q);
    });
  }, [reposQ.data, search]);

  function handleAddPublic(e: React.FormEvent) {
    e.preventDefault();
    setPasteError(null);
    const parsed = parseRepoInput(pasteValue);
    if (!parsed) {
      setPasteError(
        "Use `owner/name` or a GitHub URL like https://github.com/owner/name",
      );
      return;
    }
    navigate(`/repos/${parsed.owner}/${parsed.name}`);
  }

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

        {/* Search + Add Public Repo controls */}
        <div className="flex flex-col md:flex-row gap-3 mb-6">
          <div className="relative flex-1">
            <Search
              size={14}
              className="absolute left-3 top-1/2 -translate-y-1/2 text-text-dim pointer-events-none"
              aria-hidden="true"
            />
            <input
              type="search"
              placeholder="Search your repos by name, description, or branch..."
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              className="w-full h-10 pl-9 pr-9 bg-bg-secondary border border-border-main rounded-md font-mono text-sm text-text-primary placeholder:text-text-dim focus:outline-none focus:border-border-green focus:shadow-[0_0_10px_rgba(0,255,65,0.1)] transition"
              aria-label="Search repositories"
            />
            {search && (
              <button
                type="button"
                onClick={() => setSearch("")}
                className="absolute right-2 top-1/2 -translate-y-1/2 text-text-dim hover:text-green p-1"
                aria-label="Clear search"
              >
                <X size={12} />
              </button>
            )}
          </div>
          <Button
            variant="outline"
            onClick={() => {
              setPasteOpen((o) => !o);
              setPasteError(null);
            }}
          >
            <Plus size={14} />
            Add public repo
          </Button>
        </div>

        {pasteOpen && (
          <Card className="p-4 mb-6">
            <form onSubmit={handleAddPublic} className="flex flex-col gap-3">
              <label className="text-[10px] uppercase tracking-[2px] text-text-dim flex items-center gap-2">
                <Globe size={12} />
                Open any public GitHub repo
              </label>
              <div className="flex flex-col md:flex-row gap-2">
                <input
                  autoFocus
                  type="text"
                  placeholder="owner/name  or  https://github.com/owner/name"
                  value={pasteValue}
                  onChange={(e) => setPasteValue(e.target.value)}
                  className="flex-1 h-10 px-3 bg-bg-primary border border-border-main rounded-md font-mono text-sm text-text-primary placeholder:text-text-dim focus:outline-none focus:border-border-green transition"
                  aria-label="Repository identifier"
                />
                <Button type="submit" disabled={!pasteValue.trim()}>
                  <Plus size={14} />
                  Open repo
                </Button>
              </div>
              {pasteError && (
                <p className="text-xs text-red-correction font-mono">
                  {pasteError}
                </p>
              )}
              <p className="text-[11px] text-text-dim">
                The repo must have an{" "}
                <span className="text-green">entire/checkpoints/v1</span>{" "}
                branch. Private repos work too if you have access.
              </p>
            </form>
          </Card>
        )}

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
          <>
            <div className="flex items-center justify-between mb-3 text-[11px] text-text-dim font-mono">
              <span>
                {filtered.length} of {reposQ.data.length} repo
                {reposQ.data.length === 1 ? "" : "s"}
                {search && ` matching "${search}"`}
              </span>
            </div>
            <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
              {filtered.map((r) => (
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
            {filtered.length === 0 && reposQ.data.length > 0 && (
              <Card className="p-8 text-center text-sm text-text-secondary">
                No repos match <span className="text-green">"{search}"</span>.{" "}
                Try a different query, or{" "}
                <button
                  type="button"
                  onClick={() => setPasteOpen(true)}
                  className="text-green underline"
                >
                  add a public repo manually
                </button>
                .
              </Card>
            )}
          </>
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
          <div className="flex items-center gap-2 text-xs text-text-dim mt-4">
            <LogIn size={12} /> checking session...
          </div>
        )}
      </main>
    </>
  );
}
