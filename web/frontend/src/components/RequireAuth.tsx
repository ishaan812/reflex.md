import { useEffect, useState, type ReactNode } from "react";

type AuthState =
  | { status: "loading" }
  | { status: "authed"; login: string }
  | { status: "anon" };

interface RequireAuthProps {
  children: (me: { login: string }) => ReactNode;
}

/**
 * Route guard. Renders nothing until `/api/me` resolves.
 *
 * - 200 → renders `children(me)`
 * - 401 / network error → hard-redirects to `/auth/github`. The backend
 *   callback in `web/backend/src/auth.ts` redirects back to the original
 *   destination (`/download`) once the session cookie is set.
 *
 * While loading or redirecting we render `null` on purpose — the protected
 * page must never flash for unauthenticated visitors.
 */
export function RequireAuth({ children }: RequireAuthProps) {
  const [auth, setAuth] = useState<AuthState>({ status: "loading" });

  useEffect(() => {
    let cancelled = false;
    fetch("/api/me", { credentials: "include" })
      .then(async (r) => {
        if (cancelled) return;
        if (r.ok) {
          const d = (await r.json()) as { login: string };
          setAuth({ status: "authed", login: d.login });
          return;
        }
        setAuth({ status: "anon" });
        window.location.replace("/auth/github");
      })
      .catch(() => {
        if (cancelled) return;
        setAuth({ status: "anon" });
        window.location.replace("/auth/github");
      });
    return () => {
      cancelled = true;
    };
  }, []);

  if (auth.status !== "authed") return null;
  return <>{children({ login: auth.login })}</>;
}
