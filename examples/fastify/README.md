# examples/fastify — STILE on a Fastify app

Mounts the Fastify plugin form of STILE.

## What this example demonstrates

- `createStileFastify` registered as a plugin (`app.register(...)`).
- Two protected routes (`/agents`, `/api/data`).
- The plugin attaches itself via Fastify's `onRequest` hook so it sees
  the raw req/res — important because STILE handles the verify
  endpoint itself.

## What this example does NOT demonstrate

- A real secret. Same caveat as the Express example.
- Persistence, TLS, rate limiting, fast-paths, multi-process.
- Body parsing interactions. STILE's `/__stile-verify` reads its own
  body. Don't put a global JSON parser before this plugin or it will
  consume the body STILE expects to read.

## Run

```bash
npm install fastify
node examples/fastify/server.js
# → http://localhost:3003
```

## Contract

Tracks the public API documented in
[`docs/API.md`](../../docs/API.md).
