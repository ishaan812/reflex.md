import { useState } from "react";
import { ExternalLink, GitPullRequest, Loader2 } from "lucide-react";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { api } from "@/api";

export function OpenPrDialog({
  analysisId,
  existingPrUrl,
  existingPrNumber,
}: {
  analysisId: string;
  existingPrUrl?: string | null;
  existingPrNumber?: number | null;
}) {
  const [open, setOpen] = useState(false);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [result, setResult] = useState<
    { prUrl: string; prNumber: number } | null
  >(
    existingPrUrl && existingPrNumber
      ? { prUrl: existingPrUrl, prNumber: existingPrNumber }
      : null,
  );

  const handleClick = async () => {
    setOpen(true);
    if (result) return;
    setLoading(true);
    setError(null);
    try {
      const r = await api.openPr(analysisId);
      setResult(r);
    } catch (e: any) {
      setError(e.message ?? "Failed to open PR");
    } finally {
      setLoading(false);
    }
  };

  return (
    <>
      <Button onClick={handleClick}>
        <GitPullRequest size={16} />
        {result ? `PR #${result.prNumber} opened` : "Open PR"}
      </Button>

      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>
              {result ? "Pull request ready" : "Opening pull request..."}
            </DialogTitle>
            <DialogDescription>
              {loading && "Creating branch, committing, and opening PR on GitHub."}
              {error && "Something went wrong."}
              {result &&
                "Every rule in the body cites the checkpoint ID it came from."}
            </DialogDescription>
          </DialogHeader>

          {loading && (
            <div className="flex items-center gap-3 py-6 text-sm text-text-secondary">
              <Loader2 size={18} className="animate-spin text-green" />
              <span>Talking to GitHub...</span>
            </div>
          )}

          {error && (
            <div className="p-3 border border-red-correction/40 bg-[rgba(185,28,28,0.08)] text-red-correction text-xs rounded">
              {error}
            </div>
          )}

          {result && (
            <div className="flex flex-col gap-3">
              <div className="font-mono text-sm text-text-primary break-all">
                #{result.prNumber} &middot;{" "}
                <span className="text-green">{result.prUrl}</span>
              </div>
              <a
                href={result.prUrl}
                target="_blank"
                rel="noopener noreferrer"
                className="btn-clip inline-flex items-center justify-center gap-2 py-3 px-5 bg-gradient-to-r from-green to-green-dim text-bg-primary font-mono text-xs font-bold uppercase tracking-[1px] hover:shadow-[0_0_30px_rgba(0,255,65,0.5)]"
              >
                <ExternalLink size={14} />
                Open on GitHub
              </a>
            </div>
          )}
        </DialogContent>
      </Dialog>
    </>
  );
}
