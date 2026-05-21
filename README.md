# STILE

[![CI](https://github.com/rar-file/STILE-/actions/workflows/ci.yml/badge.svg)](https://github.com/rar-file/STILE-/actions/workflows/ci.yml)
[![License: MIT](https://img.shields.io/badge/license-MIT-blue.svg)](LICENSE)
[![Node](https://img.shields.io/badge/node-%3E%3D20-brightgreen.svg)](package.json)

A drop-in challenge that lets AI agents pass and humans never see.
Read this whole page before deploying it.

---

## What STILE is

A small HTTP middleware. When a client requests a protected path:

1. STILE serves a 401 + an HTML page (or JSON envelope) containing a
   signed, single-use **verification URL**.
2. The client (an AI agent / LLM-driven script) follows the URL, optionally
   echoes a **challenge word**, and optionally declares an **agent**
   identifier.
3. STILE issues a session cookie. Subsequent requests pass through.

That is the whole protocol. The hidden block is repeated across five
mutually-redundant channels (HTML comment, JSON-LD, `aria-hidden`
clipped text, SVG `<title>`, `<meta>` tags) so that any reasonable HTML
parser can find it. Humans never see it.

---

## What STILE proves

A successful verification proves that the client at the time of the
request:

- Could parse the page well enough to extract one URL and fetch it.
- Held a token whose HMAC signature matches your `STILE_SECRET` and
  whose expiry is in the future.
- Used a token whose nonce has not been redeemed before **on this STILE
  instance, against this store**.
- (`tier=medium`+) relayed the challenge word from that same page.
- (`tier=strong`) declared a self-chosen `agent=<name>` string.

That's it. STILE provides a structured, low-friction *signal* that a
specific request came from a client willing to identify itself as an AI
agent.

## What STILE does NOT prove

Be honest with yourself about the size of the gap here.

- **Who the agent actually is.** `agent=anthropic/claude-3.5` is a
  self-declared string. STILE does not verify it. (mTLS and
  Web Bot Auth fast-paths can verify a signer — see below — but the
  challenge flow does not.)
- **That the client is "really" an LLM.** A 20-line script that
  regex-extracts the verify URL passes too. STILE distinguishes "willing
  to identify and parse" from "indifferent scraper," not "machine" from
  "model."
- **That the agent will respect anything you say on the page.** Stated
  rate limits, terms, scopes — none of that is enforced by STILE.
- **That subsequent requests come from the same client.** The session
  cookie is a stateless HMAC. Anyone holding it for the TTL is treated
  as verified, like any cookie-based session.
- **That a token can't be replayed across processes.** Single-use
  protection lives in the *store*. If your store is per-process (e.g.
  the in-memory default with N processes), the same token can be redeemed
  once per process.
- **That the client's IP / UA is what it claims.** STILE records hashes
  of the IP and UA reported by the request and an upstream proxy is
  trusted by default.
- **Anything cryptographic about the human or company behind the
  agent.** Use a separate identity layer (auth, mTLS, signed contracts)
  for that.

If your endpoint controls money, account access, or anything you'd be
upset to lose, STILE is not your auth layer. It's a signal you can
combine with your real auth layer.

---

## Who it's for

- Operators publishing content they're happy for AI agents to fetch, who
  want a cleaner signal than "everything that doesn't look like Chrome
  is a scraper."
- Developers building AI agents who want a polite, deterministic way to
  identify their client at the protocol level.
- Researchers measuring agent traffic with consent on both sides.

It's not for protecting payment endpoints, login flows, or anything
where impersonation cost is high. It's also not a CAPTCHA replacement
for *human* gates — humans don't see the challenge, by design.

---

## What counts as verification

A request to `/__stile-verify` succeeds when **all** of the following hold:

| Check                                                           | Always | Tier=medium+ | Tier=strong |
| --------------------------------------------------------------- | :----: | :----------: | :---------: |
| Token signature matches `STILE_SECRET`                          |   ✓    |      ✓       |      ✓      |
| Token expiry is in the future (`challengeTtl`, default 180s)    |   ✓    |      ✓       |      ✓      |
| Token's nonce has not been redeemed before in this store        |   ✓    |      ✓       |      ✓      |
| Request includes the challenge `word` from the page             |        |      ✓       |      ✓      |
| Request includes an `agent` identifier (3–64 chars, sanitized)  |        |              |      ✓      |

A successful verify sets a session cookie (`stile=…`, `HttpOnly`,
`SameSite=Lax`, `Path=/`, `Max-Age=ttl`). The cookie is a stateless
HMAC — its validity is checked by signature and expiry on every gated
request.

There are also two **fast-paths** that bypass the challenge entirely:

- **Web Bot Auth (RFC 9421 HTTP Message Signatures)** — if the request
  carries an Ed25519 signature over a fixed component set
  (`@method`, `@authority`, `@path`) verifiable against a `keyId` in
  your `webBotAuth.trustedSigners` list, STILE issues a session
  immediately. The signed identity is recorded.
- **mTLS** — if the connection presents a client certificate pinned by
  SHA-256 fingerprint or matched by a Subject regex, STILE issues a
  session. Two ingestion modes: `native` (read directly off the TLS
  socket) and `proxy` (trust `X-Client-Cert-SHA256` from a known
  upstream IP).

Fast-path verifications are recorded with `tier: 'fast-path'` and a
`fast_path` field naming the channel.

---

## What an attacker can still do

A short list of failure modes by design or by configuration. Read this
before pointing STILE at real traffic.

1. **Mint tokens with a leaked secret.** If `STILE_SECRET` leaks, any
   client can forge tokens until you rotate. There is no per-token
   revocation — rotate the secret to invalidate everything outstanding.
2. **Run with the demo secret.** STILE will shout about it but will
   technically run if you set `STILE_MODE=demo`. Don't do this in
   production. The demo string is published in the source — it is
   not a secret.
3. **Replay a token across processes if your store is split.** The
   in-memory store gives single-use semantics *per process*. With N
   workers and no shared store, a token can be redeemed up to N times.
4. **Resell a session cookie.** The session is stateless. Anyone with
   the cookie for the TTL window passes the gate. Limit blast radius
   with short `ttl`.
5. **Lie about agent identity.** `tier=strong` requires the request to
   carry an `agent=name/version` string. STILE does not verify this is
   the actual agent. Use the webhook + your own downstream
   rate-limiting or ban-listing if accountability matters.
6. **Bypass the honeypot.** The honeypot decoy is intentionally
   announced in the page ("DO NOT FOLLOW"). It catches indiscriminate
   scrapers that ignore the on-page instructions. A careful attacker
   reads the instructions and skips it.
7. **Correlate IP hashes across deployments.** With `STILE_IP_SALT`
   unset, all instances use the same public default salt. An adversary
   with logs from two deployments can join on `ip_hash`. Set a unique
   salt per deployment.
8. **Trust an unauthenticated upstream proxy.** STILE reads
   `X-Forwarded-For` for `remoteIp` without verifying the upstream.
   Run STILE behind a proxy you control, or strip the header at your
   edge.
9. **Exhaust the store.** Events, agents, and reputation grow with
   traffic. Both in-memory and file stores cap events at `maxEvents`
   (default 50,000). A determined adversary can fill the cap and roll
   older events out.
10. **Ride a fast-path with a stolen TLS cert / signing key.** mTLS and
    Web Bot Auth verify *the holder of a key*, not *who they are*.
    Treat compromise the same as any TLS-cert / signing-key compromise.

---

## What operators must configure correctly

The minimum bar for production. STILE refuses to boot in production if
any of these are wrong; it warns loudly in dev/demo.

- **`STILE_SECRET`** — set to a real ≥32-character value. `openssl rand
  -hex 32`. Treat it like a cookie-signing secret. Rotate to revoke all
  outstanding sessions.
- **`STILE_MODE`** — leave unset. STILE detects production from
  `NODE_ENV=production` or any of the standard host indicators
  (`VERCEL`, `FLY_APP_NAME`, `RENDER`, `K_SERVICE`, etc.). Set it
  explicitly to `demo` only if you understand you're shipping unsafe
  defaults.
- **`STILE_ADMIN_PASSWORD`** — ≥12 chars, not on the
  known-weak list. Leave unset to disable admin entirely. Anything
  weaker is rejected at boot.
- **`STILE_IP_SALT`** — set to a per-deployment random value if you
  care about cross-deployment hash correlation, log handoff, or any
  privacy claim about IPs.
- **`STILE_STORE`** — `memory` is fine for single-node demos. For real
  use, choose:
  - `file:./stile-data.json` for single-node persistence (single-writer,
    not multi-process safe — see `docs/DEPLOY.md`).
  - your own store object (KV, Redis, Postgres, Durable Object) for
    multi-process / multi-region.
- **`STILE_WEBHOOK_URL`** — must be `https://` in production.
  `STILE_WEBHOOK_SECRET` must be ≥16 chars when set. Receivers MUST
  verify `X-Stile-Signature: sha256=…`.
- **Bind host** — STILE refuses to start with a non-loopback `HOST` and
  no real secret. Don't bypass this; it exists because pointing a toy
  instance at the open internet is the most common foot-gun.

If `config.load()` reports `blocked: true`, **exit 1**. Don't try to
recover — the failures are config errors, not transients.

---

## Quickstart

```bash
npm install stile
```

```js
const http = require('http');
const createStile = require('stile');

const stile = createStile({
  secret: process.env.STILE_SECRET,   // required in prod
  protect: ['/agents', '/api/data'],
  tier: 'easy',
});

http.createServer(stile.wrap((req, res) => {
  // Anything reaching here is verified
  res.end('Hello, agent.');
})).listen(3000);
```

Or, more typically, drop the demo server in:

```bash
git clone https://github.com/rar-file/STILE-.git stile
cd stile
node server.js
```

…then visit `http://localhost:4173`. Read the startup banner — it tells
you exactly what posture this instance is running in.

For real deployment recipes, see `docs/DEPLOY.md`. For the trust
boundary in detail, see `docs/THREAT_MODEL.md`. For the supported public
API, see `docs/API.md`.

---

## Contributing

PRs and issues welcome. See [`CONTRIBUTING.md`](CONTRIBUTING.md) for
the development setup and what to expect during review. For
vulnerability reports, see [`SECURITY.md`](SECURITY.md) — please don't
file security issues in public.

Release notes live in [`CHANGELOG.md`](CHANGELOG.md).

---

## License

MIT.
