# STILE — Troubleshooting

Targeted fixes for the most common deployment and integration issues.
Each section states the symptom, the likely cause, and the fix.

---

## Challenge word is never visible to the agent

**Symptom:** The agent reports it cannot find the human-readable
challenge block on the page.

**Cause:** The `stealth` option is set to `'none'`, which suppresses the
human-readable channels (`aria-hidden`, `svg`, `css`, `data-attr`). Note
that the HTML comment and JSON-LD channels are always emitted regardless
of `stealth`, so the verify URL and word are still present there — an
agent that only reads the visible prose will miss them. Alternatively,
the page HTML is being served before STILE has injected the challenge
block.

**Fix:**
- Set `stealth: 'all'` (the default) or include at least `'aria-hidden'`
  in the array form so the prose phrasing is emitted.
- Verify the challenge block is present by loading the gate page and
  inspecting the raw HTML for `data-stile` attributes or the HTML comment;
  or call `/api/peek` to see every channel STILE emits.
- If you're using a framework adapter, confirm `stile.wrap()` or the
  middleware is applied before the route handler that serves the HTML.

---

## Verify endpoint returns 409 Conflict (`challenge_already_used`)

**Symptom:** The first redemption of a challenge token succeeds but all
subsequent attempts return `409` with `{ "error": "challenge_already_used" }`.

**Cause (expected):** This is correct behavior — challenge tokens are
single-use. An agent that retries the same token after a successful
verification will correctly hit 409.

**Cause (unexpected, bug in agent):** The agent is storing the token
across sessions and resubmitting it on a later request.

**Cause (clock skew):** The challenge was issued on a server with a
clock running ahead of the verifying request. The token appears expired
to the verifier, but a fresh token issued immediately also appears used.

**Fix:**
- Confirm the agent always calls `issueChallenge()` to get a fresh token
  before each verification attempt.
- For clock skew: check `date` on the server against an NTP source.
  STILE uses `Date.now()` for both issuance and verification — drifts
  over ~30 s will cause spurious expiry failures.
- If you are sharing a store across processes, confirm your custom store
  implements atomic nonce check-and-set (not two separate `has` + `add`
  calls). A race between two processes can falsely mark a valid token used.

---

## Honeypot poison cookie stops blocking after a restart

**Symptom:** An agent that followed the decoy link and was blocked
(`stile_blocked` cookie set) can access the site again after the server
restarts.

**Cause:** The default in-memory store does not persist across restarts.
Poison cookie state lives in the store and is lost when the process exits.

**Fix:**
- Switch to the file store: `STILE_STORE=file:/var/lib/stile/state.json`
- Implement a custom store backed by Redis, KV, or a database and pass
  it to `createStile({ store: myStore })`.
- Note: even with a persistent store, the `stile_blocked` cookie has its
  own 24-hour TTL enforced by the cookie's `Max-Age` attribute. Once the
  cookie expires from the browser the client is no longer blocked
  regardless of the store state.

---

## All requests redirect to the gate even after successful verification

**Symptom:** The agent verifies successfully (receives `{ ok: true }`)
but subsequent requests to protected routes are still intercepted.

**Cause 1 — Cookie not sent:** The session cookie is `HttpOnly` and
`SameSite=Lax`. If the agent is making cross-origin requests the cookie
will not be sent.

**Cause 2 — Cookie name mismatch:** If `cookieName` was changed between
the verification and the subsequent request (e.g., different instances),
the cookie will not be found.

**Cause 3 — HTTPS/HTTP mismatch:** If STILE issued the cookie over HTTPS
but the agent retries over HTTP (or vice versa via proxy stripping), the
browser or HTTP client may drop the cookie.

**Cause 4 — `protect` path mismatch:** The path being requested does not
match any prefix in the `protect` array.

**Fix:**
- Confirm the cookie name matches `cookieName` in options (default: `stile`).
- Verify the `Set-Cookie` header was received and stored by the HTTP
  client by inspecting the raw verify response headers.
- Confirm the protected path starts with one of the `protect` prefixes.
- The session cookie is issued with `Path=/` and no `Domain` attribute,
  so it is scoped to the exact origin that set it. For cross-origin
  setups, serve STILE on the same origin as the protected routes (STILE
  does not expose a cookie-domain option).

---

## Session cookie rejected unexpectedly (`invalid or missing session`)

**Symptom:** A session that was working starts failing mid-request or
after a deployment.

**Cause 1 — Secret rotated:** Changing `STILE_SECRET` immediately
invalidates all existing sessions because the HMAC signature no longer
verifies. This is by design.

**Cause 2 — Clock skew after a failover:** If the process clock drifted
significantly, the `exp` field in the session token may appear in the past.

**Cause 3 — `ttl` changed:** Shortening the session `ttl` option will
cause previously-issued long sessions to appear expired at verification.

**Fix:**
- After rotating `STILE_SECRET`, expect all active agents to re-verify.
  Plan rotations during low-traffic windows.
- For multi-node deployments, keep clocks synchronized (NTP or
  hardware clock). STILE does not add any clock-skew tolerance.
- If you need zero-downtime secret rotation, run two instances temporarily
  with different secrets behind a load balancer, drain the old one, then
  promote the new one.

---

## Webhook deliveries are silently failing

**Symptom:** Events are recorded in the store but the webhook endpoint
never receives them, or receives far fewer than expected.

**Cause:** Webhook `deliver()` was previously fire-and-forget with no
logging on failure. Upgrade to the latest version of STILE — failed
deliveries now emit a `console.warn` with the URL and HTTP status.

**Fix:**
- Check `STILE_WEBHOOK_URL` and `STILE_WEBHOOK_SECRET` for typos.
- Confirm the webhook endpoint returns a `2xx` response. STILE only
  retries on `5xx` and network errors; a `4xx` is not retried.
- Enable stderr capture in your deployment (e.g., `node server.js 2>&1`)
  to see the `[stile] webhook POST ... failed: ...` warnings.
- Verify the `X-Stile-Signature` is validated on the receiving end with
  the correct secret — rejecting it with `4xx` will not be retried.

---

## Admin dashboard shows no data or fails to load

**Symptom:** `/admin` or `/admin/stats` returns an empty dashboard or
a 403.

**Cause 1 — Admin is loopback-only in development:** By default, the
admin surface is only accessible from `127.0.0.1`. Requests from any
other IP get 403.

**Cause 2 — `STILE_ADMIN_PASSWORD` not set in production:** In
production mode, the admin surface is disabled unless an admin password
is explicitly configured.

**Cause 3 — No events yet:** A fresh install with zero verifications
will show an empty dashboard. This is not an error.

**Fix:**
- In development, access the dashboard from `http://localhost:4173/admin`.
- In production, set `STILE_ADMIN_PASSWORD` (≥12 chars) if you need the
  admin surface. Be aware that this exposes event logs and agent data —
  put it behind authentication middleware or restrict by IP.
- If data is missing, trigger a test verification to confirm the event
  pipeline is working.
