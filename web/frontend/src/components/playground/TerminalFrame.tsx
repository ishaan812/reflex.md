import type { ReactNode } from "react";

/**
 * macOS-style terminal chrome. Matches the landing page TerminalDemo look.
 */
export function TerminalFrame({
  title,
  children,
  onMouseEnter,
  onMouseLeave,
  ariaLabel,
  className = "",
}: {
  title: string;
  children: ReactNode;
  onMouseEnter?: () => void;
  onMouseLeave?: () => void;
  ariaLabel?: string;
  className?: string;
}) {
  return (
    <figure
      onMouseEnter={onMouseEnter}
      onMouseLeave={onMouseLeave}
      className={`w-full bg-bg-terminal border border-border-main rounded-lg overflow-hidden shadow-[0_20px_60px_rgba(0,0,0,0.45)] ${className}`}
      role="img"
      aria-label={ariaLabel ?? title}
    >
      <div
        className="flex items-center gap-2 py-3 px-4 bg-[#161b22] border-b border-border-main"
        aria-hidden="true"
      >
        <span className="w-3 h-3 rounded-full bg-[#ff5f57]" />
        <span className="w-3 h-3 rounded-full bg-[#febc2e]" />
        <span className="w-3 h-3 rounded-full bg-[#28c840]" />
        <span className="flex-1 text-center text-xs text-text-dim font-mono">
          {title}
        </span>
      </div>
      {children}
    </figure>
  );
}
