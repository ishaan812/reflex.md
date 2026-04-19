// Minimal API helpers used across the frontend.
// The public web app is intentionally tiny — landing + download only.
// Everything richer lives in the Electron desktop app.

const init: RequestInit = { credentials: "include" };

export interface Me {
  login: string;
}

async function j<T>(r: Response): Promise<T> {
  if (r.ok) return (await r.json()) as T;
  const body = await r.text();
  let msg = body;
  try {
    msg = JSON.parse(body).error ?? body;
  } catch {
    /* plain text */
  }
  const err = new Error(msg || `HTTP ${r.status}`);
  (err as any).status = r.status;
  throw err;
}

export const api = {
  me: () => fetch("/api/me", init).then(j<Me>),
  logout: () => fetch("/auth/logout", { ...init, method: "POST" }).then(j),
};
