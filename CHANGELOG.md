# Changelog

All notable changes to STILE are recorded here.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

## [0.4.0] - 2026-06-12

### Added

- Optional `nonces.consume(nonce, expSec) → boolean` on the store contract.
  When present it atomically check-and-records a nonce; `handleVerify` prefers
  it and falls back to `has()` + `add()` so custom stores written against the
  older contract keep working. Closes #5.
- Opt-in `rateLimit: { windowMs, maxAttempts }` option on `createStile`.
  Store-backed limit on `/__stile-verify` keyed by IP hash; returns
  `429 + Retry-After` once the threshold is exceeded. Both shipped stores
  implement the new `rateLimits` namespace; custom stores without it silently
  disable the limit with a one-time warning. Closes #6.
- `trustProxy` option on `createStile` (default `true`). When `false`, the
  client IP used for rate-limit keys and event hashing is taken from the
  socket peer instead of `X-Forwarded-For`, so a client can't escape the
  rate limiter by rotating the header.

### Changed

- **BREAKING (production):** `STILE_IP_SALT` is now required in production.
  Boot is refused when it is unset or set to the published default. In
  dev/demo, an ephemeral random salt is synthesized with a one-time notice.
  The hardcoded fallback salt has been removed from `ipHash()`. Closes #7.
- Consolidated duplicated helpers (`b64url`, `hmac`, `safeEq`, `htmlEscape`,
  `todayIso`, `readBody`) into `lib/util.js`. The verify endpoint's request
  body cap is now 16 KB, matching the documented handler limit.

### Fixed

- **DoS:** a request with a malformed cookie (e.g. `stile=%`) threw an
  uncaught `URIError` out of the ungated request path and crashed the
  process. Cookie parsing now falls back to the raw value, and request-URL
  construction tolerates a malformed `Host` header.
- Honeypot decoy tokens now honor their signed expiry (like poison cookies
  already did) instead of being accepted indefinitely.

## [0.3.0] - 2025-05-03

Initial public release.

### Added

- Core middleware: 401 + signed verification URL flow with HMAC tokens,
  single-use nonces, and stateless session cookies.
- Three verification tiers: `easy` (token only), `medium` (+ challenge word),
  `strong` (+ self-declared agent identifier).
- Five-channel redundant hidden block (HTML comment, JSON-LD,
  `aria-hidden` clipped text, SVG `<title>`, `<meta>` tags) so any
  reasonable HTML parser can find the verify URL.
- Fast-paths that bypass the challenge entirely:
  - **Web Bot Auth** (RFC 9421 HTTP Message Signatures) with Ed25519,
    verified against a `trustedSigners` list.
  - **mTLS** with SHA-256 fingerprint pinning or Subject regex matching;
    both `native` (TLS socket) and `proxy` (`X-Client-Cert-SHA256` header
    from a trusted upstream) ingestion modes.
- Framework adapters: Express, Fastify, Hono, Next.js, Cloudflare Workers.
- Stores: in-memory (single-process) and file-backed (single-node
  persistence with atomic writes); pluggable interface for KV / Redis /
  Postgres / Durable Objects.
- Config layer (`lib/config.js`) that fails boot on misconfigured
  production deployments (weak secret, demo password, non-loopback
  bind without real secret, unsigned `http://` webhook, etc.) and warns
  loudly in dev/demo.
- Honeypot decoy link to catch indiscriminate scrapers.
- Optional webhook delivery with `X-Stile-Signature: sha256=…` HMAC.
- Admin dashboard with password gate and event/agent/reputation views.
- Interactive playground and example pages (shop, news, jobs, weather,
  docs) for testing agent behaviour against gated content.
- Documentation: `docs/API.md`, `docs/DEPLOY.md`, `docs/THREAT_MODEL.md`.
- Test suite: 71 tests across `test/trust/` (token signing, replay,
  IP hashing, tier enforcement, session cookies, honeypot, config) and
  `test/routing/` (API shapes, gated routes, badge ping, playground SSE,
  static pages).

[Unreleased]: https://github.com/rar-file/STILE/compare/v0.4.0...HEAD
[0.4.0]: https://github.com/rar-file/STILE/compare/v0.3.0...v0.4.0
[0.3.0]: https://github.com/rar-file/STILE/releases/tag/v0.3.0
