# reflex-capture (Rust sidecar)

MITM proxy + local WebSocket event stream. Spawned by the Electron shell.

## Run standalone

```bash
cargo run -- \
  --proxy-port 8888 \
  --ws-port 0 \
  --data-dir ~/.reflex \
  --allow-host api.anthropic.com \
  --allow-host api.openai.com
```

On start it prints one line of JSON on stdout (`sidecar_ready`) with the bound
proxy port, WS port, CA cert path, and CA fingerprint. After that, events
stream to every connected WebSocket client as JSON text frames.

## Environment variables

| Var                 | Equivalent flag      |
|---------------------|----------------------|
| `REFLEX_PROXY_PORT` | `--proxy-port`       |
| `REFLEX_WS_PORT`    | `--ws-port`          |
| `REFLEX_DATA_DIR`   | `--data-dir`         |
| `REFLEX_ALLOW_HOSTS`| `--allow-host` (csv) |
| `REFLEX_LOG`        | tracing `EnvFilter`  |

## Wire events

See `src/event.rs` — tagged union. The TypeScript mirror is in
`electron/src/shared/types.ts` and must stay in sync.

## Caveats

- Bodies are buffered up to 10 MiB in memory per side; larger responses
  are truncated (the `truncated` flag goes `true`). Streaming / chunked
  event relay is future work.
- WebSocket upgrades through the proxy are not yet instrumented (there's a
  `WebSocketHandler` hook in hudsucker we don't use yet).
- `handle_error` vs. `FlowEnd` races are best-effort — on a very fast
  error path we may miss the tail event.
