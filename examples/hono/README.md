# examples/hono — STILE on a Hono app

Mounts the Hono adapter on the Node runtime.

## What this example demonstrates

- `createStileHono` as `app.use('*', ...)` middleware.
- Hono's Web Fetch primitives shimmed into STILE's Node-shape gate.
- Two protected routes.

## What this example does NOT demonstrate

- The Bun / Cloudflare Workers / Deno runtimes. The adapter assumes a
  Node-compatible runtime (`@hono/node-server` here). For Cloudflare,
  use [`examples/cf-worker`](../cf-worker/) instead.
- Persistent state across instances. The default in-memory store dies
  with the process. For edge / multi-region you must supply a backed
  store (see [`docs/DEPLOY.md` Recipe 3](../../docs/DEPLOY.md#recipe-3--cloudflare-worker)).
- TLS, fast-paths, real secrets.

## Run

```bash
npm install hono @hono/node-server
node examples/hono/server.js
# → http://localhost:3002
```

## Contract

Tracks the public API documented in
[`docs/API.md`](../../docs/API.md).
