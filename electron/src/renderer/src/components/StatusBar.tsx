import type { CaptureStatus } from "../../../shared/types";

interface Props {
  status: CaptureStatus | null;
}

export function StatusBar({ status }: Props): JSX.Element {
  if (!status) {
    return (
      <footer className="flex h-7 shrink-0 items-center gap-3 border-t border-slate-800 bg-slate-900/60 px-3 text-[11px] text-slate-500">
        <span>connecting…</span>
      </footer>
    );
  }

  const dotColor = status.sidecarRunning
    ? "bg-emerald-500"
    : status.lastError
      ? "bg-rose-500"
      : "bg-slate-600";

  return (
    <footer className="flex h-7 shrink-0 items-center gap-3 border-t border-slate-800 bg-slate-900/60 px-3 text-[11px] text-slate-400">
      <span className="flex items-center gap-1.5">
        <span className={`inline-block h-1.5 w-1.5 rounded-full ${dotColor}`} />
        {status.sidecarRunning ? "capturing" : "stopped"}
      </span>
      {status.proxyPort !== null && (
        <span className="text-slate-500">
          proxy 127.0.0.1:{status.proxyPort}
        </span>
      )}
      {status.wsPort !== null && (
        <span className="text-slate-500">ws :{status.wsPort}</span>
      )}
      {status.caFingerprintSha256 && (
        <span
          className="truncate text-slate-600"
          title={status.caFingerprintSha256}
        >
          CA {status.caFingerprintSha256.slice(0, 12)}…
        </span>
      )}
      {status.lastError && (
        <span className="ml-auto text-rose-400 selectable">
          {status.lastError}
        </span>
      )}
    </footer>
  );
}
