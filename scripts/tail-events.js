#!/usr/bin/env node
/**
 * Reflex event tail — connects to ws://127.0.0.1:<port> and prints a
 * compact summary for each capture event. Used for manual smoke testing.
 *
 *   node scripts/tail-events.js --ws 9999 [--body]
 *
 * With --body the tool also prints decoded request/response bodies
 * (truncated to 2KB per side).
 */

const path = require("node:path");
const wsPath = path.join(
  __dirname,
  "..",
  "electron",
  "node_modules",
  "ws",
);
const WebSocket = require(wsPath);

const args = Object.fromEntries(
  process.argv.slice(2).reduce((acc, arg, i, arr) => {
    if (arg.startsWith("--") && arr[i + 1] && !arr[i + 1].startsWith("--")) {
      acc.push([arg.slice(2), arr[i + 1]]);
    } else if (arg.startsWith("--")) {
      acc.push([arg.slice(2), "true"]);
    }
    return acc;
  }, []),
);
const port = args.ws ?? "9999";
const showBody = args.body === "true";

const url = `ws://127.0.0.1:${port}`;
const ws = new WebSocket(url);

ws.on("open", () => console.error(`[tail] connected ${url}`));
ws.on("error", (e) => console.error("[tail] error:", e.message));
ws.on("close", () => {
  console.error("[tail] closed");
  process.exit(0);
});

const starts = new Map();

ws.on("message", (buf) => {
  const ev = JSON.parse(buf.toString("utf8"));
  const t = new Date().toISOString().slice(11, 23);
  switch (ev.type) {
    case "sidecar_ready":
      console.log(`${t} ready proxy=${ev.proxy_port} ws=${ev.ws_port}`);
      break;
    case "flow_start":
      starts.set(ev.id, Date.now());
      console.log(
        `${t} ▶ ${ev.method.padEnd(4)} ${ev.scheme}://${ev.host}${ev.path}`,
      );
      break;
    case "request_head":
      if (showBody) {
        const ct = ev.headers["content-type"] ?? "";
        if (ct) console.log(`${t}   req content-type: ${ct}`);
      }
      break;
    case "request_body":
      if (showBody && ev.byte_len > 0) {
        const body = Buffer.from(ev.body_b64, "base64").toString("utf8");
        console.log(
          `${t}   req body (${ev.byte_len}B${ev.truncated ? ", truncated" : ""}):`,
        );
        console.log(indent(clip(body, 2048)));
      }
      break;
    case "response_head":
      console.log(`${t}   ← status ${ev.status} http=${ev.http_version}`);
      break;
    case "response_body":
      if (showBody && ev.byte_len > 0) {
        const body = Buffer.from(ev.body_b64, "base64").toString("utf8");
        console.log(
          `${t}   resp body (${ev.byte_len}B${ev.truncated ? ", truncated" : ""}):`,
        );
        console.log(indent(clip(body, 2048)));
      }
      break;
    case "flow_end":
      console.log(
        `${t} ✓ done in ${ev.duration_ms}ms${ev.error ? " err=" + ev.error : ""}`,
      );
      break;
  }
});

function clip(s, n) {
  return s.length > n ? s.slice(0, n) + `… (+${s.length - n}B)` : s;
}
function indent(s) {
  return s
    .split("\n")
    .map((l) => "      " + l)
    .join("\n");
}
