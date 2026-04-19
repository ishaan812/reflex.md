import { Link } from "react-router-dom";
import { Github, LogOut } from "lucide-react";
import { Button } from "@/components/ui/button";
import { api } from "@/api";

export function DashboardNav({ login }: { login: string | null }) {
  return (
    <nav className="sticky top-0 inset-x-0 z-50 flex items-center justify-between px-5 md:px-10 h-14 bg-[rgba(10,10,10,0.85)] backdrop-blur-[12px] border-b border-border-main">
      <Link
        to="/"
        className="font-mono text-base font-bold text-green no-underline flex items-center gap-1 tracking-[-0.5px]"
      >
        <span className="opacity-50">&gt;_</span> Reflex.md
      </Link>
      <div className="flex items-center gap-5">
        <Link
          to="/repos"
          className="hidden md:inline font-mono text-xs text-text-secondary no-underline tracking-[1px] uppercase transition-colors duration-200 hover:text-green"
        >
          /Repos
        </Link>
        <a
          href="https://github.com/ishaan812/reflex.md"
          target="_blank"
          rel="noopener noreferrer"
          className="text-text-secondary transition-colors duration-200 hover:text-green"
        >
          <Github size={16} />
        </a>
        {login && (
          <span className="hidden md:inline text-xs text-text-dim font-mono">
            @{login}
          </span>
        )}
        <Button
          variant="ghost"
          size="sm"
          onClick={async () => {
            try {
              await api.logout();
            } finally {
              window.location.href = "/";
            }
          }}
          className="text-xs"
        >
          <LogOut size={14} />
          Logout
        </Button>
      </div>
    </nav>
  );
}
