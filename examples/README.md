# STILE examples

Each subdirectory is a self-contained, runnable example. Each has its
own `README.md` describing what it demonstrates, what it doesn't, and
how to run it.

These examples are **first-class** in the sense that:

- They track the public API documented in [`docs/API.md`](../docs/API.md).
  When that file's contracts change, the examples must change in the
  same commit.
- They use only the supported package exports — no reaching into
  `lib/handler/*` or other internals.
- They each declare what they're a demo of, and what production
  posture they deviate from.

| Example                                  | Demonstrates                                  |
| ---------------------------------------- | --------------------------------------------- |
| [`express`](express/)                    | `createStileExpress` middleware               |
| [`fastify`](fastify/)                    | `createStileFastify` plugin                   |
| [`hono`](hono/)                          | `createStileHono` middleware (Node runtime)   |
| [`next`](next/)                          | `createStileNext` middleware (`runtime: 'nodejs'`) |
| [`cf-worker`](cf-worker/)                | `createCfWorkerHandler` for Cloudflare        |
| [`agent-market`](agent-market/)          | a full-flavor app with `tier: 'strong'`, `onVerify` |

For production-shaped deployments of each, see
[`docs/DEPLOY.md`](../docs/DEPLOY.md).
