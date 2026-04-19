import { useEffect, useMemo, useRef, useState } from "react";

interface PlaygroundRow {
  id: number;
  session_id: string;
  role: "user" | "assistant";
  content: string;
  ts: string;
  tokens_in: number | null;
  tokens_out: number | null;
  model: string | null;
}

interface TeamSharedPlayground {
  path: string;
  session_id: string;
  source: string;
  author_login: string | null;
  author_avatar: string | null;
  updated_at: string;
  messages: Array<{
    role: "user" | "assistant";
    content: string;
    ts: string;
    model: string | null;
    tokens_in: number | null;
    tokens_out: number | null;
  }>;
}

interface Props {
  sessionId: string;
  hasGemini: boolean;
  /** Local repo path (from judgment.repo); if null, Share-to-team is disabled. */
  repo: string | null;
}

const STARTERS = [
  "Summarize what went wrong in this session in 3 bullets.",
  "What's the one thing the user should change next time?",
  "What's the one thing the agent should change?",
  "Which tool calls were wasted and why?",
  "Write a 4-line block to paste into AGENTS.md to prevent this.",
];

export function PlaygroundPanel({ sessionId, hasGemini, repo }: Props): JSX.Element {
  const [messages, setMessages] = useState<PlaygroundRow[]>([]);
  const [input, setInput] = useState("");
  const [sending, setSending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [shareBusy, setShareBusy] = useState(false);
  const [shareStatus, setShareStatus] = useState<string | null>(null);
  const [shareUrl, setShareUrl] = useState<string | null>(null);
  const [teamPlaygrounds, setTeamPlaygrounds] = useState<TeamSharedPlayground[]>(
    [],
  );
  const scrollRef = useRef<HTMLDivElement>(null);

  // Load history whenever the selected session changes.
  useEffect(() => {
    let cancelled = false;
    void window.reflex.playgroundList(sessionId).then((rows) => {
      if (!cancelled) setMessages(rows);
    });
    return () => {
      cancelled = true;
    };
  }, [sessionId]);

  // Also pull teammates' shared playgrounds for this session when repo known.
  const loadTeamPlaygrounds = async (): Promise<void> => {
    if (!repo) return;
    try {
      const all = await window.reflex.teamFetchPlaygrounds(repo);
      setTeamPlaygrounds(all.filter((p) => p.session_id === sessionId));
    } catch {
      // silently ignore — network/perm errors shouldn't break the chat UX
    }
  };
  useEffect(() => {
    void loadTeamPlaygrounds();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [sessionId, repo]);

  // Auto-scroll to the bottom when a new message arrives.
  useEffect(() => {
    if (!scrollRef.current) return;
    scrollRef.current.scrollTop = scrollRef.current.scrollHeight;
  }, [messages.length, sending]);

  const tokenTotal = useMemo(() => {
    let inT = 0;
    let outT = 0;
    for (const m of messages) {
      inT += m.tokens_in ?? 0;
      outT += m.tokens_out ?? 0;
    }
    return { inT, outT };
  }, [messages]);

  const send = async (text: string): Promise<void> => {
    const t = text.trim();
    if (!t) return;
    setError(null);
    setSending(true);

    // Optimistically append the user message; the backend will persist
    // both sides but we don't want the input to feel sluggish.
    const optimistic: PlaygroundRow = {
      id: -Date.now(),
      session_id: sessionId,
      role: "user",
      content: t,
      ts: new Date().toISOString(),
      tokens_in: null,
      tokens_out: null,
      model: null,
    };
    setMessages((prev) => [...prev, optimistic]);
    setInput("");

    try {
      await window.reflex.playgroundSend(sessionId, t);
      // Re-read from DB so optimistic + canonical order line up.
      const rows = await window.reflex.playgroundList(sessionId);
      setMessages(rows);
    } catch (e) {
      setError((e as Error).message);
      // Roll back the optimistic entry and restore the input so the user can retry.
      setMessages((prev) => prev.filter((m) => m.id !== optimistic.id));
      setInput(t);
    } finally {
      setSending(false);
    }
  };

  const clear = async (): Promise<void> => {
    if (!confirm("Clear the playground for this session?")) return;
    await window.reflex.playgroundClear(sessionId);
    setMessages([]);
  };

  const shareToTeam = async (): Promise<void> => {
    if (messages.length === 0) return;
    setShareBusy(true);
    setShareStatus(null);
    setShareUrl(null);
    try {
      const res = await window.reflex.teamSharePlayground(
        sessionId,
        repo ?? undefined,
      );
      setShareStatus(`committed ${res.committed_path}`);
      setShareUrl(res.html_url);
      // Re-pull teammates' list so our own push shows up too.
      void loadTeamPlaygrounds();
    } catch (e) {
      setShareStatus(`failed: ${(e as Error).message}`);
    } finally {
      setShareBusy(false);
    }
  };

  return (
    <section className="border-b border-slate-800 bg-slate-900/40">
      <div className="flex items-center gap-2 border-b border-slate-800 px-4 py-2">
        <span className="inline-block rounded bg-indigo-950 px-1.5 text-[10px] font-semibold uppercase tracking-wide text-indigo-300">
          Playground
        </span>
        <span className="text-[11px] text-slate-500">
          Chat with Gemini about this session. Ask why, what-if, or how to fix.
        </span>
        {messages.length > 0 && (
          <span className="ml-auto text-[10px] text-slate-600">
            {messages.length} messages · {tokenTotal.inT + tokenTotal.outT} tokens
          </span>
        )}
        {messages.length > 0 && (
          <button
            onClick={() => void clear()}
            className="shrink-0 rounded border border-slate-700 px-1.5 py-0.5 text-[10px] text-slate-400 hover:bg-slate-800"
            title="Clear chat history for this session"
          >
            clear
          </button>
        )}
      </div>

      {!hasGemini && (
        <div className="px-4 py-2 text-[11px] text-slate-500">
          Set a Gemini key in Settings to enable the playground.
        </div>
      )}

      {hasGemini && (
        <>
          <div
            ref={scrollRef}
            className="max-h-[280px] min-h-[80px] overflow-y-auto px-4 py-2 text-xs"
          >
            {messages.length === 0 ? (
              <div className="space-y-2 text-[11px] text-slate-500">
                <div>
                  No messages yet. Try one of these, or ask your own question:
                </div>
                <div className="flex flex-wrap gap-1">
                  {STARTERS.map((s) => (
                    <button
                      key={s}
                      onClick={() => void send(s)}
                      disabled={sending}
                      className="rounded border border-slate-700 bg-slate-900/60 px-2 py-0.5 text-[11px] text-slate-300 hover:bg-slate-800 disabled:opacity-50"
                    >
                      {s}
                    </button>
                  ))}
                </div>
              </div>
            ) : (
              <div className="space-y-2">
                {messages.map((m) => (
                  <MessageRow key={m.id} m={m} />
                ))}
                {sending && (
                  <div className="flex items-start gap-2 text-slate-500">
                    <RoleTag role="assistant" />
                    <span className="animate-pulse">thinking…</span>
                  </div>
                )}
              </div>
            )}
          </div>

          {error && (
            <div className="px-4 py-1 text-[11px] text-rose-300">
              error: {error}
            </div>
          )}

          <div className="flex items-center gap-2 border-t border-slate-800 px-4 py-2">
            <input
              value={input}
              onChange={(e) => setInput(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter" && !e.shiftKey) {
                  e.preventDefault();
                  void send(input);
                }
              }}
              placeholder="Ask about this session…"
              disabled={sending}
              className="min-w-0 flex-1 rounded border border-slate-700 bg-slate-900 px-2 py-1 text-xs text-slate-200 focus:border-indigo-500 focus:outline-none disabled:opacity-50"
            />
            <button
              onClick={() => void send(input)}
              disabled={sending || !input.trim()}
              className="shrink-0 rounded bg-indigo-700 px-3 py-1 text-xs font-medium text-white hover:bg-indigo-600 disabled:opacity-50"
            >
              {sending ? "sending…" : "Send"}
            </button>
          </div>
          {messages.length > 0 && (
            <div className="flex items-center gap-2 border-t border-slate-800 bg-slate-900/30 px-4 py-1.5">
              <button
                onClick={() => void shareToTeam()}
                disabled={shareBusy || !repo}
                className="rounded border border-cyan-700 bg-cyan-950/40 px-2 py-0.5 text-[11px] text-cyan-200 hover:bg-cyan-900/50 disabled:opacity-50"
                title={
                  repo
                    ? "Commit this playground conversation to .reflex/playgrounds/ in the repo so teammates can read it"
                    : "No repo inferred — judge this session first"
                }
              >
                {shareBusy ? "sharing…" : "Share playground to team"}
              </button>
              {shareStatus && (
                <span className="truncate text-[10px] text-slate-400">
                  {shareStatus}
                </span>
              )}
              {shareUrl && (
                <a
                  href={shareUrl}
                  onClick={(e) => {
                    e.preventDefault();
                    window.open(shareUrl, "_blank", "noopener");
                  }}
                  className="ml-auto text-[11px] text-emerald-300 hover:underline"
                >
                  open commit ↗
                </a>
              )}
            </div>
          )}

          {teamPlaygrounds.length > 0 && (
            <div className="border-t border-slate-800 bg-slate-900/40 px-4 py-2">
              <div className="mb-1 text-[10px] font-semibold uppercase tracking-wide text-cyan-300">
                Teammates' explorations of this session ({teamPlaygrounds.length})
              </div>
              <ul className="space-y-1">
                {teamPlaygrounds.map((p) => (
                  <TeamPlaygroundRow key={p.path} p={p} />
                ))}
              </ul>
            </div>
          )}
        </>
      )}
    </section>
  );
}

function TeamPlaygroundRow({ p }: { p: TeamSharedPlayground }): JSX.Element {
  const [open, setOpen] = useState(false);
  return (
    <li className="rounded border border-slate-800 bg-slate-900/30">
      <button
        onClick={() => setOpen((v) => !v)}
        className="flex w-full items-center gap-2 px-2 py-1 text-left text-[11px] hover:bg-slate-800/40"
      >
        {p.author_avatar ? (
          <img
            src={p.author_avatar}
            alt={p.author_login ?? "?"}
            className="h-4 w-4 rounded-full border border-slate-800"
          />
        ) : (
          <span className="inline-block h-4 w-4 rounded-full bg-slate-800 text-center text-[9px] leading-4 text-slate-300">
            {(p.author_login ?? "?").slice(0, 1).toUpperCase()}
          </span>
        )}
        <span className="font-medium text-slate-200">
          @{p.author_login ?? "unknown"}
        </span>
        <span className="text-slate-500">{p.messages.length} messages</span>
        <span className="ml-auto shrink-0 text-slate-600">
          {p.updated_at.slice(0, 16).replace("T", " ")}
        </span>
        <span className="text-slate-500">{open ? "▾" : "▸"}</span>
      </button>
      {open && (
        <div className="border-t border-slate-800 px-3 py-2">
          <ol className="space-y-1.5 text-[11px]">
            {p.messages.map((m, i) => (
              <li key={i} className="flex items-start gap-1.5">
                <span
                  className={`mt-0.5 shrink-0 rounded px-1 text-[9px] font-semibold uppercase ${
                    m.role === "user"
                      ? "bg-sky-950 text-sky-300"
                      : "bg-indigo-950 text-indigo-300"
                  }`}
                >
                  {m.role === "user" ? "you" : "AI"}
                </span>
                <pre className="selectable min-w-0 flex-1 whitespace-pre-wrap break-words text-[11px] text-slate-300">
                  {m.content.length > 1200
                    ? m.content.slice(0, 1200) + "…"
                    : m.content}
                </pre>
              </li>
            ))}
          </ol>
        </div>
      )}
    </li>
  );
}

function MessageRow({ m }: { m: PlaygroundRow }): JSX.Element {
  const isUser = m.role === "user";
  return (
    <div className="flex items-start gap-2">
      <RoleTag role={m.role} />
      <div className="min-w-0 flex-1">
        <pre
          className={`selectable whitespace-pre-wrap break-words text-xs leading-relaxed ${
            isUser ? "text-slate-200" : "text-slate-300"
          }`}
        >
          {m.content}
        </pre>
        {m.role === "assistant" && (m.tokens_in || m.tokens_out) ? (
          <div className="mt-0.5 text-[10px] text-slate-600">
            {m.model ?? ""} · {m.tokens_in ?? 0}+{m.tokens_out ?? 0} tokens
          </div>
        ) : null}
      </div>
    </div>
  );
}

function RoleTag({ role }: { role: "user" | "assistant" }): JSX.Element {
  const color =
    role === "user" ? "bg-sky-950 text-sky-300" : "bg-indigo-950 text-indigo-300";
  return (
    <span
      className={`mt-0.5 shrink-0 rounded px-1.5 py-0.5 text-[9px] font-semibold uppercase tracking-wide ${color}`}
    >
      {role === "user" ? "you" : "AI"}
    </span>
  );
}
