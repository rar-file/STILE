# examples/cf-worker — STILE in a Cloudflare Worker

A minimal Worker that gates two paths and forwards everything else to a
small inline downstream handler.

## What this example demonstrates

- Importing `createCfWorkerHandler` from the adapter.
- The Web Fetch (Request/Response) → Node-shape gate shim.
- Wrapping a downstream `(request, env, ctx)` handler.

## What this example does NOT demonstrate

- A backing store. The default in-memory store does **not** survive
  cold starts and **does not** synchronize across colos — single-use
  nonce protection is broken without a real store. The example uses
  the toy default for brevity. For real deployment, supply a store
  backed by KV (eventually consistent — has a small replay window) or
  a Durable Object (strict, slower).
- A real secret. The example hardcodes a dev secret. Use
  `wrangler secret put STILE_SECRET` in real deployments and read
  from `env.STILE_SECRET`.
- Multiple-region considerations beyond the store.

For a deployable shape, see
[`docs/DEPLOY.md` Recipe 3](../../docs/DEPLOY.md#recipe-3--cloudflare-worker).

## Use

```toml
# wrangler.toml
name = "my-stile-edge"
main = "examples/cf-worker/worker.js"
compatibility_date = "2026-01-01"
```

```bash
wrangler deploy
```

## Contract

Tracks the public API documented in
[`docs/API.md`](../../docs/API.md).
