import { useEffect, useState } from "react";

interface Props {
  open: boolean;
  onClose: () => void;
  onChanged: () => void;
}

interface ConfigStatus {
  has_gemini: boolean;
  has_anthropic: boolean;
  has_github: boolean;
  gemini_model: string;
  github_token_overrides: string[];
}

interface CaptureStatus {
  sidecarRunning: boolean;
  proxyPort: number | null;
  wsPort: number | null;
  transparentPort: number | null;
  caCertPath: string | null;
  caFingerprintSha256: string | null;
  lastError: string | null;
}

type TestState =
  | { kind: "idle" }
  | { kind: "testing" }
  | { kind: "ok"; detail: string; extra?: string }
  | { kind: "err"; detail: string };

export function SettingsModal({ open, onClose, onChanged }: Props): JSX.Element | null {
  const [status, setStatus] = useState<ConfigStatus | null>(null);

  const [geminiKey, setGeminiKey] = useState("");
  const [geminiModel, setGeminiModel] = useState("gemini-2.5-flash");
  const [geminiTest, setGeminiTest] = useState<TestState>({ kind: "idle" });

  const [ghToken, setGhToken] = useState("");
  const [ghTest, setGhTest] = useState<TestState>({ kind: "idle" });

  const [saving, setSaving] = useState(false);
  const [savedMsg, setSavedMsg] = useState<string | null>(null);

  const [capture, setCapture] = useState<CaptureStatus | null>(null);

  // Per-repo token overrides
  const [newRepoKey, setNewRepoKey] = useState("");
  const [newRepoToken, setNewRepoToken] = useState("");
  const [repoStatus, setRepoStatus] = useState<string | null>(null);

  useEffect(() => {
    if (!open) return;
    void window.reflex.configStatus().then((s) => {
      setStatus(s);
      setGeminiModel(s.gemini_model);
      setGeminiKey("");
      setGhToken("");
      setGeminiTest({ kind: "idle" });
      setGhTest({ kind: "idle" });
    });
    void window.reflex.getStatus().then(setCapture);
  }, [open]);

  if (!open) return null;

  const testGemini = async (): Promise<void> => {
    if (!geminiKey.trim()) {
      setGeminiTest({ kind: "err", detail: "paste a key first" });
      return;
    }
    setGeminiTest({ kind: "testing" });
    const res = await window.reflex.testGemini(geminiKey.trim(), geminiModel);
    setGeminiTest(
      res.ok
        ? {
            kind: "ok",
            detail: res.detail,
            extra: res.tokens ? `${res.tokens} tokens` : undefined,
          }
        : { kind: "err", detail: res.detail },
    );
  };

  const testGitHub = async (): Promise<void> => {
    if (!ghToken.trim()) {
      setGhTest({ kind: "err", detail: "paste a token first" });
      return;
    }
    setGhTest({ kind: "testing" });
    const res = await window.reflex.testGitHub(ghToken.trim());
    setGhTest(
      res.ok
        ? {
            kind: "ok",
            detail: res.detail,
            extra: res.scopes?.length ? `scopes: ${res.scopes.join(", ")}` : "fine-grained",
          }
        : { kind: "err", detail: res.detail },
    );
  };

  const save = async (): Promise<void> => {
    setSaving(true);
    setSavedMsg(null);
    const patch: Record<string, string | undefined> = {};
    if (geminiKey.trim()) patch.gemini_api_key = geminiKey.trim();
    if (geminiModel && geminiModel !== status?.gemini_model) {
      patch.gemini_model = geminiModel;
    }
    if (ghToken.trim()) patch.github_token = ghToken.trim();
    if (Object.keys(patch).length === 0) {
      setSavedMsg("nothing to save");
      setSaving(false);
      return;
    }
    try {
      const s = await window.reflex.saveConfig(patch);
      setStatus(s);
      setSavedMsg("saved");
      setGeminiKey("");
      setGhToken("");
      onChanged();
      setTimeout(() => setSavedMsg(null), 2500);
    } catch (e) {
      setSavedMsg(`failed: ${(e as Error).message}`);
    } finally {
      setSaving(false);
    }
  };

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm"
      onClick={onClose}
    >
      <div
        className="w-[640px] max-w-[90vw] max-h-[90vh] overflow-y-auto rounded-lg border border-slate-700 bg-slate-950 p-6 shadow-2xl"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-center justify-between">
          <h2 className="text-base font-semibold text-slate-100">Settings</h2>
          <button
            onClick={onClose}
            className="text-slate-500 hover:text-slate-200"
            aria-label="close"
          >
            ✕
          </button>
        </div>
        <p className="mt-1 text-xs text-slate-500">
          Keys are stored in <code className="text-slate-300">~/.reflex/config.json</code> with
          0600 permissions. Never transmitted anywhere except the configured provider.
        </p>

        {/* --- Gemini --- */}
        <section className="mt-5">
          <div className="flex items-center gap-2">
            <h3 className="text-xs font-semibold uppercase tracking-wide text-violet-300">
              Gemini (AI Judge)
            </h3>
            <StatusPill ok={!!status?.has_gemini} />
          </div>
          <label className="mt-2 block text-xs text-slate-400">API Key</label>
          <input
            type="password"
            autoComplete="off"
            value={geminiKey}
            onChange={(e) => setGeminiKey(e.target.value)}
            placeholder={status?.has_gemini ? "••••••• (leave blank to keep existing)" : "AIza… or AQ…"}
            className="mt-1 w-full rounded border border-slate-700 bg-slate-900 px-2 py-1.5 font-mono text-xs text-slate-200 focus:border-violet-500 focus:outline-none"
          />
          <label className="mt-3 block text-xs text-slate-400">Model</label>
          <select
            value={geminiModel}
            onChange={(e) => setGeminiModel(e.target.value)}
            className="mt-1 w-full rounded border border-slate-700 bg-slate-900 px-2 py-1.5 text-xs text-slate-200"
          >
            <option value="gemini-2.5-flash">gemini-2.5-flash (fast, cheap)</option>
            <option value="gemini-2.5-pro">gemini-2.5-pro (higher quality)</option>
            <option value="gemini-2.0-flash">gemini-2.0-flash (legacy)</option>
            <option value="gemini-1.5-pro">gemini-1.5-pro (legacy)</option>
          </select>
          <div className="mt-2 flex items-center gap-2">
            <button
              onClick={() => void testGemini()}
              disabled={geminiTest.kind === "testing"}
              className="rounded border border-slate-700 px-2 py-1 text-xs text-slate-200 hover:bg-slate-800 disabled:opacity-50"
            >
              {geminiTest.kind === "testing" ? "testing…" : "Test key"}
            </button>
            <TestResult state={geminiTest} />
          </div>
          <p className="mt-2 text-[11px] text-slate-500">
            Get a key at{" "}
            <a
              href="https://aistudio.google.com/app/apikey"
              onClick={(e) => {
                e.preventDefault();
                window.open("https://aistudio.google.com/app/apikey", "_blank", "noopener");
              }}
              className="text-violet-300 hover:underline"
            >
              aistudio.google.com/app/apikey ↗
            </a>
            {" "}— free tier is more than enough.
          </p>
        </section>

        {/* --- GitHub --- */}
        <section className="mt-6">
          <div className="flex items-center gap-2">
            <h3 className="text-xs font-semibold uppercase tracking-wide text-emerald-300">
              GitHub (Open PRs)
            </h3>
            <StatusPill ok={!!status?.has_github} />
          </div>
          <label className="mt-2 block text-xs text-slate-400">Personal Access Token</label>
          <input
            type="password"
            autoComplete="off"
            value={ghToken}
            onChange={(e) => setGhToken(e.target.value)}
            placeholder={status?.has_github ? "••••••• (leave blank to keep existing)" : "ghp_… or github_pat_…"}
            className="mt-1 w-full rounded border border-slate-700 bg-slate-900 px-2 py-1.5 font-mono text-xs text-slate-200 focus:border-emerald-500 focus:outline-none"
          />
          <div className="mt-2 flex items-center gap-2">
            <button
              onClick={() => void testGitHub()}
              disabled={ghTest.kind === "testing"}
              className="rounded border border-slate-700 px-2 py-1 text-xs text-slate-200 hover:bg-slate-800 disabled:opacity-50"
            >
              {ghTest.kind === "testing" ? "testing…" : "Test token"}
            </button>
            <TestResult state={ghTest} />
          </div>
          <p className="mt-2 text-[11px] text-slate-500">
            Classic token (recommended){" "}
            <a
              href="https://github.com/settings/tokens/new?scopes=repo&description=reflex"
              onClick={(e) => {
                e.preventDefault();
                window.open(
                  "https://github.com/settings/tokens/new?scopes=repo&description=reflex",
                  "_blank",
                  "noopener",
                );
              }}
              className="text-emerald-300 hover:underline"
            >
              create one ↗
            </a>
            {" "}with <code className="text-slate-300">repo</code> scope.
            Fine-grained tokens also work, but need <em>Contents: write</em> +{" "}
            <em>Pull requests: write</em>.
          </p>
        </section>

        {/* --- Per-repo token overrides --- */}
        <section className="mt-6">
          <div className="flex items-center gap-2">
            <h3 className="text-xs font-semibold uppercase tracking-wide text-emerald-300">
              Per-repo GitHub tokens
            </h3>
            <span className="inline-block rounded bg-slate-800 px-1.5 text-[10px] font-semibold uppercase text-slate-400">
              {status?.github_token_overrides.length ?? 0} override
              {(status?.github_token_overrides.length ?? 0) === 1 ? "" : "s"}
            </span>
          </div>
          <p className="mt-1 text-[11px] text-slate-500">
            Different repos may belong to different orgs or need different
            scopes. Add a token for a specific{" "}
            <code className="text-slate-300">owner/repo</code> and Reflex will
            use it instead of the default for any GitHub call against that
            repo (PRs, shared judgments, shared playgrounds, team history).
          </p>

          {(status?.github_token_overrides.length ?? 0) > 0 && (
            <ul className="mt-2 space-y-1">
              {status!.github_token_overrides.map((key) => (
                <li
                  key={key}
                  className="flex items-center gap-2 rounded border border-slate-800 bg-slate-900/40 px-2 py-1 text-[11px]"
                >
                  <code className="flex-1 truncate text-slate-200">{key}</code>
                  <StatusPill ok={true} />
                  <button
                    onClick={async () => {
                      const s = await window.reflex.setRepoToken(key);
                      setStatus(s);
                      onChanged();
                      setRepoStatus(`removed ${key}`);
                      setTimeout(() => setRepoStatus(null), 2500);
                    }}
                    className="rounded border border-slate-700 px-1.5 text-[10px] text-rose-300 hover:bg-slate-800"
                    title="remove override"
                  >
                    remove
                  </button>
                </li>
              ))}
            </ul>
          )}

          <div className="mt-3 grid grid-cols-[1fr_auto] gap-2">
            <input
              type="text"
              value={newRepoKey}
              onChange={(e) => setNewRepoKey(e.target.value)}
              placeholder="owner/repo (e.g. ishaan812/reflex.md)"
              className="rounded border border-slate-700 bg-slate-900 px-2 py-1 font-mono text-xs text-slate-200 focus:border-emerald-500 focus:outline-none"
            />
            <span />
            <input
              type="password"
              autoComplete="off"
              value={newRepoToken}
              onChange={(e) => setNewRepoToken(e.target.value)}
              placeholder="ghp_… or github_pat_…"
              className="rounded border border-slate-700 bg-slate-900 px-2 py-1 font-mono text-xs text-slate-200 focus:border-emerald-500 focus:outline-none"
            />
            <button
              onClick={async () => {
                const k = newRepoKey.trim();
                const t = newRepoToken.trim();
                if (!/^[^/]+\/[^/]+$/.test(k)) {
                  setRepoStatus("key must be in `owner/repo` form");
                  return;
                }
                if (!t) {
                  setRepoStatus("paste a token first");
                  return;
                }
                try {
                  const s = await window.reflex.setRepoToken(k, t);
                  setStatus(s);
                  onChanged();
                  setNewRepoKey("");
                  setNewRepoToken("");
                  setRepoStatus(`added override for ${k.toLowerCase()}`);
                  setTimeout(() => setRepoStatus(null), 2500);
                } catch (e) {
                  setRepoStatus((e as Error).message);
                }
              }}
              className="rounded bg-emerald-700 px-3 py-1 text-xs font-medium text-white hover:bg-emerald-600"
            >
              Add
            </button>
          </div>
          {repoStatus && (
            <div className="mt-2 text-[11px] text-slate-400">{repoStatus}</div>
          )}
        </section>

        {/* --- Network capture (for desktop apps like ChatGPT.app) --- */}
        <section className="mt-6">
          <div className="flex items-center gap-2">
            <h3 className="text-xs font-semibold uppercase tracking-wide text-sky-300">
              Network capture
            </h3>
            <StatusPill ok={!!capture?.sidecarRunning} />
            {capture?.proxyPort && (
              <span className="text-[10px] text-slate-500">
                proxy 127.0.0.1:{capture.proxyPort}
              </span>
            )}
          </div>
          <p className="mt-1 text-[11px] text-slate-500">
            Enables HTTPS proxy capture of native macOS apps (ChatGPT.app,
            Cursor, etc.) by installing Reflex's CA into the System keychain
            and setting the macOS system HTTPS proxy. Opencode / Claude Code /
            Codex already come in via on-disk session tailing and don't need
            this.
          </p>

          {capture?.caCertPath ? (
            <div className="mt-2 space-y-1 text-[11px]">
              <div>
                <span className="text-slate-500">CA:</span>{" "}
                <code className="text-slate-300 selectable">
                  {capture.caCertPath}
                </code>
              </div>
              {capture.caFingerprintSha256 && (
                <div className="truncate">
                  <span className="text-slate-500">fingerprint:</span>{" "}
                  <code
                    className="text-slate-400 selectable"
                    title={capture.caFingerprintSha256}
                  >
                    {capture.caFingerprintSha256.slice(0, 32)}…
                  </code>
                </div>
              )}
              <CommandBlock
                label="Enable (installs CA + macOS system proxy, one sudo prompt)"
                cmd={`sudo bash /Users/bhavya_gor/work/reflex.md/scripts/install-hooks.sh --ca "${capture.caCertPath}" --proxy-port 8888 --no-pf`}
              />
              <CommandBlock
                label="Disable (reverts everything)"
                cmd={`sudo bash /Users/bhavya_gor/work/reflex.md/scripts/install-hooks.sh --ca "${capture.caCertPath}" --uninstall`}
              />
            </div>
          ) : (
            <div className="mt-2 text-[11px] text-slate-600">
              sidecar not reporting CA yet — wait a moment after app startup.
            </div>
          )}
        </section>

        {/* --- actions --- */}
        <div className="mt-6 flex items-center gap-3 border-t border-slate-800 pt-4">
          <button
            onClick={() => void save()}
            disabled={saving}
            className="rounded bg-sky-700 px-3 py-1.5 text-sm font-medium text-white hover:bg-sky-600 disabled:opacity-50"
          >
            {saving ? "saving…" : "Save"}
          </button>
          <button
            onClick={onClose}
            className="rounded border border-slate-700 px-3 py-1.5 text-sm text-slate-300 hover:bg-slate-800"
          >
            Close
          </button>
          {savedMsg && (
            <span className="text-xs text-slate-400">{savedMsg}</span>
          )}
        </div>
      </div>
    </div>
  );
}

function CommandBlock({
  label,
  cmd,
}: {
  label: string;
  cmd: string;
}): JSX.Element {
  const [copied, setCopied] = useState(false);
  const copy = async (): Promise<void> => {
    try {
      await navigator.clipboard.writeText(cmd);
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    } catch {
      // ignore
    }
  };
  return (
    <div>
      <div className="text-[10px] uppercase tracking-wide text-slate-500">
        {label}
      </div>
      <div className="mt-0.5 flex items-center gap-2 rounded bg-slate-900 px-2 py-1">
        <code className="flex-1 truncate text-[11px] text-slate-300 selectable">
          {cmd}
        </code>
        <button
          onClick={() => void copy()}
          className="shrink-0 rounded border border-slate-700 px-1.5 text-[10px] text-slate-300 hover:bg-slate-800"
        >
          {copied ? "copied" : "copy"}
        </button>
      </div>
    </div>
  );
}

function StatusPill({ ok }: { ok: boolean }): JSX.Element {
  return (
    <span
      className={`inline-block rounded px-1.5 text-[10px] font-semibold uppercase ${
        ok
          ? "bg-emerald-950 text-emerald-300"
          : "bg-slate-800 text-slate-500"
      }`}
    >
      {ok ? "connected" : "not set"}
    </span>
  );
}

function TestResult({ state }: { state: TestState }): JSX.Element | null {
  if (state.kind === "idle") return null;
  if (state.kind === "testing") {
    return <span className="text-xs text-slate-400">testing…</span>;
  }
  if (state.kind === "ok") {
    return (
      <span className="truncate text-xs text-emerald-300" title={state.detail}>
        ✓ {state.detail}
        {state.extra && (
          <span className="ml-1.5 text-slate-500">· {state.extra}</span>
        )}
      </span>
    );
  }
  return (
    <span className="truncate text-xs text-rose-300" title={state.detail}>
      ✗ {state.detail}
    </span>
  );
}
