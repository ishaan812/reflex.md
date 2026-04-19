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
  Loader2,
  MessageSquare,
  RotateCcw,
  Sparkles,
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
import { api, type SessionDetail } from "@/api";

const NEGATION_RE =
  /\b(no|don'?t|stop|wait|revert|that'?s wrong|not (?:that|like)|instead|actually|undo|rollback)\b/i;

type EventKind =
  | "user_prompt"
  | "agent_response"
  | "tool_call"
  | "tool_result"
  | "file_write"
  | "subagent_spawn"
  | "todo_write"
  | "unknown";

const KIND_LABEL: Record<EventKind, string> = {
  user_prompt: "User",
  agent_response: "Agent",
  tool_call: "Tool",
  tool_result: "Result",
  file_write: "File",
  subagent_spawn: "Subagent",
  todo_write: "Todos",
  unknown: "Other",
};

const FILTERS: Array<{ key: "all" | EventKind; label: string }> = [
  { key: "all", label: "All" },
  { key: "user_prompt", label: "Prompts" },
  { key: "agent_response", label: "Replies" },
  { key: "tool_call", label: "Tools" },
  { key: "file_write", label: "Files" },
];

function classifyEvent(e: any): EventKind {
  const t = e?.type;
  if (
    t === "user_prompt" ||
    t === "agent_response" ||
    t === "tool_call" ||
    t === "tool_result" ||
    t === "file_write" ||
    t === "subagent_spawn" ||
    t === "todo_write"
  )
    return t;
  return "unknown";
}

function isCorrection(e: any) {
  return (
    e?.type === "user_prompt" &&
    typeof e.text === "string" &&
    NEGATION_RE.test(e.text)
  );
}

function isToolFailure(e: any) {
  return (
    e?.type === "tool_call" &&
    typeof e.exit_code === "number" &&
    e.exit_code !== 0
  );
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
        {q.isLoading && <SheetLoadingState />}
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

function SheetLoadingState() {
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
  const [filter, setFilter] = useState<"all" | EventKind>("all");
  const [showRaw, setShowRaw] = useState(false);

  const events = (session.events ?? []) as any[];
  const stats = useMemo(() => {
    const counts: Record<string, number> = {};
    let corrections = 0;
    let failures = 0;
    for (const e of events) {
      const k = classifyEvent(e);
      counts[k] = (counts[k] ?? 0) + 1;
      if (isCorrection(e)) corrections++;
      if (isToolFailure(e)) failures++;
    }
    return { counts, corrections, failures, total: events.length };
  }, [events]);

  const filtered = useMemo(() => {
    if (filter === "all") return events;
    return events.filter((e) => classifyEvent(e) === filter);
  }, [events, filter]);

  const fq = session.frictionScore;
  const fqVariant = fq < 0.3 ? "green" : fq < 0.8 ? "amber" : "red";
  const dur =
    session.endedAt != null
      ? Math.round(
          (new Date(session.endedAt).getTime() -
            new Date(session.startedAt).getTime()) /
            1000,
        )
      : null;

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
              <Badge variant="outline">{session.strategy}</Badge>
              {session.branch && (
                <Badge variant="muted">↳ {session.branch}</Badge>
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
            {dur != null && (
              <span className="text-text-dim">
                {" "}
                · {dur < 60 ? `${dur}s` : `${Math.round(dur / 60)}m`}
              </span>
            )}
          </div>
          <div>
            <span className="text-text-dim">events: </span>
            {stats.total}
          </div>
          <div>
            <span className="text-text-dim">files: </span>
            {session.filesTouched.length}
          </div>
          <div>
            <span className="text-text-dim">tokens: </span>
            {((session.tokenUsage as any)?.input_tokens ?? 0) +
              ((session.tokenUsage as any)?.output_tokens ?? 0) || "—"}
          </div>
        </div>
      </SheetHeader>

      {/* Filter bar */}
      <div className="flex items-center justify-between gap-2 px-5 py-3 border-b border-border-main bg-bg-secondary">
        <div className="flex items-center gap-1 flex-wrap">
          <Filter size={12} className="text-text-dim mr-1" />
          {FILTERS.map((f) => {
            const count =
              f.key === "all" ? stats.total : stats.counts[f.key] ?? 0;
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
              prevTs={
                i > 0
                  ? filtered[i - 1]?.ts ?? filtered[i - 1]?.timestamp
                  : undefined
              }
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
  event: any;
  prevTs?: string;
  showRaw: boolean;
  index: number;
}) {
  const kind = classifyEvent(event);
  const ts = event.ts ?? event.timestamp;
  const rel = fmtRelative(prevTs, ts);
  const correction = isCorrection(event);
  const failure = isToolFailure(event);

  const accent = correction
    ? "border-l-red-correction"
    : failure
      ? "border-l-amber-warn"
      : kind === "user_prompt"
        ? "border-l-green"
        : kind === "agent_response"
          ? "border-l-text-dim"
          : kind === "tool_call"
            ? "border-l-[#58a6ff]"
            : "border-l-border-main";

  return (
    <li
      className={cn(
        "border border-border-main rounded-[4px] bg-bg-card overflow-hidden",
        "border-l-2",
        accent,
      )}
    >
      <div className="flex items-center justify-between gap-3 px-3 py-2 bg-[rgba(255,255,255,0.015)]">
        <div className="flex items-center gap-2 min-w-0">
          <KindIcon kind={kind} />
          <span className="text-[10px] uppercase tracking-[2px] text-text-dim font-mono">
            {KIND_LABEL[kind]}
          </span>
          {kind === "tool_call" && event.tool_name && (
            <span className="font-mono text-[11px] text-[#58a6ff] truncate">
              {event.tool_name}
            </span>
          )}
          {correction && <Badge variant="red">correction</Badge>}
          {failure && <Badge variant="amber">exit {event.exit_code}</Badge>}
        </div>
        <div className="flex items-center gap-2 text-[10px] font-mono text-text-dim shrink-0">
          {rel && <span>{rel}</span>}
          <span>{fmtTime(ts)}</span>
          <span className="text-text-dim/60">#{index + 1}</span>
        </div>
      </div>
      <div className="px-3 py-2.5 text-[12px] leading-[1.6]">
        <EventBody event={event} kind={kind} />
        {showRaw && (
          <details className="mt-2">
            <summary className="cursor-pointer text-[10px] text-text-dim hover:text-green uppercase tracking-[1px]">
              raw
            </summary>
            <pre className="mt-1 p-2 bg-bg-terminal border border-border-main rounded text-[10px] text-text-dim overflow-auto max-h-60">
              {JSON.stringify(event, null, 2)}
            </pre>
          </details>
        )}
      </div>
    </li>
  );
}

function KindIcon({ kind }: { kind: EventKind }) {
  const cls = "text-text-dim";
  switch (kind) {
    case "user_prompt":
      return <User size={12} className={cn(cls, "text-green")} />;
    case "agent_response":
      return <Bot size={12} className={cls} />;
    case "tool_call":
      return <Wrench size={12} className={cn(cls, "text-[#58a6ff]")} />;
    case "tool_result":
      return <Terminal size={12} className={cls} />;
    case "file_write":
      return <FileEdit size={12} className={cls} />;
    case "subagent_spawn":
      return <Sparkles size={12} className={cls} />;
    case "todo_write":
      return <CircleCheck size={12} className={cls} />;
    default:
      return <MessageSquare size={12} className={cls} />;
  }
}

function EventBody({ event, kind }: { event: any; kind: EventKind }) {
  switch (kind) {
    case "user_prompt":
      return (
        <p className="text-text-primary whitespace-pre-wrap break-words">
          {event.text || <em className="text-text-dim">(empty)</em>}
        </p>
      );

    case "agent_response":
      return <AgentResponseBody text={event.text} />;

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

    case "subagent_spawn":
      return (
        <div className="text-text-secondary">
          spawned subagent{" "}
          <span className="font-mono text-green">{event.child_id}</span>
          {event.purpose && (
            <span className="text-text-dim"> — {event.purpose}</span>
          )}
        </div>
      );

    case "todo_write":
      return <TodoBody todos={event.todos} />;

    default:
      return (
        <pre className="text-[11px] text-text-dim font-mono whitespace-pre-wrap break-words overflow-auto max-h-40">
          {JSON.stringify(event, null, 2)}
        </pre>
      );
  }
}

function AgentResponseBody({ text }: { text: string }) {
  const [expanded, setExpanded] = useState(false);
  if (!text) return <em className="text-text-dim">(empty)</em>;
  const long = text.length > 600;
  const display = expanded || !long ? text : text.slice(0, 600) + "…";
  return (
    <div>
      <p className="text-text-secondary whitespace-pre-wrap break-words">
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

function ToolCallBody({ event }: { event: any }) {
  const args = event.args ?? {};
  const command = args.command ?? args.cmd;
  const path = args.path ?? args.file_path ?? args.filename;
  const failed =
    typeof event.exit_code === "number" && event.exit_code !== 0;
  return (
    <div className="space-y-1">
      {command && (
        <div className="font-mono text-[12px] flex items-start gap-2">
          <span className="text-green shrink-0">$</span>
          <span className="text-text-primary break-all">{command}</span>
        </div>
      )}
      {path && (
        <div className="font-mono text-[11px]">
          <span className="text-text-dim">path: </span>
          <span className="text-[#58a6ff]">{path}</span>
        </div>
      )}
      {!command && !path && (
        <pre className="text-[11px] text-text-dim font-mono whitespace-pre-wrap break-words overflow-auto max-h-32">
          {JSON.stringify(args, null, 2)}
        </pre>
      )}
      {failed && (
        <div className="flex items-center gap-1 text-[10px] uppercase tracking-[1px] text-amber-warn">
          <CircleAlert size={11} /> exit {event.exit_code}{" "}
          <RotateCcw size={10} className="ml-1" /> may trigger retry
        </div>
      )}
    </div>
  );
}

function ToolResultBody({ event }: { event: any }) {
  const out = event.output ?? "";
  const failed =
    typeof event.exit_code === "number" && event.exit_code !== 0;
  if (!out) {
    return (
      <span className="text-text-dim text-[11px]">
        (no output{failed ? `, exit ${event.exit_code}` : ""})
      </span>
    );
  }
  const trimmed =
    typeof out === "string" ? out : JSON.stringify(out, null, 2);
  const display =
    trimmed.length > 800 ? trimmed.slice(0, 800) + "\n…[truncated]" : trimmed;
  return (
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
  );
}

function TodoBody({ todos }: { todos?: any[] }) {
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
            {t?.content ?? JSON.stringify(t)}
          </li>
        );
      })}
    </ul>
  );
}

export function _ignore() {
  // keep Loader2 in the import graph if we ever need it
  return Loader2;
}
