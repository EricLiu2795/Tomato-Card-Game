# Local process restart persistence tests

Run `npm run build` once, then `npm run test:persistence` (or `npx vitest run --config vitest.persistence.config.ts`). Keep application files, package metadata, and Wrangler configuration unchanged during the run: Wrangler development mode watches those files and may rebuild the runtime.

The harness starts its own local Wrangler on `127.0.0.1:8791` with inspector port `9235`, refuses to start if either port is occupied, and creates a unique `/tmp/tomato-persistence-*` directory. It sets `XDG_CONFIG_HOME=/tmp/tomato-config` and `WRANGLER_SEND_METRICS=false`. It only signals the detached process group that it created, reuses its storage directory for restarts, and removes that directory during cleanup. Existing servers on 8787 and 5173 are untouched.

## Coverage

Both scenarios use actual HTTP requests, session cookies, and WebSockets. They do not access debug endpoints, modify server state directly, seed production randomness, or change application code.

- **Three-player Dou Dizhu:** join, ready, start, bid 3, play a card, stop Wrangler/workerd with sockets connected, restart, and reconnect using the original cookies. Assert each identity, seat, private hand, public game state, and revision matches exactly. Replay the committed play with its original command ID and expected revision: receive the original ACK without a second play. Reuse the ID with a different action: receive an error. Then perform the next legal pass.
- **Four-player Guandan:** finish a real round using single-card leads and passes, then start the next double-tribute hand. Restart after one tribute choice, after one return choice, and after one discard choice. Compare all private hands and public state at each checkpoint. Verify the previously hidden pending selections become the exact cards exchanged after the second return, and verify all 108 cards remain accounted for after the optional discard completes.

Commands are throttled to at most one every 65 ms per actor, below the server's 20-per-second limit. A randomly dealt anti-tribute hand is completed through normal commands and retried, up to eight rounds; the test never treats a resisted hand as successful tribute/discard coverage. A rare run that cannot reach non-resisted tribute within that bound fails explicitly.

## Recorded validation

Validated on 2026-10-22 with Node `24.19.0`, Wrangler `4.151.3`, and workerd `1.20261019.1`:

```text
Test Files  1 passed (1)
Tests       2 passed (2)
Duration    27.04s
DDZ         5718ms
Guandan     17108ms
```

The suite performs four process restarts across five worker starts. ESLint and scoped strict TypeScript checks also pass. An earlier combined run timed out during the first Guandan tribute while package metadata was edited concurrently; the full rerun with stable watched files passed.

## Runtime limit

This is a local SQLite-backed Durable Object storage and process-restart test. It verifies reconnecting with restored state and persistent command receipts after terminating workerd. It does not force production Durable Object eviction or prove that an already-open WebSocket survives Cloudflare hibernation. No production deployment, external load test, or paid service is used.
