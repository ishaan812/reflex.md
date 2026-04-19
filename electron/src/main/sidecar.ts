// Spawns the Rust capture sidecar, parses its stdout for the `sidecar_ready`
// announcement, then opens a WebSocket to it and relays events.

import { spawn, ChildProcess } from "node:child_process";
import { app } from "electron";
import path from "node:path";
import fs from "node:fs";
import readline from "node:readline";
import { EventEmitter } from "node:events";
import WebSocket from "ws";

import type { CaptureEvent, CaptureStatus } from "@shared/types";

const HOST_ALLOWLIST = [
  // OpenAI
  "api.openai.com",
  "chat.openai.com",
  "auth.openai.com",
  // Anthropic
  "api.anthropic.com",
  "claude.ai",
  // Google Gemini
  "generativelanguage.googleapis.com",
  // xAI
  "api.x.ai",
  // Cursor
  "api.cursor.sh",
  // OpenCode (gateway for `opencode/*` models + app auth)
  "api.opencode.ai",
  "app.opencode.ai",
  // OpenRouter — frequently used by CLIs as a multi-provider gateway
  "openrouter.ai",
];

export interface SidecarEvents {
  event: (ev: CaptureEvent) => void;
  status: (status: CaptureStatus) => void;
}

export class Sidecar extends EventEmitter {
  private child: ChildProcess | null = null;
  private ws: WebSocket | null = null;
  private status: CaptureStatus = {
    sidecarRunning: false,
    proxyPort: null,
    wsPort: null,
    transparentPort: null,
    caCertPath: null,
    caFingerprintSha256: null,
    lastError: null,
  };

  getStatus(): CaptureStatus {
    return { ...this.status };
  }

  start(): void {
    if (this.child) return;

    const bin = resolveBinary();
    if (!bin) {
      this.updateStatus({
        lastError: "capture sidecar binary not found — run `pnpm build:sidecar`",
      });
      return;
    }

    const dataDir = path.join(app.getPath("userData"), "capture");
    fs.mkdirSync(dataDir, { recursive: true });

    const env = {
      ...process.env,
      REFLEX_DATA_DIR: dataDir,
      REFLEX_ALLOW_HOSTS: HOST_ALLOWLIST.join(","),
      REFLEX_LOG: process.env.REFLEX_LOG ?? "info",
    };

    // Enable all session sources by default; the network proxy + transparent
    // listener are OFF until the user explicitly installs the hooks, so we
    // pass port 0 for them which the sidecar treats as "don't bind".
    const args = [
      "--proxy-port", "0",
      "--ws-port", "0",
      "--transparent-port", "0",
      "--sources", "opencode,claude-code,codex",
      "--backfill-recent-minutes", "1440", // last 24h on first launch
    ];

    console.log(`[sidecar] spawning ${bin} ${args.join(" ")}`);
    const child = spawn(bin, args, { env, stdio: ["ignore", "pipe", "pipe"] });
    this.child = child;

    // stderr is free-form tracing logs — just forward to stdout.
    child.stderr?.on("data", (chunk) =>
      process.stderr.write(`[sidecar] ${chunk}`),
    );

    // stdout carries the `sidecar_ready` JSON line (and only that line today).
    const rl = readline.createInterface({ input: child.stdout! });
    rl.on("line", (line) => this.onSidecarStdout(line));

    child.once("exit", (code, signal) => {
      console.warn(`[sidecar] exited code=${code} signal=${signal}`);
      this.child = null;
      this.ws?.close();
      this.ws = null;
      this.updateStatus({ sidecarRunning: false });
    });

    child.once("error", (err) => {
      this.updateStatus({ lastError: err.message, sidecarRunning: false });
    });
  }

  stop(): void {
    this.ws?.close();
    this.ws = null;
    if (this.child && !this.child.killed) {
      this.child.kill("SIGTERM");
    }
    this.child = null;
    this.updateStatus({ sidecarRunning: false });
  }

  private onSidecarStdout(line: string): void {
    const trimmed = line.trim();
    if (!trimmed) return;
    let ev: CaptureEvent;
    try {
      ev = JSON.parse(trimmed);
    } catch (err) {
      console.warn("[sidecar] non-JSON stdout line:", trimmed);
      return;
    }
    if (ev.type === "sidecar_ready") {
      this.updateStatus({
        sidecarRunning: true,
        proxyPort: ev.proxy_port,
        wsPort: ev.ws_port,
        transparentPort: ev.transparent_port || null,
        caCertPath: ev.ca_cert_path,
        caFingerprintSha256: ev.ca_fingerprint_sha256,
        lastError: null,
      });
      this.connectWs(ev.ws_port);
    }
  }

  private connectWs(port: number): void {
    const url = `ws://127.0.0.1:${port}`;
    console.log(`[sidecar] connecting WS → ${url}`);
    const ws = new WebSocket(url);
    this.ws = ws;

    ws.on("open", () => console.log("[sidecar] WS open"));
    ws.on("close", () => {
      console.log("[sidecar] WS close");
      this.ws = null;
    });
    ws.on("error", (err) => {
      console.warn("[sidecar] WS error:", err.message);
      this.updateStatus({ lastError: err.message });
    });
    ws.on("message", (data) => {
      const text = data.toString("utf8");
      let ev: CaptureEvent;
      try {
        ev = JSON.parse(text);
      } catch {
        return;
      }
      this.emit("event", ev);
    });
  }

  private updateStatus(patch: Partial<CaptureStatus>): void {
    this.status = { ...this.status, ...patch };
    this.emit("status", this.getStatus());
  }
}

function resolveBinary(): string | null {
  // 1. Packaged: out/main/../resources/capture (extraResources)
  // 2. Dev: electron/resources/capture (produced by scripts/build-sidecar.sh)
  // 3. Dev fallback: ../rust/target/debug/reflex-capture
  const candidates = [
    app.isPackaged
      ? path.join(process.resourcesPath, "capture")
      : path.join(app.getAppPath(), "resources", "capture"),
    path.join(app.getAppPath(), "..", "rust", "target", "release", "reflex-capture"),
    path.join(app.getAppPath(), "..", "rust", "target", "debug", "reflex-capture"),
  ];
  for (const c of candidates) {
    try {
      fs.accessSync(c, fs.constants.X_OK);
      return c;
    } catch {
      // continue
    }
  }
  return null;
}
