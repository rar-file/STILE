# examples/next — STILE in Next.js middleware

A `middleware.ts` that gates `/agents/*` and `/api/data/*`.

## What this example demonstrates

- Importing `createStileNext` from the adapter.
- The required `runtime: 'nodejs'` config — the Edge runtime restricts
  `node:crypto`, which STILE depends on.
- Path matchers via Next's `config.matcher`.

## What this example does NOT demonstrate

- The Edge runtime. STILE will not run in `runtime: 'edge'`.
- A persistent store. Next.js redeploys / scales to multiple workers,
  so the in-memory default loses single-use nonce protection. Use a
  backed store via the same shape as Recipes 2/3 in
  [`docs/DEPLOY.md`](../../docs/DEPLOY.md).
- Webhook configuration.

## Use

Drop the `middleware.ts` file at your Next.js project root (next to
`next.config.js`) and adjust the `matcher`. The factory call accepts
the same options as `createStile`.

## Contract

Tracks the public API documented in
[`docs/API.md`](../../docs/API.md).
