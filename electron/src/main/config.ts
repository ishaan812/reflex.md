// Persisted user config for Reflex. Sits in ~/.reflex/config.json with
// 0600 permissions. Holds API keys the user explicitly provides so we
// don't have to keep asking.

import fs from "node:fs";
import path from "node:path";
import os from "node:os";

export interface ReflexConfig {
  /** Gemini (Google Generative Language API) key for the AI judge. */
  gemini_api_key?: string;
  /** Preferred Gemini model for judgments. */
  gemini_model?: string;
  /** Anthropic key (for future "judge with Claude" support). */
  anthropic_api_key?: string;
  /** Default GitHub PAT used when a repo-specific one isn't configured. */
  github_token?: string;
  /** Per-repo GitHub PAT overrides. Keys are lowercased "owner/repo" strings. */
  github_tokens?: Record<string, string>;
}

const DIR = path.join(os.homedir(), ".reflex");
const PATH = path.join(DIR, "config.json");

export function loadConfig(): ReflexConfig {
  try {
    const raw = fs.readFileSync(PATH, "utf8");
    return JSON.parse(raw) as ReflexConfig;
  } catch {
    return {};
  }
}

export function saveConfig(patch: Partial<ReflexConfig>): ReflexConfig {
  fs.mkdirSync(DIR, { recursive: true });
  const current = loadConfig();
  const merged = { ...current, ...patch };
  const tmp = PATH + ".tmp";
  fs.writeFileSync(tmp, JSON.stringify(merged, null, 2), {
    mode: 0o600,
  });
  fs.renameSync(tmp, PATH);
  try {
    fs.chmodSync(PATH, 0o600);
  } catch {
    // best-effort on non-unix
  }
  return merged;
}

/** Convenience: export a safe view (no keys) for the renderer. */
export function configStatus(cfg: ReflexConfig = loadConfig()): {
  has_gemini: boolean;
  has_anthropic: boolean;
  has_github: boolean;
  gemini_model: string;
  /** Lowercased "owner/repo" keys that have an override token set. */
  github_token_overrides: string[];
} {
  return {
    has_gemini: !!cfg.gemini_api_key,
    has_anthropic: !!cfg.anthropic_api_key,
    has_github: !!cfg.github_token,
    gemini_model: cfg.gemini_model ?? "gemini-2.5-flash",
    github_token_overrides: Object.keys(cfg.github_tokens ?? {}),
  };
}

/** Resolve the best GitHub PAT for a given repo. */
export function tokenForRepo(
  owner: string | null | undefined,
  repo: string | null | undefined,
  cfg: ReflexConfig = loadConfig(),
): string | null {
  if (owner && repo && cfg.github_tokens) {
    const key = `${owner}/${repo}`.toLowerCase();
    if (cfg.github_tokens[key]) return cfg.github_tokens[key];
  }
  return cfg.github_token ?? null;
}

/** Set or remove a per-repo token override. `token=""` or undefined removes it. */
export function setRepoToken(
  ownerRepo: string,
  token: string | undefined,
): ReflexConfig {
  const key = ownerRepo.toLowerCase();
  const cur = loadConfig();
  const next: Record<string, string> = { ...(cur.github_tokens ?? {}) };
  if (!token) {
    delete next[key];
  } else {
    next[key] = token;
  }
  return saveConfig({ github_tokens: next });
}
