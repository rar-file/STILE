# Security Policy

## Scope

STILE is a low-friction signal that a request comes from a client willing
to identify itself as an AI agent. It is **not** an authentication layer
and is not designed to defend high-value endpoints.

Please read [`docs/THREAT_MODEL.md`](docs/THREAT_MODEL.md) and the
"What an attacker can still do" section of the [`README`](README.md)
before reporting. A number of behaviours that look like vulnerabilities
are documented design choices — we'd rather sharpen the docs than treat
them as bugs.

## What we consider in-scope

- HMAC token signing / verification bypass.
- Single-use nonce being redeemable more than the documented number of
  times for a given store backend.
- Session cookie forgery without the signing secret.
- Web Bot Auth / mTLS fast-path accepting an identity that does not match
  the configured trust list.
- Boot-time config checks accepting a misconfiguration the docs say will
  be rejected (e.g. demo secret in production, weak admin password,
  unsigned HTTPS-less webhook in production).
- Path traversal, prototype pollution, ReDoS, or XSS reachable through
  any built-in route (`/`, `/agents`, `/api/data`, `/api/peek`,
  `/__stile-verify`, `/admin`, the playground, the example pages).
- Information disclosure beyond what's documented (e.g. raw IPs or
  unhashed UAs reaching the event log, leakage of `STILE_SECRET` into
  responses or logs).
- Dependency vulnerabilities in anything under `lib/` or `server.js`.
  (STILE has zero runtime dependencies by design — a finding here is
  unusual and worth reporting.)

## What is explicitly out of scope

- Self-declared `agent=` strings being inaccurate. STILE does not verify
  them; this is documented in the README.
- A scripted client passing the challenge. STILE distinguishes
  "willing to identify and parse" from "indifferent scraper," not
  "machine" from "model." That's the threat model, not a bug.
- Reselling / sharing a session cookie within its TTL window. Sessions
  are stateless HMACs; this is documented behaviour.
- An attacker who already holds `STILE_SECRET` minting tokens.
  Compromise of the signing secret is a key-compromise event; rotate
  the secret.
- Honeypot being bypassed by reading the on-page "DO NOT FOLLOW"
  instruction.
- Issues only reproducible when running in `STILE_MODE=demo`. The
  demo posture is documented as unsafe.

## Reporting a vulnerability

Please **do not** open a public issue for security reports.

Use GitHub's private vulnerability reporting:
<https://github.com/rar-file/STILE/security/advisories/new>

Include, at minimum:

- The version (`package.json` → `version`) and the commit SHA if known.
- The deployment posture: store backend, framework adapter, whether
  Web Bot Auth or mTLS is in use, and the relevant `STILE_*` env vars
  with secrets redacted.
- Reproduction steps. A failing `node --test` case in `test/trust/` is
  ideal; a `curl` transcript is fine.
- Your assessment of impact.

We aim to acknowledge within 5 business days. There is no bug bounty.

## Disclosure

Once a fix is available we'll publish a GitHub Security Advisory with
a CVE if one is warranted, credit the reporter (unless they prefer
otherwise), and note the fix in [`CHANGELOG.md`](CHANGELOG.md).

## Supported versions

Pre-1.0, only the latest minor receives security fixes. After 1.0
this policy will be reviewed.

| Version | Supported          |
| ------- | ------------------ |
| 0.3.x   | :white_check_mark: |
| < 0.3   | :x:                |
