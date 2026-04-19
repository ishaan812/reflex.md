// Per-session playground: interactive chat with Gemini, seeded with the
// session's transcript. Lets the user explore "why did this happen? what
// should I have done?" without leaving Reflex.

import type { Turn } from "@shared/turn";
import { loadConfig } from "./config";

const GEMINI_ENDPOINT =
  "https://generativelanguage.googleapis.com/v1beta/models";

/** We cap the transcript slice sent as context so we stay below token budget
 *  on the free tier. Later messages in a long conversation lose early turns. */
const MAX_TRANSCRIPT_CHARS = 24_000;

export interface PlaygroundMessage {
  role: "user" | "assistant" | "system";
  content: string;
  ts?: string;
}

export interface PlaygroundReply {
  reply: string;
  tokens_prompt?: number;
  tokens_completion?: number;
  model: string;
}

export async function chatInPlayground(args: {
  /** The session the user is exploring. */
  turns: Turn[];
  /** Prior chat messages (user + assistant, no system). */
  history: PlaygroundMessage[];
  /** The new user message to send. */
  userMessage: string;
  /** Optional override. */
  model?: string;
}): Promise<PlaygroundReply> {
  const cfg = loadConfig();
  if (!cfg.gemini_api_key) {
    throw new Error(
      "no gemini_api_key — set it in Settings to use the Playground",
    );
  }
  const model = args.model ?? cfg.gemini_model ?? "gemini-2.5-flash";

  const transcript = buildTranscript(args.turns);
  const systemPrompt = [
    "You are a session analyst embedded inside Reflex, a tool that captures AI-agent coding sessions.",
    "A developer is asking you questions about one specific session's transcript (shown below).",
    "Rules:",
    "- Be specific. Cite turn indices, tool names, file paths, or phrases from the transcript whenever possible.",
    "- If the user asks 'what should I do instead,' give a concrete alternative, not hedging.",
    "- Keep answers short (under 200 words) unless the user explicitly asks for depth.",
    "- You cannot run tools or modify files. You only reason about the transcript.",
    "- If the transcript doesn't contain enough info to answer, say so plainly.",
    "",
    "=== SESSION TRANSCRIPT ===",
    transcript,
    "=== END TRANSCRIPT ===",
  ].join("\n");

  // Gemini doesn't have a formal system role; we prepend as a `user` turn
  // with explicit framing, then feed the real history.
  const contents: Array<{
    role: "user" | "model";
    parts: Array<{ text: string }>;
  }> = [];

  // Seed the conversation with the system + a placeholder acknowledgment.
  contents.push({ role: "user", parts: [{ text: systemPrompt }] });
  contents.push({
    role: "model",
    parts: [{ text: "Got it. I've read the session. Ask me anything about it." }],
  });

  // Append the chat history so far.
  for (const m of args.history) {
    if (m.role === "system") continue;
    contents.push({
      role: m.role === "assistant" ? "model" : "user",
      parts: [{ text: m.content }],
    });
  }
  // Finally the new user message.
  contents.push({ role: "user", parts: [{ text: args.userMessage }] });

  const url = `${GEMINI_ENDPOINT}/${encodeURIComponent(model)}:generateContent?key=${encodeURIComponent(cfg.gemini_api_key)}`;
  const res = await fetch(url, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({
      contents,
      generationConfig: { temperature: 0.3 },
    }),
  });
  if (!res.ok) {
    const msg = await res.text().catch(() => "");
    throw new Error(
      `gemini failed: ${res.status} ${res.statusText} — ${msg.slice(0, 400)}`,
    );
  }
  const data = (await res.json()) as {
    candidates?: Array<{ content?: { parts?: Array<{ text?: string }> } }>;
    usageMetadata?: {
      promptTokenCount?: number;
      candidatesTokenCount?: number;
    };
  };
  const reply =
    data.candidates?.[0]?.content?.parts?.map((p) => p.text).join("") ?? "";
  if (!reply) {
    throw new Error("empty response from gemini");
  }
  return {
    reply,
    tokens_prompt: data.usageMetadata?.promptTokenCount,
    tokens_completion: data.usageMetadata?.candidatesTokenCount,
    model,
  };
}

// ---------- Helpers ----------

function buildTranscript(turns: Turn[]): string {
  const lines: string[] = [];
  let used = 0;
  // Number the turns so the user + model can reference "turn 12".
  for (let i = 0; i < turns.length; i++) {
    const line = renderTurn(i, turns[i]);
    if (used + line.length > MAX_TRANSCRIPT_CHARS) {
      lines.push(`[…${turns.length - i} more turns truncated for context budget]`);
      break;
    }
    lines.push(line);
    used += line.length + 1;
  }
  return lines.join("\n");
}

function renderTurn(i: number, t: Turn): string {
  const head = `#${i} [${t.kind}|${t.role ?? "?"}${t.model ? `|${t.model}` : ""}]`;
  if (t.kind === "tool_call" && t.tool) {
    const args = shortJson(t.tool.args);
    const status = t.tool.errored ? " ERROR" : "";
    return `${head} tool=${t.tool.name}${status} args=${args}`;
  }
  if (t.kind === "tool_result" && t.tool) {
    const status = t.tool.errored ? "ERROR" : "ok";
    const preview = t.text.slice(0, 500).replace(/\s+/g, " ");
    return `${head} tool=${t.tool.name} status=${status} output=${preview}`;
  }
  const body = t.text.slice(0, 2500).replace(/\r/g, "");
  return `${head} ${body}`;
}

function shortJson(v: unknown): string {
  try {
    const s = typeof v === "string" ? v : JSON.stringify(v);
    return s.length > 300 ? s.slice(0, 300) + "…" : s;
  } catch {
    return String(v);
  }
}
