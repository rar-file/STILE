# Contributing

Thanks for looking. STILE is small enough that contribution is
straightforward — there's no committee, no CLA, no required design
doc for small changes.

## Before you open a PR

1. **Read the README in full.** It documents what STILE is, and equally
   importantly what it isn't. A surprising number of "fix" ideas are
   already covered as documented non-goals.
2. **Read [`docs/THREAT_MODEL.md`](docs/THREAT_MODEL.md)** if your
   change touches token signing, sessions, fast-paths, or anything
   that could weaken the trust boundary.
3. **For non-trivial work, open an issue first.** Especially anything
   that:
   - changes the wire format of tokens, sessions, or the hidden block;
   - adds a runtime dependency (STILE is zero-deps on purpose);
   - changes config defaults or boot-time refusal behaviour;
   - touches the admin surface or the webhook signing scheme.

   Trivial fixes (typos, doc clarifications, obvious bugs with a
   failing test) — just send the PR.

## Development

Requires Node.js ≥ 20 (for stable `node:test`).

```bash
git clone https://github.com/rar-file/STILE.git stile
cd stile
node server.js
```

Visit <http://localhost:4173>. Read the startup banner.

There are no build steps, no bundler, no transpile. The runtime is
the source.

## Tests

```bash
npm test              # all tests
npm run test:trust    # signing, sessions, replay, config
npm run test:routing  # API shapes, gated routes, static pages
```

The trust suite is the one to extend if you touch anything in
`lib/stile.js`, `lib/config.js`, `lib/web-bot-auth.js`, or `lib/mtls.js`.
A change there without a corresponding test will almost certainly be
asked for during review.

CI runs the full suite on Node 20 and 22 on every push and PR.

## Style

- CommonJS (`require` / `module.exports`). No ESM, no TypeScript.
- No runtime dependencies. Dev-only deps need a real justification.
- Match the surrounding code: two-space indent, single quotes,
  semicolons, `'use strict'` at the top of every file.
- Comments explain *why*, not *what*. The existing modules are a
  reasonable reference.
- Error messages should be specific and actionable. The config layer's
  failure strings are the bar.

## Documentation

If you change behaviour that's documented in the README or `docs/`,
update the docs in the same PR. "Docs updated separately" PRs tend
not to happen.

## Reporting bugs

Use the bug report template. Include the version, the deployment
posture (store, adapter, env vars with secrets redacted), and a
reproduction.

## Reporting security issues

Don't file a public issue. See [`SECURITY.md`](SECURITY.md).

## License

By contributing, you agree your contributions are licensed under the
MIT License (see [`LICENSE`](LICENSE)).
