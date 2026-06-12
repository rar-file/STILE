'use strict';

// Trust-critical: single-use nonce protection. Without this, any captured
// challenge URL could be redeemed indefinitely until expiry.

const test = require('node:test');
const assert = require('node:assert/strict');
const http = require('node:http');
const createStile = require('../../lib/stile');

const SECRET = 'd'.repeat(64);

function startServer(opts = {}) {
  const stile = createStile({ secret: SECRET, protect: ['/gated'], ...opts });
  const server = http.createServer(stile.wrap((req, res) => {
    res.statusCode = 200;
    res.setHeader('Content-Type', 'text/plain');
    res.end('pass');
  }));
  return new Promise((resolve) => {
    server.listen(0, '127.0.0.1', () => resolve({ server, stile, port: server.address().port }));
  });
}

function get(port, path, headers = {}) {
  return new Promise((resolve, reject) => {
    const req = http.request({ host: '127.0.0.1', port, path, headers }, (res) => {
      const chunks = [];
      res.on('data', (c) => chunks.push(c));
      res.on('end', () => resolve({ status: res.statusCode, body: Buffer.concat(chunks).toString('utf8') }));
    });
    req.on('error', reject);
    req.end();
  });
}

test('a token cannot be redeemed twice (replay rejected)', async () => {
  const { server, stile, port } = await startServer();
  try {
    const c = stile.issueChallenge();
    const url = `/__stile-verify?token=${encodeURIComponent(c.token)}&word=${encodeURIComponent(c.word)}`;
    const first = await get(port, url);
    assert.equal(first.status, 200, 'first redemption should succeed');
    const second = await get(port, url);
    assert.equal(second.status, 409, 'second redemption must be rejected');
    const json = JSON.parse(second.body);
    assert.equal(json.error, 'challenge_already_used');
  } finally {
    server.close();
  }
});

test('two distinct tokens both redeem successfully', async () => {
  const { server, stile, port } = await startServer();
  try {
    const c1 = stile.issueChallenge();
    const c2 = stile.issueChallenge();
    const r1 = await get(port, `/__stile-verify?token=${encodeURIComponent(c1.token)}&word=${encodeURIComponent(c1.word)}`);
    const r2 = await get(port, `/__stile-verify?token=${encodeURIComponent(c2.token)}&word=${encodeURIComponent(c2.word)}`);
    assert.equal(r1.status, 200);
    assert.equal(r2.status, 200);
  } finally {
    server.close();
  }
});

test('memory store consume(nonce) is atomic: second call returns false', () => {
  const createMemoryStore = require('../../lib/store-memory');
  const store = createMemoryStore();
  const exp = Math.floor(Date.now() / 1000) + 60;
  assert.equal(store.nonces.consume('n1', exp), true,  'first consume records the nonce');
  assert.equal(store.nonces.consume('n1', exp), false, 'second consume of same nonce returns false');
  assert.equal(store.nonces.consume('n2', exp), true,  'distinct nonces still pass');
});

test('file store consume(nonce) is atomic: second call returns false', () => {
  const path = require('node:path');
  const os = require('node:os');
  const fs = require('node:fs');
  const createFileStore = require('../../lib/store-file');
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'stile-test-'));
  const store = createFileStore({ filePath: path.join(tmpDir, 'data.json'), flushDebounceMs: 5 });
  const exp = Math.floor(Date.now() / 1000) + 60;
  try {
    assert.equal(store.nonces.consume('n1', exp), true);
    assert.equal(store.nonces.consume('n1', exp), false);
    assert.equal(store.nonces.consume('n2', exp), true);
    // Flush the debounced write before tearing down the temp dir so the
    // background timer doesn't fire against a missing directory.
    store._flushNow();
  } finally {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  }
});

test('verify falls back to has()+add() when store has no consume()', async () => {
  // Stand up a store that intentionally omits consume() — mirrors any custom
  // store written against the older contract.
  const realStore = require('../../lib/store-memory')();
  const legacyStore = {
    nonces: {
      has: (n)    => realStore.nonces.has(n),
      add: (n, e) => realStore.nonces.add(n, e),
      // no consume()
    },
    events:     realStore.events,
    agents:     realStore.agents,
    reputation: realStore.reputation,
    adopters:   realStore.adopters,
  };
  const stile = require('../../lib/stile')({ secret: SECRET, protect: ['/gated'], store: legacyStore });
  const server = http.createServer(stile.wrap((req, res) => { res.statusCode = 200; res.end('pass'); }));
  await new Promise(r => server.listen(0, '127.0.0.1', r));
  const port = server.address().port;
  try {
    const c = stile.issueChallenge();
    const url = `/__stile-verify?token=${encodeURIComponent(c.token)}&word=${encodeURIComponent(c.word)}`;
    const first = await get(port, url);
    assert.equal(first.status, 200, 'fallback path accepts first redemption');
    const second = await get(port, url);
    assert.equal(second.status, 409, 'fallback path rejects replay');
  } finally {
    server.close();
  }
});
