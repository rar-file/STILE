# examples/express — STILE on an Express app

Wires `createStileExpress` into a 20-line Express app and gates two
routes.

## What this example demonstrates

- Mounting STILE as Express middleware (`app.use(...)`).
- Two protected routes (`/agents` and `/api/data`) that an AI agent
  reaches after redeeming the verification URL once.
- The simplest possible posture — `tier: 'easy'`, in-memory store.

## What this example does NOT demonstrate

- A real production secret (uses `process.env.STILE_SECRET ||
  'dev-secret'` — the fallback is for local dev and is forgeable).
- Persistence. Counters, nonces, and reputation are wiped at restart.
- TLS, reverse proxy, rate limiting. Run NGINX / Caddy / fly.io's edge
  in front for those.
- Webhook delivery, mTLS or Web Bot Auth fast-paths.
- Multi-process safety. Express in cluster mode would split the
  in-memory store.

For a production-shaped Express integration, see
[`docs/DEPLOY.md` Recipe 4](../../docs/DEPLOY.md#recipe-4--middleware-in-an-existing-app).

## Run

```bash
npm install express
node examples/express/server.js
# → http://localhost:3001
```

Then:

```bash
# Look at what an AI sees
curl -H 'Accept: application/json' http://localhost:3001/agents

# Walk the verify URL it returns
curl -c jar.txt 'http://localhost:3001/__stile-verify?token=...&word=...'

# Now you have a session cookie
curl -b jar.txt http://localhost:3001/api/data
```

## Contract

This example tracks the public API documented in
[`docs/API.md`](../../docs/API.md). When that file changes its
`createStileExpress` signature, this example must be updated in the
same change.
