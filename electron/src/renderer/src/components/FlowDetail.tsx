import { useMemo, useState } from "react";

import type { FlowDetail, Headers } from "../../../shared/types";

interface Props {
  flow: FlowDetail | null;
}

type Tab = "request" | "response" | "raw";

export function FlowDetailView({ flow }: Props): JSX.Element {
  const [tab, setTab] = useState<Tab>("response");

  if (!flow) {
    return (
      <div className="flex h-full items-center justify-center text-slate-600">
        Select a flow on the left
      </div>
    );
  }

  return (
    <div className="flex h-full min-h-0 flex-col">
      <div className="shrink-0 border-b border-slate-800 p-4">
        <div className="flex items-baseline gap-2">
          <span className="font-semibold text-slate-200">{flow.method}</span>
          <span className="truncate text-slate-400 selectable">{flow.url}</span>
        </div>
        <div className="mt-1 flex items-center gap-3 text-xs text-slate-500">
          <span>{flow.ts}</span>
          {flow.status !== null && <span>status {flow.status}</span>}
          {flow.duration_ms !== null && <span>{flow.duration_ms}ms</span>}
          <span>
            req {humanBytes(flow.request_bytes)}
            {flow.request_truncated && " (truncated)"}
          </span>
          <span>
            resp {humanBytes(flow.response_bytes)}
            {flow.response_truncated && " (truncated)"}
          </span>
          {flow.error && (
            <span className="text-rose-400">error: {flow.error}</span>
          )}
        </div>
      </div>

      <nav className="flex shrink-0 gap-1 border-b border-slate-800 px-4 text-xs">
        {(["request", "response", "raw"] as Tab[]).map((t) => (
          <button
            key={t}
            onClick={() => setTab(t)}
            className={`px-3 py-2 capitalize transition ${
              tab === t
                ? "border-b border-sky-400 text-sky-300"
                : "text-slate-500 hover:text-slate-300"
            }`}
          >
            {t}
          </button>
        ))}
      </nav>

      <div className="min-h-0 flex-1 overflow-y-auto">
        {tab === "request" && (
          <HeadersAndBody
            title="Request"
            headers={flow.request_headers}
            bodyB64={flow.request_body}
            contentType={flow.request_headers["content-type"] ?? null}
          />
        )}
        {tab === "response" && (
          <HeadersAndBody
            title="Response"
            headers={flow.response_headers}
            bodyB64={flow.response_body}
            contentType={flow.response_headers["content-type"] ?? null}
          />
        )}
        {tab === "raw" && (
          <pre className="selectable whitespace-pre-wrap p-4 text-xs text-slate-400">
            {JSON.stringify(flow, null, 2)}
          </pre>
        )}
      </div>
    </div>
  );
}

function HeadersAndBody({
  title,
  headers,
  bodyB64,
  contentType,
}: {
  title: string;
  headers: Headers;
  bodyB64: string | null;
  contentType: string | null;
}): JSX.Element {
  const decoded = useMemo(() => {
    if (!bodyB64) return "";
    try {
      return atob(bodyB64);
    } catch {
      return "<failed to decode>";
    }
  }, [bodyB64]);

  const pretty = useMemo(() => tryPrettyJson(decoded, contentType), [
    decoded,
    contentType,
  ]);

  return (
    <div className="space-y-4 p-4">
      <section>
        <h3 className="mb-2 text-xs font-semibold uppercase tracking-wide text-slate-500">
          {title} headers
        </h3>
        <dl className="grid grid-cols-[180px_1fr] gap-x-3 gap-y-0.5 text-xs selectable">
          {Object.entries(headers).length === 0 && (
            <div className="col-span-2 text-slate-600">(none)</div>
          )}
          {Object.entries(headers).map(([k, v]) => (
            <div key={k} className="contents">
              <dt className="truncate text-slate-500">{k}</dt>
              <dd className="break-all text-slate-300">{v}</dd>
            </div>
          ))}
        </dl>
      </section>

      <section>
        <h3 className="mb-2 text-xs font-semibold uppercase tracking-wide text-slate-500">
          {title} body
        </h3>
        <pre className="selectable max-h-[50vh] overflow-auto rounded bg-slate-900 p-3 text-xs text-slate-300">
          {pretty || "(empty)"}
        </pre>
      </section>
    </div>
  );
}

function tryPrettyJson(s: string, contentType: string | null): string {
  if (!s) return s;
  const looksJson =
    (contentType ?? "").includes("json") ||
    s.trim().startsWith("{") ||
    s.trim().startsWith("[");
  if (!looksJson) return s;
  try {
    return JSON.stringify(JSON.parse(s), null, 2);
  } catch {
    return s;
  }
}

function humanBytes(n: number): string {
  if (n < 1024) return `${n}B`;
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(1)}KB`;
  return `${(n / 1024 / 1024).toFixed(1)}MB`;
}
