# STILE — Deployment

Concrete recipes for the four real ways to run STILE. None of these
match `npm run dev` exactly — that's the demo, and the boot banner says
so. Read `README.md` and `docs/THREAT_MODEL.md` first if you haven't.

Each recipe specifies:

- the **environment** the operator must set,
- the **store** choice and why,
- the **secret rotation** procedure,
- the **log target** STILE will write to,
- the **healthcheck** an external monitor can hit.

If you're choosing between recipes, the short version:

| Setting                           | Choose                                |
| --------------------------------- | ------------------------------------- |
| Single small VM                   | **Recipe 1** (Node + reverse proxy)   |
| Vercel / serverless functions     | **Recipe 2** (api/handler.js)         |
| Cloudflare edge                   | **Recipe 3** (Worker adapter)         |
| Existing Express/Fastify/Hono app | **Recipe 4** (Middleware adapter)     |

---

## Recipe 1 — Single Node behind a reverse proxy

The default deployment shape. One Node process, one local store, one
reverse proxy in front (NGINX, Caddy, fly.io's edge, etc.) handling TLS
and rate limiting.

**Trust boundary**: the proxy is in your trust circle and normalizes
`X-Forwarded-For`. STILE binds to loopback or a private interface.

### Environment

```bash
# Required
STILE_SECRET=$(openssl rand -hex 32)
STILE_MODE=production            # or NODE_ENV=production
STILE_IP_SALT=$(openssl rand -hex 32)   # required in production — blocks boot if unset
STILE_STORE=file:/var/lib/stile/state.json
STILE_TIER=easy                  # or medium / strong

# Optional
STILE_WEBHOOK_URL=https://your-receiver.example.com/stile
STILE_WEBHOOK_SECRET=$(openssl rand -hex 16)

# Admin (optional — leave unset to disable)
STILE_ADMIN_PASSWORD=$(openssl rand -hex 16)

# Bind loopback so the reverse proxy is the only thing that talks to us
HOST=127.0.0.1
PORT=4173
```

### Store

`file:/var/lib/stile/state.json`. Single-process, single-writer. The
file gets atomic writes (temp + fsync + rename), so readers never see
partial JSON. **Do not run multiple processes against the same file.**

### Secret rotation

1. Generate a new secret: `openssl rand -hex 32`.
2. Replace `STILE_SECRET` in your secret manager.
3. Restart the process.

After restart all outstanding tokens and session cookies fail signature
check and clients re-verify. There is no overlap window — design for
this if your traffic is sensitive (do rotations during low-traffic
windows).

### Logs

STILE writes to stdout/stderr. Pipe through systemd / your runner:

```ini
# /etc/systemd/system/stile.service
[Service]
Environment="STILE_MODE=production"
EnvironmentFile=/etc/stile.env
ExecStart=/usr/bin/node /opt/stile/server.js
StandardOutput=journal
StandardError=journal
User=stile
Group=stile
Restart=on-failure
```

The boot banner is one place — grep it from `journalctl` to confirm
posture after deploy:

```
journalctl -u stile -n 30 | grep -A6 'STILE  ·'
```

### Healthcheck

There is no dedicated `/healthz`. Use `/api/peek` — it issues a
challenge, returns 200 with JSON, and doesn't mutate any
single-use state:

```
GET /api/peek → 200 application/json
```

Treat any non-200 as unhealthy. Check the `verify_url` field is present
in the response.

### Common mistakes

- Binding `HOST=0.0.0.0` without TLS in front. STILE refuses if
  `STILE_SECRET` is also weak; if it's strong, it'll boot and you've
  got an HTTP-only public endpoint.
- Multiple workers on one file store. Use a real store (Recipe-3
  KV / Recipe-2 KV) or one writer.
- Forgetting `STILE_IP_SALT`. Hashes are usable but cross-deployment
  joinable.

---

## Recipe 2 — Serverless (Vercel functions)

The `api/handler.js` entrypoint already wraps `createHandler()` for the
Vercel `(req, res)` signature. The same shape works for any Node-based
serverless host.

**Trust boundary**: the platform terminates TLS and sets
`X-Forwarded-For`. Cold starts are fine for the gate but kill any
in-process state.

### Environment

Set the same vars as Recipe 1, but:

- **Drop** `HOST` and `PORT` — the platform manages those.
- **Change** `STILE_STORE` to a backed store, never `memory` or
  `file`. The filesystem on a serverless function is ephemeral
  per-invocation; the in-memory store dies on cold start. Both leave
  your nonce single-use protection broken.

```bash
STILE_STORE=memory                # only acceptable if you accept that nonces
                                  # are single-use per cold instance
```

If you can tolerate that (low-traffic, demo-y use), `memory` works. For
real use, supply a custom store backed by Vercel KV / Upstash Redis /
your DB and pass it programmatically:

```js
// api/handler.js
const createHandler = require('stile/handler');
const myStore = require('./my-kv-store');   // matches the store contract

const handler = createHandler({ secret: process.env.STILE_SECRET, store: myStore });
module.exports = (req, res) => handler(req, res);
```

The store contract is documented in `docs/API.md §4`.

### Secret rotation

Update `STILE_SECRET` in the platform's env config. Trigger a redeploy.
There is no in-place rotation across warm instances — old instances
serving stale traffic until they're recycled will keep accepting the
old cookie until cookie TTL expires.

### Logs

Whatever the platform's log surface is. The boot banner runs once per
cold start; check for the `context PRODUCTION` line.

### Healthcheck

`GET /api/peek` — same as Recipe 1.

### Common mistakes

- Leaving `STILE_STORE=memory` (the default) and being surprised that
  nonce single-use protection doesn't survive cold starts.
- Setting `STILE_STORE=file:` on a serverless filesystem. The file
  vanishes between invocations.

---

## Recipe 3 — Cloudflare Worker

Use `lib/adapters/cf-worker.js`. The Worker runtime is Web Fetch, not
Node http; the adapter shims `Request`/`Response` into the gate.

**Trust boundary**: Cloudflare terminates TLS, sets
`CF-Connecting-IP`, and runs your script at the edge. Workers are not
multi-process per se but state in `globalThis` is per-isolate and
short-lived.

### Environment

Set as Worker secrets via `wrangler secret put`:

- `STILE_SECRET`
- `STILE_IP_SALT`
- `STILE_WEBHOOK_SECRET` (if used)

Compile-time options (in `wrangler.toml`):

```toml
name = "my-stile-edge"
main = "worker.js"
compatibility_date = "2026-01-01"

[vars]
STILE_TIER = "easy"
STILE_WEBHOOK_URL = "https://your-receiver.example.com/stile"

[[kv_namespaces]]
binding = "STILE_KV"
id = "<your-kv-namespace-id>"
```

### Store

The in-memory default does not survive across isolates. You **must**
supply a store backed by KV, a Durable Object, or D1. The store
contract is the same as everywhere else (`docs/API.md §4`).

A minimal KV-backed nonce store:

```js
function kvNonceStore(KV) {
  return {
    nonces: {
      async has(n) { return (await KV.get('nonce:' + n)) != null; },
      async add(n, expSec) {
        await KV.put('nonce:' + n, '1', { expiration: expSec });
      },
    },
    // events / agents / reputation / adopters: implement against KV / D1
  };
}
```

For high-throughput or strict single-use semantics across the planet,
use a Durable Object instead — KV is eventually consistent and the
race window can let a token redeem twice across colos.

### Secret rotation

`wrangler secret put STILE_SECRET`. Roll the new version. Old isolates
recycle within Cloudflare's window (~1m).

### Logs

`wrangler tail` for live, or pipe to Logpush for archive. The boot
banner doesn't run — `worker.js` is invoked per request.

### Healthcheck

`GET /api/peek` — works the same.

### Common mistakes

- Forgetting to pass `store` and getting per-isolate state.
- Using KV expecting strict single-use; for that, use a Durable Object.

---

## Recipe 4 — Middleware in an existing app

Drop into Express / Fastify / Hono / Next as a middleware. STILE
doesn't replace your app; it gates a subset of routes.

**Trust boundary**: same as your app. STILE inherits the proxy
configuration the app already has.

### Express

```js
const createStileExpress = require('stile/adapters/express');

app.use(createStileExpress({
  secret: process.env.STILE_SECRET,
  protect: ['/api/data', '/agents'],
  tier: 'easy',
  store: 'file:./stile-data.json',     // or your own store
}));
```

The middleware function exposes the underlying instance as
`.stile` for advanced uses (issuing challenges programmatically, etc).

### Fastify

```js
const createStileFastify = require('stile/adapters/fastify');

await app.register(createStileFastify({
  secret: process.env.STILE_SECRET,
  protect: ['/api/data', '/agents'],
}));
```

### Hono / Next

See `examples/hono` and `examples/next/middleware.ts`. The Hono
adapter shims Web Fetch into the gate; the Next adapter assumes the
`nodejs` runtime.

### Store

Pick the store that matches your app's deployment:

| App deploy        | Store choice                                  |
| ----------------- | --------------------------------------------- |
| Single Node       | `file:` or your DB                            |
| Multiple workers  | Redis / your DB / KV — must match the contract |
| Serverless        | Backed store (see Recipe 2)                   |
| Edge              | Durable Object (see Recipe 3)                 |

### Secret rotation

Rotate the env var, restart the app. Same caveats as Recipe 1.

### Logs

App's existing logger. The boot banner is from `server.js` and only
runs in the standalone demo — the adapters do not print it. To
replicate, log `report` from `config.load()` yourself.

### Healthcheck

You already have one. STILE doesn't add a probe surface beyond
`/api/peek` (which is only present if you mount `lib/handler.js`'s
demo router). For middleware integrations, write your own probe that
issues `stile.issueChallenge()` and asserts the result.

### Common mistakes

- Mounting the middleware *after* a body parser that has already
  consumed the request body. STILE's `/__stile-verify` reads its own
  body — keep STILE before any general body parser, or scope the
  parser to non-stile routes.
- Setting `protect` to overlap with a static-asset path. Static files
  served by your framework go through STILE too unless you scope it.

---

## Boot-banner posture sanity check

Whatever recipe you used, the first request after deploy should
show — in logs, console, or wherever you write — the equivalent of:

```
STILE  ·  http://...
─────────────────────────────────
context  PRODUCTION
secret   env STILE_SECRET
store    file (/var/lib/stile/state.json)   ← or your real store
admin    enabled (password protected)        ← or "disabled"
webhook  → your-receiver.example.com (signed)
tier     easy
```

If the `context` line says anything other than `PRODUCTION`, or the
`secret` line says `EPHEMERAL` or `DEMO`, **STOP**. The instance is in
demo posture. Fix the env and redeploy.
