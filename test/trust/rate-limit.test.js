'use strict';

// Trust-critical: opt-in rate limiting on /__stile-verify must
//   - return 429 + Retry-After after the threshold is exceeded
//   - stay quiet when no rateLimit option is configured (default)
//   - reset the counter when the window expires
//   - degrade gracefully when the store has no rateLimits namespace

const test = require('node:test');
const assert = require('node:assert/strict');
const http = require('node:http');
const createStile = require('../../lib/stile');
const createMemoryStore = require('../../lib/store-memory');

const SECRET = 'r'.repeat(64);

function startServer(opts = {}) {
  const stile = createStile({ secret: SECRET, protect: ['/gated'], ipHashSecret: 'salt', ...opts });
  const server = http.createServer(stile.wrap((req, res) => {
    res.statusCode = 200;
    res.end('pass');
  }));
  return new Promise((resolve) => {
    server.listen(0, '127.0.0.1', () => resolve({ server, stile, port: server.address().port }));
  });
}

function get(port, path) {
  return new Promise((resolve, reject) => {
    const req = http.request({ host: '127.0.0.1', port, path }, (res) => {
      const chunks = [];
      res.on('data', (c) => chunks.push(c));
      res.on('end', () => resolve({
        status: res.statusCode,
        headers: res.headers,
        body: Buffer.concat(chunks).toString('utf8'),
      }));
    });
    req.on('error', reject);
    req.end();
  });
}

test('rate limit disabled by default: many verify attempts all 4xx/2xx, never 429', async () => {
  const { server, stile, port } = await startServer();
  try {
    // Hit verify with a bogus token a bunch of times — they all return 400,
    // never 429, because no rateLimit option is set.
    for (let i = 0; i < 20; i++) {
      const r = await get(port, '/__stile-verify?token=garbage');
      assert.notEqual(r.status, 429, `attempt ${i + 1} should not be rate limited`);
    }
    // Sanity: a real token still redeems.
    const c = stile.issueChallenge();
    const ok = await get(port, `/__stile-verify?token=${encodeURIComponent(c.token)}&word=${encodeURIComponent(c.word)}`);
    assert.equal(ok.status, 200);
  } finally {
    server.close();
  }
});

test('rate limit returns 429 + Retry-After once threshold exceeded', async () => {
  const { server, port } = await startServer({
    rateLimit: { windowMs: 10_000, maxAttempts: 3 },
  });
  try {
    // First 3 attempts: under the threshold, each returns 400 because the
    // token is bogus — but they're not rate limited.
    for (let i = 0; i < 3; i++) {
      const r = await get(port, '/__stile-verify?token=garbage');
      assert.equal(r.status, 400, `attempt ${i + 1} under threshold should be 400`);
    }
    // 4th attempt: tipped over the threshold (3 hits already, 4th hit = count 4 > maxAttempts 3).
    const over = await get(port, '/__stile-verify?token=garbage');
    assert.equal(over.status, 429);
    assert.ok(over.headers['retry-after'], 'must set Retry-After');
    const retry = Number(over.headers['retry-after']);
    assert.ok(retry >= 1 && retry <= 10, `Retry-After should be in (0, windowMs]; got ${retry}`);
    const body = JSON.parse(over.body);
    assert.equal(body.error, 'rate_limited');
    assert.equal(typeof body.retry_after, 'number');
  } finally {
    server.close();
  }
});

test('rate limit counter resets once the window expires', async () => {
  // Build a tiny window so the test stays fast.
  const { server, port } = await startServer({
    rateLimit: { windowMs: 150, maxAttempts: 2 },
  });
  try {
    await get(port, '/__stile-verify?token=garbage'); // count 1
    await get(port, '/__stile-verify?token=garbage'); // count 2
    const blocked = await get(port, '/__stile-verify?token=garbage');
    assert.equal(blocked.status, 429, 'third within window must be rate limited');

    // Wait out the window, then a fresh hit should pass through to 400 again.
    await new Promise(r => setTimeout(r, 200));
    const after = await get(port, '/__stile-verify?token=garbage');
    assert.equal(after.status, 400, 'window has expired, counter should be fresh');
  } finally {
    server.close();
  }
});

test('rate limit on a custom store without rateLimits namespace: warns + disables', async (t) => {
  // Capture the one-time warning emitted at construction.
  const orig = console.warn;
  const warns = [];
  console.warn = (...args) => warns.push(args.join(' '));
  t.after(() => { console.warn = orig; });

  const base = createMemoryStore();
  const legacyStore = {
    nonces:     base.nonces,
    events:     base.events,
    agents:     base.agents,
    reputation: base.reputation,
    adopters:   base.adopters,
    // no rateLimits
  };
  const { server, port } = await startServer({
    store: legacyStore,
    rateLimit: { windowMs: 10_000, maxAttempts: 1 },
  });
  try {
    assert.ok(
      warns.some(w => /rateLimit option set but the configured store has no rateLimits/i.test(w)),
      'expected a one-time warning about the missing rateLimits namespace'
    );
    // Even though rateLimit was set, the store can't honor it — so subsequent
    // attempts are not rate limited (they 400, never 429).
    for (let i = 0; i < 5; i++) {
      const r = await get(port, '/__stile-verify?token=garbage');
      assert.notEqual(r.status, 429, `attempt ${i + 1} should not be rate limited`);
    }
  } finally {
    server.close();
  }
});

test('createStile throws on a malformed rateLimit shape', () => {
  assert.throws(
    () => createStile({ secret: SECRET, ipHashSecret: 'salt', rateLimit: { windowMs: 0, maxAttempts: 5 } }),
    /windowMs > 0/);
  assert.throws(
    () => createStile({ secret: SECRET, ipHashSecret: 'salt', rateLimit: { windowMs: 1000, maxAttempts: -1 } }),
    /maxAttempts > 0/);
});

test('memory store rateLimits.hit returns growing count + stable expiresAt within window', () => {
  const store = createMemoryStore();
  const a = store.rateLimits.hit('k', 60_000);
  const b = store.rateLimits.hit('k', 60_000);
  assert.equal(a.count, 1);
  assert.equal(b.count, 2);
  assert.equal(a.expiresAt, b.expiresAt, 'expiresAt should not slide forward within the same window');
  store.rateLimits.reset('k');
  const c = store.rateLimits.hit('k', 60_000);
  assert.equal(c.count, 1, 'reset() drops the counter back to zero');
});
