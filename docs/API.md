# STILE — Public API

This document defines the **stable, supported** surface of the `stile`
package. Anything not listed here is internal — it may change in a patch
release without notice. If you depend on something not documented here, open
an issue and we'll either promote it or give you a supported alternative.

Versioning follows semver: breaking changes in this document mean a new
major. Behavior changes that are not on this surface do not.

---

## 1. Package exports

The package's `package.json` declares exactly these subpath exports:

| Specifier                         | Returns                          |
| --------------------------------- | -------------------------------- |
| `stile`                           | `createStile` factory            |
| `stile/config`                    | config loader (see §6)           |
| `stile/store-memory`              | `createMemoryStore` factory      |
| `stile/store-file`                | `createFileStore` factory        |
| `stile/adapters/express`          | `createStileExpress` factory     |
| `stile/adapters/fastify`          | `createStileFastify` factory     |
| `stile/adapters/hono`             | `createStileHono` factory        |
| `stile/adapters/next`             | `createStileNext` factory        |
| `stile/adapters/cf-worker`        | `createCfWorkerHandler` factory  |

There is also a deprecated alias `createAiCaptcha` re-exported from `stile`
that emits a console warning. **Will be removed in 1.0.** Use `createStile`.

---

## 2. `createStile(options) → instance`

`require('stile')` returns the factory. All options are optional unless
noted; defaults shown.

```js
const createStile = require('stile');

const stile = createStile({
  // --- Identity / cryptography ----------------------------------------
  secret:        null,        // required in production. ≥32 chars. If null,
                              //   an ephemeral random one is used (sessions
                              //   die on restart).
  ttl:           3600,        // session cookie TTL, seconds.
  challengeTtl:  180,         // single-use challenge token TTL, seconds.
  cookieName:    'stile',     // session cookie name.
  verifyPath:    '/__stile-verify',
  ipHashSecret:  null,        // HMAC salt for IP hashes in events.

  // --- What to gate ----------------------------------------------------
  protect:       [],          // path prefixes that require verification.
  tier:          'easy',      // 'easy' | 'medium' | 'strong'. See §3.
  honeypot:      true,        // expose a decoy URL agents must NOT follow.

  // --- Output channels -------------------------------------------------
  stealth:       'all',       // which AI-readable channels to emit.
                              // One of: 'all' | 'aria-hidden' | 'svg'
                              //       | 'css' | 'data-attr' | 'none'
                              //       | string[] of those values.
  challengeWord: null,        // override the random challenge word.

  // --- Storage (state) -------------------------------------------------
  store:         null,        // see §4. null → in-memory.
  storePath:     null,        // when store === 'file', the JSON path.

  // --- Optional fast-paths --------------------------------------------
  webBotAuth:    null,        // { trustedSigners: [{ keyId, name, publicKeyPem }] }
  mtls:          null,        // { trustedCerts: [...], mode, allowedProxyIPs }
  rules:         null,        // { allow: [...], deny: [...], geoLookup }
  reputationFloor: 0,         // 0 disables; >0 forces stricter tier; <20 blocks.

  // --- Side channels ---------------------------------------------------
  onVerify:      null,        // function(info, req) called on successful verify.
  webhook:       null,        // { url, secret } — see §5.
});
```

### 2.1 Returned instance

The instance is the supported public surface. **You can rely on these
methods existing with these shapes:**

```ts
{
  // Middleware factories
  middleware()   // (req, res, next) — Connect/Express style
  wrap(handler)  // (handler) → (req, res) — wraps a Node http handler
  gate(req, res) // returns true if it ended the response, false if not

  // Session inspection
  isVerified(req)        // bool
  sessionInfo(req)       // { agent, fast_path } | null

  // Building blocks (advanced)
  issueChallenge(override?)        // { token, word, exp, tier, nonce }
  verifyChallenge(token)           // claim | null
  challengeBlock(challenge)        // multi-channel HTML string
  injectIntoHtml(html, challenge)  // HTML with the block injected before </body>
  jsonChallenge(challenge)         // JSON envelope (for non-HTML clients)
  headerChallenge(challenge)       // X-Stile-Challenge header value

  // Stores & adapters (advanced — escape hatches)
  store      // see §4
  honeypot   // honeypot helpers; null when honeypot:false
  options    // resolved options, frozen — read-only

  // Cookie issuance (only useful if you bypass middleware)
  issueSession(meta?)   // raw cookie value
  verifySession(cookie) // session info | null
}
```

Anything else attached to the instance (mostly closures) is **not**
public — read it at your own risk.

---

## 3. Tiers

Tier controls what a verifying agent must prove. The trade is precision vs
inclusivity: stronger tiers reject more legitimate small models.

| Tier     | Required at `/__stile-verify`                                              | Agent capability needed                        |
| -------- | -------------------------------------------------------------------------- | ---------------------------------------------- |
| `easy`   | Just relay the signed token.                                               | Parse HTML and extract a value. Any LLM.       |
| `medium` | Token + the human-readable challenge word from the page.                   | Parse HTML, locate the `aria-hidden` word.     |
| `strong` | Token + word + a self-declared `agent` identifier (`agent=name/version`).  | Same as `medium` + ability to self-identify.   |

A `fast-path` tier is also recorded in events when the request was admitted
via Web Bot Auth, mTLS, or an `allow` rule — bypassing the challenge.

**Choosing a tier:** `easy` gates the vast majority of dumb scrapers and
headless browsers while passing all capable LLM agents. `medium` additionally
requires that the agent parse and echo a specific word, filtering models that
cannot reliably handle hidden HTML. `strong` adds identity declaration, which
is useful for auditing which specific agents are accessing your service.
There is no tier that verifies the agent's claimed identity — use Web Bot Auth
(`webBotAuth`) for cryptographically authenticated fast-path admission.

### Verify flow

The decision tree inside `/__stile-verify` (all steps must pass):

```
Request to /__stile-verify
│
├── Parse token from ?token= query param or POST body
│     └── Missing / malformed → 400 invalid_or_expired_challenge
│
├── Verify HMAC signature over token fields
│     └── Signature mismatch → 400 invalid_or_expired_challenge
│
├── Check expiry (challengeTtl, default 180 s)
│     └── Expired → 400 invalid_or_expired_challenge
│
├── Check nonce not already used (single-use enforcement)
│     └── Already used → 409 challenge_already_used
│
├── Tier: medium or strong → require ?word= matches token word
│     └── Missing / wrong → 400 challenge_word_required
│
├── Tier: strong → require ?agent= is present and non-empty
│     └── Missing → 400 agent_declaration_required
│
├── Mark nonce used in store
│
├── Record event (kind: 'verified') + fire webhook
│
└── Set session cookie → 200 { ok: true, verified: true, ... }
```

Any path that reaches a 4xx does **not** consume the nonce — the agent
may obtain a fresh challenge and retry.

---

## 4. Store contract

A store is any object matching this shape:

```ts
{
  nonces: {
    has(nonce: string): boolean
    add(nonce: string, expSec: number): void      // expSec is seconds-since-epoch
    consume?(nonce: string, expSec: number): boolean  // optional — atomic check-and-add.
                                                       // Returns true if nonce was new (proceed);
                                                       // false if already present (reject replay).
                                                       // When present, stile uses this instead of
                                                       // has()+add(). Implement atomically in
                                                       // multi-process stores (KV, Redis, etc.).
  }
  events: {
    record(event: { kind: string, ts?: number, ... }): event
    summary(rangeMs: number): { range_ms, series, totals, top_agents, tiers, total_events }
    counterToday(): number
    counterAllTime(): number
    subscribe(listener: (event) => void): () => void  // returns unsubscribe
  }
  agents: {
    list({ minVerifications?, limit? }): AgentSummary[]
    get(name: string): AgentSummary | null
  }
  reputation: {
    get(identity: string): { identity, score: 0..100, counters, updated_at }
    record(identity: string, change: { verifications?, decoy_hits?, ratelimit_hits? }): rep
    list({ limit? }): rep[]
  }
  adopters: {
    upsert(domain: string, info?): adopter
    setStatus(domain: string, status: string): adopter | undefined
    list({ status? }): adopter[]
    get(domain: string): adopter | null
  }
}
```

Two stores are shipped:

- **`createMemoryStore()`** — in-process, lost on restart. Default.
- **`createFileStore({ filePath, ... })`** — JSON file with debounced atomic
  writes + fsync. **Single-process only.** See `docs/DEPLOY.md` for limits.

`createStile` accepts shorthands on the `store` option:

| Value              | Behavior                                              |
| ------------------ | ----------------------------------------------------- |
| `null` / unset     | in-memory                                             |
| `'memory'`         | in-memory                                             |
| `'file'`           | file store at `./stile-data.json` (or `storePath`)    |
| `'file:./x.json'`  | file store at `./x.json`                              |
| object             | used directly — must match the contract above         |

Anything beyond what's listed is internal: in particular, helpers like
`store._flushNow` and `store._filePath` exist for tests / diagnostics and
are **not** stable.

---

## 5. Webhook contract

If `webhook: { url, secret }` is set, every verification fires a POST:

```
POST <url>
Content-Type: application/json
User-Agent: stile-webhook/1
X-Stile-Signature: sha256=<hex hmac of body using secret>

{
  "event": "verify",
  "version": 1,
  "info": {
    "kind":     "verified",
    "agent":    "<self-declared, sanitized>" | null,
    "tier":     "easy" | "medium" | "strong" | "fast-path",
    "ip_hash":  "<16 hex chars>" | null,
    "ua_hash":  "<16 hex chars>" | null,
    "fast_path": "web-bot-auth" | "mtls" | "playground" | null,
    "ts":       <unix ms>
  }
}
```

Receivers MUST verify the signature. Retries: up to 3 attempts with
exponential backoff on 5xx and network errors. Fire-and-forget — never
blocks the verify response.

---

## 6. Config layer

`require('stile/config')` exposes:

```ts
{
  load({ env? }): { context, values, checks, issues, warnings, blocked }
  renderReport(report): string
  detectContext(env): 'production' | 'demo' | 'dev'
  isWeakPassword(s): boolean
  isLoopbackPeer(req): boolean
  DEMO_SECRET: string
  DEMO_ADMIN_PASSWORD: string
  KNOWN_WEAK_PASSWORDS: Set<string>
  PROD_ENV_KEYS: string[]
}
```

Use `load()` once at boot, render the report, and pass the result into
`createHandler({ config: report })` (or wire `report.values` into your own
`createStile` call). If `report.blocked === true`, **exit 1** — production
boot is refused on unsafe configuration.

Recognized environment variables:

| Var                    | Purpose                                           |
| ---------------------- | ------------------------------------------------- |
| `STILE_MODE`           | `production` | `demo` | `dev` (overrides detection) |
| `STILE_SECRET`         | HMAC secret. ≥32 chars in prod.                   |
| `STILE_ADMIN_PASSWORD` | Admin dashboard password (≥12 chars in prod).     |
| `STILE_IP_SALT`        | HMAC salt for IP hashes in events.                |
| `STILE_TIER`           | Default tier.                                     |
| `STILE_WEBHOOK_URL`    | Webhook target (https in prod).                   |
| `STILE_WEBHOOK_SECRET` | Webhook signing secret (≥16 chars).               |
| `STILE_STORE`          | `memory` | `file` | `file:./path.json`            |
| `STILE_STORE_PATH`     | When using file store, the JSON path.             |
| `HOST`                 | Bind host (sanity-checked vs secret strength).    |

Any other `process.env` key is read by user code, not by stile.

---

## 7. HTTP surface

Routes mounted by the gate (always reserved on the host):

| Path                    | Method    | Description                                             |
| ----------------------- | --------- | ------------------------------------------------------- |
| `/__stile-verify`       | GET, POST | Token-redemption endpoint. Returns session cookie.      |
| `/__stile-decoy`        | GET       | Honeypot (issued only when honeypot is on).             |
| `/health`               | GET, HEAD | Store connectivity probe. Returns `{ ok, store, uptime }` where `store` is `memory`/`file`/`custom`. `200` when healthy, `503` when the store is unreachable. Other methods → `405`. |

Response shape from `/__stile-verify` on success (`200`):

```json
{
  "ok": true,
  "verified": true,
  "protocol": "stile/v1",
  "message": "...",
  "session_ttl": 3600,
  "challenge_word_echo": "<word>",
  "tier": "<tier>",
  "agent_echo": "<agent or null>"
}
```

On rejection (`400` / `409`):

```json
{ "error": "invalid_or_expired_challenge" }
{ "error": "challenge_word_required",  "expected_field": "word"  }
{ "error": "agent_declaration_required", "expected_field": "agent" }
{ "error": "challenge_already_used" }
```

Error codes are stable. The accompanying `message` text is not.

---

## 8. Adapter contracts

All adapters take the same options as `createStile` and return either a
middleware function (Express/Fastify/Hono/Next) or a request handler
(cf-worker). Each adapter exposes the underlying `stile` instance on the
returned function as `.stile` for advanced callers (Express + Fastify);
others can call `createStile` themselves if they need direct access.

---

## 9. Internal — not stable

The following exist but are **explicitly internal**, will change without
notice, and should not be imported:

- `lib/handler.js`, `lib/handler/*` — the demo server's URL routing
- `lib/admin.js` — the demo dashboard
- `lib/honeypot.js`, `lib/web-bot-auth.js`, `lib/mtls.js`, `lib/rules.js`,
  `lib/webhook.js`, `lib/phrasings.js` — used through `createStile`, not
  directly
- `_flushNow`, `_filePath` on the file store
- The `options` field on a stile instance is read-only; mutating it has
  undefined behavior
- The fallback gate HTML page rendered by `createStile` when no host page
  exists is intentionally undocumented — write your own gate page for
  branded surfaces
