import { useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import {
  AlertCircle,
  Bot,
  ChevronDown,
  ChevronRight,
  CircleAlert,
  CircleCheck,
  Clock,
  FileEdit,
  Filter,
  MessageSquare,
  RotateCcw,
  Terminal,
  User,
  Wrench,
} from "lucide-react";
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetHeader,
  SheetTitle,
} from "@/components/ui/sheet";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Skeleton } from "@/components/ui/skeleton";
import { cn } from "@/lib/utils";
import {
  api,
  type NormalizedEvent,
  type NormalizedKind,
  type SessionDetail,
} from "@/api";

const NEGATION_RE =
  /\b(no|don'?t|stop|wait|revert|that'?s wrong|not (?:that|like)|instead|actually|undo|rollback)\b/i;

const KIND_LABEL: Record<NormalizedKind, string> = {
  user: "User",
  assistant: "Agent",
  tool_call: "Tool",
  tool_result: "Result",
  file_write: "File",
  todo: "Todos",
  raw: "Raw",
};

const FILTERS: Array<{ key: "all" | NormalizedKind; label: string }> = [
  { key: "all", label: "All" },
  { key: "user", label: "Prompts" },
  { key: "assistant", label: "Replies" },
  { key: "tool_call", label: "Tools" },
  { key: "file_write", label: "Files" },
  { key: "todo", label: "Todos" },
  { key: "raw", label: "Raw" },
];

function isCorrection(e: NormalizedEvent) {
  return e.kind === "user" && typeof e.text === "string" && NEGATION_RE.test(e.text);
}
function isToolFailure(e: NormalizedEvent) {
  return e.kind === "tool_result" && typeof e.exitCode === "number" && e.exitCode !== 0;
}

function fmtTime(ts: string | undefined) {
  if (!ts) return "";
  const d = new Date(ts);
  if (isNaN(d.getTime())) return ts;
  return d.toLocaleTimeString(undefined, {
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
  });
}

function fmtRelative(prev?: string, ts?: string): string | null {
  if (!prev || !ts) return null;
  const dt = new Date(ts).getTime() - new Date(prev).getTime();
  if (!Number.isFinite(dt) || dt < 1000) return null;
  if (dt < 60_000) return `+${Math.round(dt / 1000)}s`;
  if (dt < 3_600_000) return `+${Math.round(dt / 60_000)}m`;
  return `+${Math.round(dt / 3_600_000)}h`;
}

export function EventDrawer({
  sessionId,
  open,
  onOpenChange,
}: {
  sessionId: string | null;
  open: boolean;
  onOpenChange: (o: boolean) => void;
}) {
  const q = useQuery({
    queryKey: ["session", sessionId],
    queryFn: () => api.session(sessionId!),
    enabled: !!sessionId && open,
  });

  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent>
        {q.isLoading && <LoadingState />}
        {q.isError && (
          <div className="p-8 text-sm text-red-correction flex items-center gap-2">
            <AlertCircle size={16} />
            {(q.error as Error).message}
          </div>
        )}
        {q.data && <SessionView session={q.data} />}
      </SheetContent>
    </Sheet>
  );
}

function LoadingState() {
  return (
    <div className="p-6 flex flex-col gap-4">
      <Skeleton className="h-8 w-2/3" />
      <Skeleton className="h-5 w-1/2" />
      <Skeleton className="h-20" />
      <Skeleton className="h-12" />
      <Skeleton className="h-12" />
      <Skeleton className="h-12" />
    </div>
  );
}

function SessionView({ session }: { session: SessionDetail }) {
  const [filter, setFilter] = useState<"all" | NormalizedKind>("all");
  const [showRaw, setShowRaw] = useState(false);
  const [promptCollapsed, setPromptCollapsed] = useState(false);

  const events = session.normalizedEvents ?? [];
  const stats = useMemo(() => {
    const counts: Record<string, number> = {};
    let corrections = 0;
    let failures = 0;
    for (const e of events) {
      counts[e.kind] = (counts[e.kind] ?? 0) + 1;
      if (isCorrection(e)) corrections++;
      if (isToolFailure(e)) failures++;
    }
    return { counts, corrections, failures, total: events.length };
  }, [events]);

  const filtered = useMemo(() => {
    if (filter === "all") return events;
    return events.filter((e) => e.kind === filter);
  }, [events, filter]);

  const fq = session.frictionScore;
  const fqVariant = fq < 0.3 ? "green" : fq < 0.8 ? "amber" : "red";
  const inputTok = (session.tokenUsage as any)?.input_tokens ?? 0;
  const outputTok = (session.tokenUsage as any)?.output_tokens ?? 0;
  const totalTok = inputTok + outputTok;
  const apiCalls = (session.tokenUsage as any)?.api_call_count ?? 0;

  return (
    <>
      <SheetHeader>
        <div className="flex items-start justify-between gap-3">
          <div className="min-w-0">
            <div className="text-[10px] uppercase tracking-[2px] text-text-dim mb-1">
              {session.repo.owner}/{session.repo.name}
            </div>
            <SheetTitle className="truncate">
              Session #{session.idx}{" "}
              <span className="text-text-dim font-mono text-sm font-normal">
                · {session.checkpointId.slice(0, 12)}
              </span>
            </SheetTitle>
            <SheetDescription className="mt-1 flex flex-wrap items-center gap-2">
              <Badge variant="default">{session.agent ?? "Unknown Agent"}</Badge>
              <Badge variant="muted">{session.strategy}</Badge>
              {session.branch && (
                <Badge variant="outline">↳ {session.branch}</Badge>
              )}
              <Badge variant={fqVariant as any}>FQ {fq.toFixed(2)}</Badge>
              {stats.corrections > 0 && (
                <Badge variant="red">
                  {stats.corrections} correction
                  {stats.corrections === 1 ? "" : "s"}
                </Badge>
              )}
              {stats.failures > 0 && (
                <Badge variant="amber">
                  {stats.failures} tool failure
                  {stats.failures === 1 ? "" : "s"}
                </Badge>
              )}
            </SheetDescription>
          </div>
        </div>

        <div className="grid grid-cols-2 md:grid-cols-4 gap-2 mt-3 text-[11px] font-mono text-text-secondary">
          <div className="flex items-center gap-1">
            <Clock size={12} className="text-text-dim" />
            {fmtTime(session.startedAt)}
          </div>
          <div>
            <span className="text-text-dim">events: </span>
            {stats.total}
          </div>
          <div>
            <span className="text-text-dim">tokens: </span>
            {totalTok ? totalTok.toLocaleString() : "—"}
          </div>
          <div>
            <span className="text-text-dim">api calls: </span>
            {apiCalls || "—"}
          </div>
        </div>
      </SheetHeader>

      {/* Prompt.txt block — canonical user intent */}
      {session.prompt && session.prompt.trim() && (
        <div className="px-5 py-4 border-b border-border-main bg-[rgba(0,255,65,0.02)]">
          <div className="flex items-center justify-between mb-2">
            <div className="flex items-center gap-2">
              <User size={12} className="text-green" />
              <span className="text-[10px] uppercase tracking-[2px] text-green">
                Prompt.txt — what the user typed
              </span>
            </div>
            <button
              type="button"
              className="text-[10px] uppercase tracking-[1px] text-text-dim hover:text-green"
              onClick={() => setPromptCollapsed((v) => !v)}
            >
              {promptCollapsed ? (
                <>
                  <ChevronRight size={10} className="inline" /> expand
                </>
              ) : (
                <>
                  <ChevronDown size={10} className="inline" /> collapse
                </>
              )}
            </button>
          </div>
          {!promptCollapsed && (
            <pre className="font-mono text-[12px] text-text-primary whitespace-pre-wrap break-words max-h-64 overflow-auto leading-[1.6]">
              {session.prompt}
            </pre>
          )}
        </div>
      )}

      {/* Filter bar */}
      <div className="flex items-center justify-between gap-2 px-5 py-3 border-b border-border-main bg-bg-secondary">
        <div className="flex items-center gap-1 flex-wrap">
          <Filter size={12} className="text-text-dim mr-1" />
          {FILTERS.map((f) => {
            const count =
              f.key === "all" ? stats.total : stats.counts[f.key] ?? 0;
            if (f.key !== "all" && count === 0) return null;
            const active = filter === f.key;
            return (
              <button
                key={f.key}
                type="button"
                onClick={() => setFilter(f.key)}
                className={cn(
                  "px-2.5 h-7 rounded font-mono text-[11px] uppercase tracking-[1px] transition border",
                  active
                    ? "bg-green text-bg-primary border-green font-bold"
                    : "bg-transparent text-text-secondary border-border-main hover:border-border-green hover:text-green",
                )}
              >
                {f.label}
                <span className="ml-1.5 opacity-60">{count}</span>
              </button>
            );
          })}
        </div>
        <Button
          size="sm"
          variant="ghost"
          onClick={() => setShowRaw((v) => !v)}
          className="text-[11px]"
        >
          {showRaw ? "Hide raw" : "Show raw"}
        </Button>
      </div>

      <ScrollArea className="flex-1 min-h-0">
        <ol className="px-5 py-4 space-y-2">
          {filtered.length === 0 && (
            <li className="text-sm text-text-secondary p-4 text-center">
              No events in this filter.
            </li>
          )}
          {filtered.map((e, i) => (
            <EventItem
              key={i}
              event={e}
              prevTs={i > 0 ? filtered[i - 1]?.ts : undefined}
              showRaw={showRaw}
              index={i}
            />
          ))}
        </ol>
      </ScrollArea>
    </>
  );
}

function EventItem({
  event,
  prevTs,
  showRaw,
  index,
}: {
  event: NormalizedEvent;
  prevTs?: string;
  showRaw: boolean;
  index: number;
}) {
  const rel = fmtRelative(prevTs, event.ts);
  const correction = isCorrection(event);
  const failure = isToolFailure(event);

  const accent = correction
    ? "border-l-red-correction"
    : failure
      ? "border-l-amber-warn"
      : event.kind === "user"
        ? "border-l-green"
        : event.kind === "assistant"
          ? "border-l-text-dim"
          : event.kind === "tool_call" || event.kind === "file_write"
            ? "border-l-[#58a6ff]"
            : "border-l-border-main";

  return (
    <li
      className={cn(
        "border border-border-main rounded-[4px] bg-bg-card overflow-hidden border-l-2",
        accent,
      )}
    >
      <div className="flex items-center justify-between gap-3 px-3 py-2 bg-[rgba(255,255,255,0.015)]">
        <div className="flex items-center gap-2 min-w-0">
          <KindIcon kind={event.kind} />
          <span className="text-[10px] uppercase tracking-[2px] text-text-dim font-mono">
            {KIND_LABEL[event.kind]}
          </span>
          {event.toolName && (
            <span className="font-mono text-[11px] text-[#58a6ff] truncate">
              {event.toolName}
            </span>
          )}
          {correction && <Badge variant="red">correction</Badge>}
          {failure && <Badge variant="amber">exit {event.exitCode}</Badge>}
        </div>
        <div className="flex items-center gap-2 text-[10px] font-mono text-text-dim shrink-0">
          {rel && <span>{rel}</span>}
          <span>{fmtTime(event.ts)}</span>
          <span className="text-text-dim/60">#{index + 1}</span>
        </div>
      </div>
      <div className="px-3 py-2.5 text-[12px] leading-[1.6]">
        <EventBody event={event} />
        {showRaw && (
          <details className="mt-2">
            <summary className="cursor-pointer text-[10px] text-text-dim hover:text-green uppercase tracking-[1px]">
              raw
            </summary>
            <pre className="mt-1 p-2 bg-bg-terminal border border-border-main rounded text-[10px] text-text-dim overflow-auto max-h-60">
              {JSON.stringify(event.raw, null, 2)}
            </pre>
          </details>
        )}
      </div>
    </li>
  );
}

function KindIcon({ kind }: { kind: NormalizedKind }) {
  const cls = "text-text-dim";
  switch (kind) {
    case "user":
      return <User size={12} className={cn(cls, "text-green")} />;
    case "assistant":
      return <Bot size={12} className={cls} />;
    case "tool_call":
      return <Wrench size={12} className={cn(cls, "text-[#58a6ff]")} />;
    case "tool_result":
      return <Terminal size={12} className={cls} />;
    case "file_write":
      return <FileEdit size={12} className={cn(cls, "text-[#58a6ff]")} />;
    case "todo":
      return <CircleCheck size={12} className={cls} />;
    default:
      return <MessageSquare size={12} className={cls} />;
  }
}

function EventBody({ event }: { event: NormalizedEvent }) {
  switch (event.kind) {
    case "user":
      return (
        <p className="text-text-primary whitespace-pre-wrap break-words">
          {event.text || <em className="text-text-dim">(empty)</em>}
        </p>
      );

    case "assistant":
      return <CollapsibleText text={event.text} muted />;

    case "tool_call":
      return <ToolCallBody event={event} />;

    case "tool_result":
      return <ToolResultBody event={event} />;

    case "file_write":
      return (
        <div className="font-mono text-[12px] text-text-primary">
          <span className="text-green">+</span>{" "}
          <span className="text-[#58a6ff]">{event.path}</span>
          {typeof event.bytes === "number" && (
            <span className="text-text-dim ml-2">({event.bytes} B)</span>
          )}
        </div>
      );

    case "todo":
      return <TodoBody todos={event.todos} />;

    default:
      return (
        <pre className="text-[11px] text-text-dim font-mono whitespace-pre-wrap break-words overflow-auto max-h-40">
          {JSON.stringify(event.raw, null, 2)}
        </pre>
      );
  }
}

function CollapsibleText({
  text,
  muted,
}: {
  text: string | undefined;
  muted?: boolean;
}) {
  const [expanded, setExpanded] = useState(false);
  if (!text) return <em className="text-text-dim">(empty)</em>;
  const long = text.length > 600;
  const display = expanded || !long ? text : text.slice(0, 600) + "…";
  return (
    <div>
      <p
        className={cn(
          "whitespace-pre-wrap break-words",
          muted ? "text-text-secondary" : "text-text-primary",
        )}
      >
        {display}
      </p>
      {long && (
        <button
          type="button"
          className="mt-1 text-[10px] uppercase tracking-[1px] text-green hover:text-green-dim flex items-center gap-1"
          onClick={() => setExpanded((v) => !v)}
        >
          {expanded ? (
            <>
              <ChevronDown size={10} /> collapse
            </>
          ) : (
            <>
              <ChevronRight size={10} /> show full ({text.length} chars)
            </>
          )}
        </button>
      )}
    </div>
  );
}

function ToolCallBody({ event }: { event: NormalizedEvent }) {
  const args = (event.args ?? {}) as any;
  const command = args.command ?? args.cmd;
  const path = args.path ?? args.file_path ?? args.filename;
  return (
    <div className="space-y-1">
      {command && (
        <div className="font-mono text-[12px] flex items-start gap-2">
          <span className="text-green shrink-0">$</span>
          <span className="text-text-primary break-all">{String(command)}</span>
        </div>
      )}
      {path && !command && (
        <div className="font-mono text-[11px]">
          <span className="text-text-dim">path: </span>
          <span className="text-[#58a6ff]">{String(path)}</span>
        </div>
      )}
      {!command && !path && (
        <pre className="text-[11px] text-text-dim font-mono whitespace-pre-wrap break-words overflow-auto max-h-32">
          {JSON.stringify(args, null, 2)}
        </pre>
      )}
    </div>
  );
}

function ToolResultBody({ event }: { event: NormalizedEvent }) {
  const failed = !!event.exitCode;
  if (!event.text) {
    return (
      <span className="text-text-dim text-[11px]">
        (no output{failed ? `, exit ${event.exitCode}` : ""})
      </span>
    );
  }
  const display =
    event.text.length > 800
      ? event.text.slice(0, 800) + "\n…[truncated]"
      : event.text;
  return (
    <div className="space-y-2">
      <pre
        className={cn(
          "text-[11px] font-mono whitespace-pre-wrap break-words overflow-auto max-h-60 p-2 rounded border",
          failed
            ? "bg-[rgba(217,119,6,0.06)] border-[rgba(217,119,6,0.3)] text-amber-warn"
            : "bg-bg-terminal border-border-main text-text-secondary",
        )}
      >
        {display}
      </pre>
      {failed && (
        <div className="flex items-center gap-1 text-[10px] uppercase tracking-[1px] text-amber-warn">
          <CircleAlert size={11} /> non-zero exit
          <RotateCcw size={10} className="ml-1" /> may trigger retry
        </div>
      )}
    </div>
  );
}

function TodoBody({
  todos,
}: {
  todos?: Array<{ content: string; status: string }>;
}) {
  if (!Array.isArray(todos) || todos.length === 0)
    return <span className="text-text-dim">(empty todo list)</span>;
  return (
    <ul className="space-y-0.5">
      {todos.map((t, i) => {
        const status = String(t?.status ?? "pending");
        const color =
          status === "completed"
            ? "text-green"
            : status === "in_progress"
              ? "text-[#58a6ff]"
              : status === "cancelled"
                ? "text-text-dim"
                : "text-text-secondary";
        const mark =
          status === "completed"
            ? "[x]"
            : status === "in_progress"
              ? "[~]"
              : status === "cancelled"
                ? "[-]"
                : "[ ]";
        return (
          <li key={i} className={cn("font-mono text-[12px]", color)}>
            <span className="opacity-60 mr-2">{mark}</span>
            {t?.content ?? "(empty)"}
          </li>
        );
      })}
    </ul>
  );
}
