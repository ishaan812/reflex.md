# Reflex — AI Call Tracker

System-wide network interception + cross-session memory layer for AI apps on macOS.
Intercepts traffic from ChatGPT.app, Claude.app, Cursor, Claude Code, Codex CLI, Gemini CLI,
Raycast AI, etc. so agents can share context and mistakes across sessions.

## Architecture

```
 ┌──────────────────────────┐    WS/JSON    ┌───────────────────────────┐
 │  Electron app (TS/React) │ ◀───────────▶ │ Rust sidecar (hudsucker) │
 │  SQLite · flow browser   │               │ MITM · CA · proxy        │
 └──────────────────────────┘               └───────────────────────────┘
                                                        │
                                                        ▼
                                        macOS hooks (networksetup + pf + shell env)
```

Two working directories:

- `electron/` — Electron + React + TypeScript shell (UI + storage + orchestration)
- `rust/`     — Rust capture sidecar (hudsucker MITM, rustls, WebSocket IPC)
- `webapp/`   — reserved for future web dashboard (empty placeholder)
- `scripts/`  — install hooks and sidecar build helpers

## Quick start

```bash
# 1. Build the Rust sidecar (release, ~8 MB; ~1 min cold)
./scripts/build-sidecar.sh

# 2. Install deps and run the Electron app in dev
cd electron
pnpm install    # postinstall rebuilds better-sqlite3 for Electron's Node ABI
pnpm dev
```

The first time the sidecar starts it generates a local CA at
`~/Library/Application Support/Reflex/capture/reflex-ca.pem`. The Electron
shell will later prompt (via `sudo-prompt`) to:

- install that CA into the System keychain (so HTTPS MITM is trusted)
- set the macOS HTTP/HTTPS proxy to `127.0.0.1:8888`
- (optionally, future work) add pf redirect rules for transparent capture

To instrument CLI tools (Claude Code, Codex, Gemini CLI), enable the
"Instrument shell" toggle in Settings — it will append `HTTPS_PROXY` and
`NODE_EXTRA_CA_CERTS` to your `~/.zshrc`.

### Manual sanity check (no Electron needed)

```bash
# Start the sidecar on random ports with capture-everything mode
REFLEX_DATA_DIR=/tmp/reflex ./rust/target/release/reflex-capture \
  --proxy-port 0 --ws-port 0

# In another shell, run curl through it (self-signed CA → use -k)
curl -k -x http://127.0.0.1:<proxy_port> https://example.com/
# ...watch live events on ws://127.0.0.1:<ws_port>
```

## MVP milestones

- [x] Electron ↔ Rust sidecar wired over WebSocket
- [x] Auto-generate CA + stdout `sidecar_ready` handshake
- [x] End-to-end MITM verified (`curl -k` through proxy → WS events)
- [x] SQLite store for flows + bodies (better-sqlite3)
- [x] React list/detail flow viewer
- [ ] CA + proxy install via `sudo-prompt` on first launch
- [ ] Shell env injection for CLI tools (HTTPS_PROXY, NODE_EXTRA_CA_CERTS)
- [ ] Export "mistakes" context file for CLI agents

## Host allowlist (MVP)

`api.openai.com`, `api.anthropic.com`, `chat.openai.com`, `claude.ai`,
`api.cursor.sh`, `generativelanguage.googleapis.com`, `api.x.ai`

## Event schema

The sidecar emits newline-delimited JSON over WebSocket. See
`rust/src/event.rs` and `electron/src/shared/types.ts` — they must stay in sync.

## Known risks

| Risk | Mitigation |
|---|---|
| Cert pinning (ChatGPT.app likely pins) | Fallback to file-watching local session stores |
| First-run admin prompts | One-time `sudo-prompt` flow with onboarding UX |
| Network Extension entitlement needed for some apps | Capture layer is behind an interface — backends swappable |
