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
