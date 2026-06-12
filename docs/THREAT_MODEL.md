# STILE — Threat Model

Companion to `README.md`. The README states what STILE proves and
doesn't; this document explains *why*, names the trust boundary, and
enumerates threats with the mitigation (or non-mitigation) for each.

If you're reviewing STILE for production use, this is the document to
read end-to-end.

---

## 1. Trust boundary

```
                    ┌─────────────────────────┐
                    │   Open internet         │
                    │   (clients, agents)     │
                    └────────────┬────────────┘
                                 │
                  HTTP(S)        │  X-Forwarded-For, headers
                                 ▼
                    ┌─────────────────────────┐
                    │   Reverse proxy / CDN   │   ← OPERATOR-CONTROLLED
                    │   (CloudFront, NGINX,   │     trust assumed
                    │    fly.io, vercel)      │
                    └────────────┬────────────┘
                                 │
                                 ▼
            ┌────────────────────────────────────────┐
            │  STILE process                         │
            │  ───────────                           │
            │  • verifies challenge tokens (HMAC)    │
            │  • issues session cookies (HMAC)       │
            │  • single-use nonce → store            │
            │  • emits events → store + webhook      │
            │  • runs admin dashboard (optional)     │
            └────────────┬───────────────┬───────────┘
                         │               │
                         ▼               ▼
                ┌─────────────┐    ┌──────────────┐
                │   Store     │    │   Webhook    │
                │ (mem/file/  │    │  receiver    │
                │  custom)    │    │ (operator)   │
                └─────────────┘    └──────────────┘
```

Inside the boundary STILE assumes:

- The reverse proxy can be trusted to set `X-Forwarded-For` correctly,
  or stile is bound to loopback / a private network so the header is
  irrelevant.
- The store is reachable, single-writer (or has its own concurrency
  control), and not adversarial.
- The webhook receiver verifies signatures.
- `STILE_SECRET` and `STILE_WEBHOOK_SECRET` are not leaked outside the
  process / config layer.

Outside the boundary STILE assumes nothing — every request and every
header is potentially adversarial.

---

## 2. Assets

What STILE is protecting, in order of importance:

1. **Integrity of the verification signal.** The fact that an event of
   `kind: 'verified'` was recorded must mean someone successfully
   redeemed a non-replayed, signed token within its TTL.
2. **The signing secrets** (`STILE_SECRET`, `STILE_WEBHOOK_SECRET`,
   honeypot key derived from `STILE_SECRET`).
3. **The store** — events, nonces, agent reputations, adopters.
4. **The admin dashboard** (when enabled).
5. **Operator privacy claims** about IPs (`ip_hash` opacity across
   deployments).

What STILE explicitly is NOT protecting:

- The downstream application. Anything past the gate is the operator's
  responsibility.
- The identity of the agent (`agent=name/version` is unverified
  free-text in the challenge flow).
- Confidentiality of the page that hosts the challenge — the challenge
  block is intentionally public.
- Resource exhaustion at the network edge (use a reverse proxy).

---

## 3. Assumptions

Stated explicitly so that you know when they don't hold:

- **A1 — Cryptographic assumption.** HMAC-SHA-256 with a ≥32-byte
  secret is unforgeable. Ed25519 (Web Bot Auth fast-path) provides EUF-CMA
  signatures.
- **A2 — Time.** `Date.now()` is monotonic and roughly correct (±60s).
  Tokens have a 180s default TTL; clock skew at that scale rejects
  legitimate requests but does not let expired tokens pass.
- **A3 — Single writer per store file.** The file store has no inter-process
  locking. We assume one process writes to a given file at a time.
- **A4 — Trusted proxy.** When STILE is run behind a reverse proxy and
  reads `X-Forwarded-For`, the proxy is assumed to set it correctly and
  to strip whatever the client supplied.
- **A5 — Honest secret distribution.** `STILE_SECRET` reaches the
  process via a channel the operator considers safe (env var, secret
  manager, etc.).
- **A6 — Honest receiver.** Webhook receivers verify the
  `X-Stile-Signature` header. STILE does not retry indefinitely on
  failure.

Violating any of these voids the corresponding mitigations below.

---

## 4. Threats

For each: **what** the attacker can do, **what stops them**, **what
doesn't**, and **what the operator must do**.

### T1. Token forgery

> An attacker mints a valid challenge token without observing one.

- **Stops it:** HMAC-SHA-256 over `c2.<nonce>.<exp>.<word>.<tier>` with
  `STILE_SECRET`. `crypto.timingSafeEqual` for compare. (A1.)
- **Doesn't stop it:** A leaked or weak secret. The literal demo
  secret is published in the source.
- **Operator action:** Set a real ≥32-char `STILE_SECRET`. Rotate on
  any suspicion of leak — there is no per-token revocation.

### T2. Token replay

> An attacker captures a valid token (e.g. via a shared proxy log) and
> redeems it more than once.

- **Stops it:** Single-use nonce in `store.nonces`. The nonce is
  recorded for `exp - now` and rejected on second redemption with
  `409 challenge_already_used`.
- **Doesn't stop it:** Multi-process deployments where each process
  has its own in-memory store — the same token is single-use *per
  process*. Or replays after `exp`, which fail signature/expiry instead
  but for a different reason.
- **Operator action:** For multi-process or multi-region, configure a
  shared store. The file store is single-writer; for N writers, use a
  KV / Redis / Durable Object that matches the store contract.

### T3. Session-cookie theft / resale

> An attacker steals a session cookie and reuses it.

- **Stops it:** Cookie is HMAC-signed; can't be modified. `HttpOnly`,
  `SameSite=Lax`, `Path=/` reduce JS-side exfiltration.
- **Doesn't stop it:** Cookie sent over plain HTTP between proxy and
  STILE; theft via TLS-terminating logs; theft via XSS in the
  downstream app. Anyone with the cookie for the TTL window is
  verified.
- **Operator action:** TLS at the proxy. Short `ttl` (default 1h —
  consider lowering for high-value endpoints). Set the cookie scope
  narrower if the gate doesn't need to apply to `/`.

### T4. Agent identity spoofing

> An attacker declares `agent=anthropic/claude-3.5` while running
> something else.

- **Stops it:** Nothing, in the challenge flow. The string is
  sanitized (3–64 chars, alnum / `_-./`) and recorded.
- **Doesn't stop it:** All of it. STILE deliberately does not verify
  agent identity in the cheap path.
- **Operator action:** If verified identity matters, require the
  Web Bot Auth or mTLS fast-path. Or feed `info.agent` into a
  downstream identity system you trust.

### T5. Replay of a fast-path signature

> An attacker captures a Web Bot Auth signature and replays it.

- **Stops it:** Signed `created` timestamp, validated against
  `Date.now()` with `maxAgeSec` (default 60s). Signature covers
  `@method`, `@authority`, `@path` so it can't be moved to a
  different request without forging.
- **Doesn't stop it:** Replay within the 60s window against the same
  endpoint. Add nonce / replay protection upstream if your threat
  model requires it.

### T6. Honeypot bypass

> An attacker reads the page, sees the "DO NOT FOLLOW" decoy URL, and
> doesn't follow it.

- **Stops it:** Nothing. The honeypot is a self-disclosing trap. By
  design, careful clients pass.
- **Catches:** Indiscriminate scrapers that follow every `<a>` they
  find.
- **Operator action:** Don't rely on the honeypot for primary defense.
  Use it as one signal among others — a decoy hit recorded against an
  IP should weight further requests.

### T7. Honeypot poison-cookie tampering

> An attacker tries to bypass the post-honeypot block by stripping or
> forging the poison cookie.

- **Stops it:** Stripping it works (the gate just challenges them
  again, not bypasses). Forging is HMAC-protected. The block is a
  weak deterrent, not an authorization control.

### T8. Store tampering

> An attacker writes to the store file directly, e.g. clearing nonces
> or inflating reputation.

- **Stops it:** Filesystem permissions on the store file (operator
  responsibility). STILE does not authenticate its own store.
- **Operator action:** The file store should be writable only by the
  STILE process owner. If your threat model includes other tenants on
  the same host with write access, use a remote store with its own
  auth.

### T9. Admin dashboard compromise

> An attacker accesses `/admin/stats` and reads aggregate data, or
> brute-forces the password.

- **Stops it:** HTTP Basic with `crypto.timingSafeEqual` against a
  SHA-256 of the password. Refused at boot if the password is weak or
  on the known-weak list. When unset in dev, the demo password is
  loopback-only.
- **Doesn't stop it:** Brute force at scale (no rate limit on the
  admin endpoint).
- **Operator action:** Long unique password, or keep admin disabled and
  consume `summary()` directly via a host-private route.

### T10. Untrusted upstream proxy

> The operator runs STILE without a trusted proxy and an attacker sets
> `X-Forwarded-For: 127.0.0.1` to look like the loopback peer.

- **Stops it:** Nothing for the admin loopback check — STILE reads
  `X-Forwarded-For` first. For the rate limiter and event IP hashing,
  setting `trustProxy: false` on `createStile` ignores `X-Forwarded-For`
  and keys on the socket peer, so a client facing STILE directly cannot
  rotate the header to mint fresh rate-limit buckets.
- **Operator action:** When fronted by a trusted proxy, leave
  `trustProxy: true` (default) and ensure the proxy overwrites
  `X-Forwarded-For`. When STILE faces clients directly, set
  `trustProxy: false`. Either way, bind STILE to loopback or strip
  `X-Forwarded-For` at the edge so the admin loopback check can't be
  spoofed.

### T11. IP hash correlation across deployments

> An attacker with logs from two STILE deployments joins them on
> `ip_hash`.

- **Stops it:** A unique `STILE_IP_SALT` per deployment. As of v0.4 the
  config layer **refuses to boot in production** when `STILE_IP_SALT` is
  unset or set to the published default — there is no longer a silent
  shared-default fallback.
- **Doesn't stop it:** Reused salts across deployments — operators sharing
  one value across hosts collapse the salt's protection. Each deployment
  needs its own.
- **Operator action:** Always set a unique `STILE_IP_SALT` per deployment
  in production (`openssl rand -hex 32`). In dev/demo, an ephemeral random
  salt is synthesized per process; hashes will not correlate across
  restarts.

### T12. Webhook MITM / replay

> An attacker intercepts the webhook POST to your receiver.

- **Stops it:** TLS to the receiver (operator responsibility) +
  `X-Stile-Signature: sha256=…` HMAC over the request body.
- **Doesn't stop it:** A receiver that doesn't verify the signature.
  STILE has no way to enforce that.
- **Operator action:** Enforce HTTPS in `STILE_WEBHOOK_URL`. Verify
  `X-Stile-Signature` on every receipt. Drop unverified payloads.

### T13. Resource exhaustion

> An attacker drives traffic to fill the events buffer, fill the file
> store, or burn CPU on signature verification.

- **Stops it:** `maxEvents` (default 50,000) caps the events array;
  older events roll out. Daily counters and reputation grow but
  bounded by distinct agents/days. The optional
  `rateLimit: { windowMs, maxAttempts }` option on `createStile` (v0.4+)
  enables a store-backed per-IP-hash limit on `/__stile-verify` that
  returns `429 + Retry-After` once the threshold is exceeded — this
  caps HMAC-verification CPU at the gate layer without needing a proxy
  in front.
- **Doesn't stop it:** Network-level DoS. Attacks that don't hit the
  verify endpoint (e.g. flooding the gated path with no token, which
  short-circuits to a cheap 401 but still consumes a request).
- **Operator action:** Enable `rateLimit` for defense-in-depth, but also
  run STILE behind a proxy with rate limiting and request-size caps.
  The handler caps body reads at 16 KB, but headers and connection-level
  abuse are upstream concerns.

### T14. Secret leak via logs

> A debug log emits the session cookie or the secret.

- **Stops it:** STILE does not log either. The demo banner reports
  *source* of secret, not value.
- **Doesn't stop it:** Operator code that logs `Set-Cookie`. Crash
  dumps containing process env. CI logs containing the env.
- **Operator action:** Standard secret-hygiene — never log
  `Authorization`, `Cookie`, `Set-Cookie`, or `process.env`.

### T15. Demo-mode reaching production

> Someone deploys with `STILE_MODE=demo` set in prod.

- **Stops it:** STILE warns at boot. The demo secret is rejected even
  in demo mode in *detected* production via a defense-in-depth check.
- **Doesn't stop it:** A motivated misconfiguration that explicitly
  sets `STILE_MODE=demo` and overrides the detected production
  context.
- **Operator action:** Don't set `STILE_MODE=demo` in production
  config. Audit your env at deploy time.

---

## 5. Residual risks

Things that are not mitigated and won't be:

- **Self-declared agent identity is unverified** (T4). This is a
  *design* choice — STILE's value is friction-free admission, and
  forcing every agent to enroll a key would defeat that. If you need
  cryptographic identity, use Web Bot Auth or mTLS as fast-paths and
  ignore the challenge flow.
- **Honeypot is self-disclosing** (T6). Same trade — the page must be
  parseable by any LLM, including a careful one.
- **Stateless session cookie can be stolen** (T3). Inherent to any
  stateless cookie. Use a short TTL or move to server-side sessions
  with your own store.
- **Multi-writer file store loses data** (T2 / A3). Documented; if you
  have N writers, use a real store.

---

## 6. Out of scope

These are real concerns, but STILE does not address them:

- **Bot management at the network layer.** Use a CDN / WAF for that.
- **DDoS mitigation.** Use a CDN / WAF for that.
- **Authentication of human users.** Use a real auth provider.
- **Authorization of post-gate actions.** STILE only gates; the
  downstream app authorizes.
- **Audit logging beyond the events store.** Pipe `subscribe()` output
  into your own log aggregator.

---

## 7. Required operator config (for production)

A minimal checklist. Mirrors `README.md` — repeated here so this
document stands alone.

- [ ] `STILE_SECRET` ≥ 32 chars, randomly generated, in a secret
      manager / env var.
- [ ] `STILE_IP_SALT` set, unique per deployment.
- [ ] `STILE_STORE` set to a multi-writer-safe store if you run
      multiple processes/regions.
- [ ] `STILE_WEBHOOK_URL` is `https://`, `STILE_WEBHOOK_SECRET` ≥ 16
      chars, receiver verifies signature.
- [ ] Reverse proxy in front, terminating TLS, normalizing
      `X-Forwarded-For`.
- [ ] Admin disabled (no `STILE_ADMIN_PASSWORD`) OR password ≥ 12
      chars and not weak.
- [ ] STILE process owns its store file exclusively; permissions
      restrict other users.
- [ ] You ran `node server.js` once and read the boot banner. The
      "context" line says `PRODUCTION`. The "secret" line says
      `env STILE_SECRET`. Anything else and you're not in prod
      posture.
