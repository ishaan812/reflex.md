import type { FlowSummary } from "../../../shared/types";

interface Props {
  flows: FlowSummary[];
  selectedId: string | null;
  onSelect: (id: string) => void;
}

export function FlowList({ flows, selectedId, onSelect }: Props): JSX.Element {
  if (flows.length === 0) {
    return (
      <div className="p-6 text-slate-500">
        No flows yet. Start an AI app while Reflex is running —
        traffic matching the host allowlist will appear here.
      </div>
    );
  }

  return (
    <ul className="divide-y divide-slate-800">
      {flows.map((f) => (
        <li key={f.id}>
          <button
            onClick={() => onSelect(f.id)}
            className={`flex w-full flex-col gap-0.5 px-3 py-2 text-left transition hover:bg-slate-900 ${
              selectedId === f.id ? "bg-slate-900" : ""
            }`}
          >
            <div className="flex items-center gap-2 text-xs">
              <StatusBadge status={f.status} error={f.error} />
              <span className="font-semibold text-slate-300">{f.method}</span>
              <span className="truncate text-slate-400">{f.host}</span>
              {f.duration_ms !== null && (
                <span className="ml-auto shrink-0 tabular-nums text-slate-500">
                  {f.duration_ms}ms
                </span>
              )}
            </div>
            <div className="truncate text-xs text-slate-500">{f.path}</div>
          </button>
        </li>
      ))}
    </ul>
  );
}

function StatusBadge({
  status,
  error,
}: {
  status: number | null;
  error: string | null;
}): JSX.Element {
  if (error) {
    return (
      <span className="inline-block rounded bg-rose-950 px-1.5 text-[10px] font-medium text-rose-300">
        ERR
      </span>
    );
  }
  if (status === null) {
    return (
      <span className="inline-block rounded bg-amber-950 px-1.5 text-[10px] font-medium text-amber-300">
        …
      </span>
    );
  }
  const color =
    status >= 500
      ? "bg-rose-950 text-rose-300"
      : status >= 400
        ? "bg-amber-950 text-amber-300"
        : status >= 300
          ? "bg-sky-950 text-sky-300"
          : "bg-emerald-950 text-emerald-300";
  return (
    <span
      className={`inline-block rounded px-1.5 text-[10px] font-medium ${color}`}
    >
      {status}
    </span>
  );
}
