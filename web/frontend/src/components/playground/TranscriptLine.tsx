import type { TranscriptEvent } from "@/data/playground-scenarios";

/**
 * Renders a single normalized transcript line with gutter glyph + colour.
 * `highlight` gives it a red glow used when the line's signal pill is hovered.
 */
export function TranscriptLine({
  event,
  highlight,
}: {
  event: TranscriptEvent;
  highlight?: boolean;
}) {
  if (event.kind === "blank") {
    return <div className="h-3" aria-hidden="true" />;
  }

  const base =
    "block font-mono text-[12.5px] md:text-[13px] leading-[1.75] transition-all duration-200";

  if (event.kind === "system") {
    return (
      <span
        className={`${base} text-[#febc2e] font-semibold`}
        data-event-id={event.id}
      >
        {event.text}
      </span>
    );
  }

  if (event.kind === "agent") {
    return (
      <span className={`${base} text-text-primary`} data-event-id={event.id}>
        <span className="text-[#58a6ff]">agent: </span>
        <span>{event.text}</span>
      </span>
    );
  }

  if (event.kind === "you") {
    return (
      <span
        className={`${base} pl-3 border-l-2 ${
          highlight
            ? "border-red-correction bg-[rgba(185,28,28,0.16)] shadow-[inset_0_0_24px_rgba(185,28,28,0.18)]"
            : "border-red-correction/70"
        } text-red-correction`}
        data-event-id={event.id}
      >
        <span className="text-text-dim">you: </span>
        {event.text}
      </span>
    );
  }

  if (event.kind === "tool_call") {
    return (
      <span className={`${base} text-text-primary`} data-event-id={event.id}>
        <span className="text-green">$ </span>
        {event.text.replace(/^\$\s*/, "")}
      </span>
    );
  }

  if (event.kind === "tool_result_ok") {
    return (
      <span className={`${base} text-text-secondary`} data-event-id={event.id}>
        <span className="text-green">✓ </span>
        {event.text.replace(/^✓\s*/, "")}
      </span>
    );
  }

  if (event.kind === "tool_result_err") {
    return (
      <span
        className={`${base} ${
          highlight
            ? "text-red-correction bg-[rgba(185,28,28,0.14)]"
            : "text-red-correction"
        }`}
        data-event-id={event.id}
      >
        <span>✗ </span>
        {event.text.replace(/^✗\s*/, "")}
      </span>
    );
  }

  if (event.kind === "diff_header") {
    return (
      <span
        className={`${base} text-[#febc2e]`}
        data-event-id={event.id}
      >
        {event.text}
      </span>
    );
  }

  if (event.kind === "diff_add") {
    return (
      <span
        className={`${base} text-green`}
        data-event-id={event.id}
      >
        <span>+ </span>
        {event.text}
      </span>
    );
  }

  if (event.kind === "diff_remove") {
    return (
      <span
        className={`${base} text-red-correction`}
        data-event-id={event.id}
      >
        <span>- </span>
        {event.text}
      </span>
    );
  }

  return null;
}
