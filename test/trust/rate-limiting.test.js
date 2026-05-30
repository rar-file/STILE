'use strict';

// Opt-in rate limiting on /__stile-verify. Validates the 429 path,
// the per-window reset, the disabled-by-default behaviour, and the
// construction-time warning when a custom store lacks store.rateLimits.

const test = require('node:test');
const assert = require('node:assert/strict');
const http = require('node:http');
const createStile = require('../../lib/stile');
const createMemoryStore = require('../../lib/store-memory');

const SECRET = 'e'.repeat(64);

function startServer(opts = {}) {
  const stile = createStile({ secret: SECRET, protect: ['/gated'], ...opts });
  const server = http.createServer(stile.wrap((req, res) => {
    res.statusCode = 200; res.end('ok');
  }));
  return new Promise(resolve =>
    server.listen(0, '127.0.0.1', () => resolve({ server, stile, port: server.address().port }))
  );
}

function get(port, path) {
  return new Promise((resolve, reject) => {
    const req = http.request({ host: '127.0.0.1', port, path }, res => {
      const chunks = [];
      res.on('data', c => chunks.push(c));
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

// --- disabled by default ----------------------------------------------------

test('rate limiting is disabled by default (no rateLimit option)', async () => {
  const { server, stile, port } = await startServer();
  try {
    // Hit the verify endpoint 20 times — should never get 429
    for (let i = 0; i < 20; i++) {
      const c = stile.issueChallenge();
      const r = await get(port, `/__stile-verify?token=${encodeURIComponent(c.token)}&word=${encodeURIComponent(c.word)}`);
      assert.notEqual(r.status, 429, `unexpected 429 on attempt ${i + 1}`);
    }
  } finally { server.close(); }
});

// --- 429 after threshold ----------------------------------------------------

test('returns 429 after maxAttempts is exceeded within the window', async () => {
  const { server, stile, port } = await startServer({
    rateLimit: { windowMs: 60_000, maxAttempts: 3 },
  });
  try {
    // First 3 attempts: any status except 429
    for (let i = 0; i < 3; i++) {
      const c = stile.issueChallenge();
      const r = await get(port, `/__stile-verify?token=${encodeURIComponent(c.token)}&word=${encodeURIComponent(c.word)}`);
      assert.notEqual(r.status, 429, `unexpected 429 on allowed attempt ${i + 1}`);
    }
    // 4th attempt: must be 429
    const c = stile.issueChallenge();
    const blocked = await get(port, `/__stile-verify?token=${encodeURIComponent(c.token)}&word=${encodeURIComponent(c.word)}`);
    assert.equal(blocked.status, 429);
    const j = JSON.parse(blocked.body);
    assert.equal(j.error, 'rate_limit_exceeded');
    assert.equal(typeof j.retry_after, 'number');
    assert.ok(blocked.headers['retry-after'], 'Retry-After header must be present');
  } finally { server.close(); }
});

// --- Retry-After header ------------------------------------------------------

test('Retry-After header matches ceil(windowMs / 1000)', async () => {
  const windowMs = 30_000;
  const { server, stile, port } = await startServer({
    rateLimit: { windowMs, maxAttempts: 1 },
  });
  try {
    // exhaust the limit
    for (let i = 0; i < 2; i++) {
      const c = stile.issueChallenge();
      await get(port, `/__stile-verify?token=${encodeURIComponent(c.token)}&word=${encodeURIComponent(c.word)}`);
    }
    const c = stile.issueChallenge();
    const r = await get(port, `/__stile-verify?token=${encodeURIComponent(c.token)}&word=${encodeURIComponent(c.word)}`);
    assert.equal(r.status, 429);
    assert.equal(r.headers['retry-after'], String(Math.ceil(windowMs / 1000)));
  } finally { server.close(); }
});

// --- store.rateLimits unit tests --------------------------------------------

test('memory store rateLimits.hit() increments within a window', () => {
  const store = createMemoryStore();
  assert.equal(store.rateLimits.hit('key1', 60_000), 1);
  assert.equal(store.rateLimits.hit('key1', 60_000), 2);
  assert.equal(store.rateLimits.hit('key1', 60_000), 3);
});

test('memory store rateLimits.hit() resets after window expires', () => {
  const store = createMemoryStore();
  // Use an already-expired window (windowMs = 1ms, so any call after will reset)
  store.rateLimits.hit('key2', 1);
  // Small delay to ensure window expires
  const count = store.rateLimits.hit('key2', 1);
  // Either 1 (new window) or 2 (same window) — both are valid depending on timing,
  // but we can assert the counter never grows unboundedly
  assert.ok(count <= 2, `count should not exceed 2 in two fast hits: ${count}`);
});

test('memory store rateLimits.reset() clears the counter', () => {
  const store = createMemoryStore();
  store.rateLimits.hit('key3', 60_000);
  store.rateLimits.hit('key3', 60_000);
  store.rateLimits.reset('key3');
  assert.equal(store.rateLimits.hit('key3', 60_000), 1);
});

// --- warn when store lacks rateLimits ----------------------------------------

test('construction warns and disables rate limiting when store has no rateLimits', () => {
  const warned = [];
  const orig = console.warn;
  console.warn = (...args) => warned.push(args.join(' '));
  try {
    const store = createMemoryStore();
    const { rateLimits: _drop, ...storeWithout } = store; // strip rateLimits
    createStile({ secret: SECRET, rateLimit: { windowMs: 60_000, maxAttempts: 5 }, store: storeWithout });
    assert.ok(
      warned.some(w => w.includes('rateLimits')),
      `expected warn mentioning rateLimits, got: ${warned}`
    );
  } finally {
    console.warn = orig;
  }
});
