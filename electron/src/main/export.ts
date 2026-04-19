// Export session ratings to a single Markdown file that agents can read
// on startup. Per design: `~/.reflex/mistakes.md`.

import type { SessionRating } from "@shared/turn";

export function exportMistakesMd(ratings: SessionRating[]): string {
  const now = new Date().toISOString();

  const sections: string[] = [];
  sections.push(`# Reflex · Cross-session mistakes & patterns`);
  sections.push(
    `*Generated ${now}. Read this at the start of any coding session — it's a distilled record of what has gone wrong across prior AI-agent runs.*`,
  );
  sections.push("");

  // --- Headline stats -------------------------------------------------
  const ranked = [...ratings].sort((a, b) => a.score - b.score);
  const worst = ranked.slice(0, 5);
  const best = [...ratings].sort((a, b) => b.score - a.score).slice(0, 5);
  const totalSessions = ratings.length;
  const avgScore = totalSessions
    ? Math.round(
        ratings.reduce((sum, r) => sum + r.score, 0) / totalSessions,
      )
    : 0;
  const totalMistakes = ratings.reduce((s, r) => s + r.mistakes.length, 0);
  const totalRetries = ratings.reduce((s, r) => s + r.retries.length, 0);
  const totalCorrections = ratings.reduce(
    (s, r) => s + r.corrections.length,
    0,
  );

  sections.push(`## At a glance`);
  sections.push("");
  sections.push(`- **${totalSessions}** sessions evaluated`);
  sections.push(`- **${avgScore}/100** average quality score`);
  sections.push(
    `- **${totalMistakes}** tool-call errors, **${totalRetries}** retry clusters, **${totalCorrections}** user corrections`,
  );
  sections.push("");

  // --- Recurring failure patterns -----------------------------------
  const errByTool = new Map<string, { count: number; samples: string[] }>();
  for (const r of ratings) {
    for (const m of r.mistakes) {
      const e = errByTool.get(m.tool_name) ?? { count: 0, samples: [] };
      e.count++;
      if (e.samples.length < 3) e.samples.push(m.error);
      errByTool.set(m.tool_name, e);
    }
  }
  const rankedTools = [...errByTool.entries()].sort(
    (a, b) => b[1].count - a[1].count,
  );
  if (rankedTools.length) {
    sections.push(`## Recurring tool failures (across sessions)`);
    sections.push("");
    for (const [name, info] of rankedTools.slice(0, 10)) {
      sections.push(`### \`${name}\` — ${info.count} failure(s)`);
      for (const s of info.samples) {
        sections.push(`- ${oneLine(s)}`);
      }
      sections.push("");
    }
  }

  // --- Worst / best sessions ---------------------------------------
  if (worst.length) {
    sections.push(`## Worst-rated sessions`);
    sections.push("");
    for (const r of worst) {
      sections.push(sessionSummary(r));
    }
    sections.push("");
  }
  if (best.length) {
    sections.push(`## Best-rated sessions`);
    sections.push("");
    for (const r of best) {
      sections.push(sessionSummary(r));
    }
    sections.push("");
  }

  // --- Agent-readable advice block ---------------------------------
  sections.push(`## Advice to agents`);
  sections.push("");
  const advice = deriveAdvice(ratings);
  if (advice.length === 0) {
    sections.push(`- (nothing yet — collect more sessions to detect patterns)`);
  } else {
    for (const a of advice) sections.push(`- ${a}`);
  }

  return sections.join("\n") + "\n";
}

function sessionSummary(r: SessionRating): string {
  const ts = new Date(r.evaluated_at).toISOString().slice(0, 16).replace("T", " ");
  const parts: string[] = [];
  parts.push(
    `- **${r.source}/${r.session_id.slice(0, 12)}…** · score ${r.score}/100 · ${r.turn_count} turns · ${r.tool_error_count}/${r.tool_call_count} tool errors · ${ts}`,
  );
  if (r.mistakes.length) {
    parts.push(
      `    - mistakes: ${r.mistakes
        .slice(0, 3)
        .map((m) => `\`${m.tool_name}\`(${oneLine(m.error, 80)})`)
        .join(", ")}`,
    );
  }
  if (r.retries.length) {
    parts.push(
      `    - retries: ${r.retries
        .slice(0, 3)
        .map((x) => `\`${x.tool_name}\`×${x.indices.length}${x.resolved ? "→ok" : ""}`)
        .join(", ")}`,
    );
  }
  return parts.join("\n");
}

function deriveAdvice(ratings: SessionRating[]): string[] {
  const out: string[] = [];

  // Tools that fail > 50% of the time across all sessions:
  const calls = new Map<string, { ok: number; err: number }>();
  for (const r of ratings) {
    for (const m of r.mistakes) {
      const c = calls.get(m.tool_name) ?? { ok: 0, err: 0 };
      c.err++;
      calls.set(m.tool_name, c);
    }
  }
  for (const [name, c] of calls) {
    if (c.err >= 3) {
      out.push(
        `When using \`${name}\`, double-check arguments — it has errored ${c.err} times across past sessions.`,
      );
    }
  }

  // Retry clusters → "arguments need to be validated before retrying"
  const retryTools = new Map<string, number>();
  for (const r of ratings) {
    for (const rc of r.retries) {
      retryTools.set(rc.tool_name, (retryTools.get(rc.tool_name) ?? 0) + 1);
    }
  }
  for (const [name, n] of retryTools) {
    if (n >= 3) {
      out.push(
        `Avoid retrying \`${name}\` with similar arguments — it's been retried ${n} times in clusters. Change approach instead.`,
      );
    }
  }

  // Reversal-prone files
  const reverseFiles = new Map<string, number>();
  for (const r of ratings) {
    for (const rv of r.reversals) {
      reverseFiles.set(rv.file_path, (reverseFiles.get(rv.file_path) ?? 0) + 1);
    }
  }
  for (const [f, n] of reverseFiles) {
    if (n >= 2) {
      out.push(
        `\`${f}\` has been edited and reverted ${n} times. Plan changes before writing.`,
      );
    }
  }

  return out;
}

function oneLine(s: string, max = 200): string {
  const t = s.replace(/\s+/g, " ").trim();
  return t.length > max ? t.slice(0, max) + "…" : t;
}
