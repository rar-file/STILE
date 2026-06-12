'use strict';

// Regression coverage for the v0.4 hardening pass:
//   - a malformed cookie / Host header must not crash the gate (DoS)
//   - trustProxy:false keys rate limiting on the socket peer, not XFF
//   - honeypot decoy tokens honor their signed expiry

const test = require('node:test');
const assert = require('node:assert/strict');
const http = require('node:http');
const crypto = require('node:crypto');
const createStile = require('../../lib/stile');
const createHoneypot = require('../../lib/honeypot');

const SECRET = 'h'.repeat(64);

function startServer(opts = {}) {
  const stile = createStile({ secret: SECRET, protect: ['/gated'], ipHashSecret: 'salt', ...opts });
  const server = http.createServer(stile.wrap((req, res) => { res.statusCode = 200; res.end('pass'); }));
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

// --- malformed input must not crash -----------------------------------------

test('a malformed cookie does not crash the gate', async () => {
  const { server, port } = await startServer();
  try {
    // "stile=%" is invalid percent-encoding — decodeURIComponent would throw.
    const r = await get(port, '/gated', { Cookie: 'stile=%' });
    assert.equal(r.status, 401, 'gated path should still issue a challenge, not crash');
  } finally {
    server.close();
  }
});

test('a malformed Host header does not crash the gate', async () => {
  const { server, port } = await startServer();
  try {
    const r = await get(port, '/gated', { Host: 'bad host name' });
    assert.ok(r.status >= 200 && r.status < 600, 'a response is produced rather than a process crash');
  } finally {
    server.close();
  }
});

test('a malformed cookie still lets a valid session through', async () => {
  const { server, stile, port } = await startServer();
  try {
    // Mint a real session cookie, then send it alongside an unrelated broken one.
    const session = stile.issueSession({ agent: null });
    const r = await get(port, '/gated', { Cookie: `junk=%E0%A4%A; stile=${encodeURIComponent(session)}` });
    assert.equal(r.status, 200, 'a valid stile cookie is honored despite a sibling malformed cookie');
  } finally {
    server.close();
  }
});

// --- trustProxy -------------------------------------------------------------

test('trustProxy:true (default) lets a rotating X-Forwarded-For evade the limiter', async () => {
  const { server, port } = await startServer({ rateLimit: { windowMs: 10_000, maxAttempts: 2 } });
  try {
    // Each request carries a distinct XFF, so each gets its own bucket.
    for (let i = 0; i < 5; i++) {
      const r = await get(port, '/__stile-verify?token=garbage', { 'X-Forwarded-For': `203.0.113.${i}` });
      assert.notEqual(r.status, 429, `attempt ${i + 1} with a fresh XFF should not be limited`);
    }
  } finally {
    server.close();
  }
});

test('trustProxy:false keys on the socket peer, so a rotating XFF cannot evade it', async () => {
  const { server, port } = await startServer({
    trustProxy: false,
    rateLimit: { windowMs: 10_000, maxAttempts: 2 },
  });
  try {
    let sawLimit = false;
    for (let i = 0; i < 5; i++) {
      const r = await get(port, '/__stile-verify?token=garbage', { 'X-Forwarded-For': `203.0.113.${i}` });
      if (r.status === 429) { sawLimit = true; break; }
    }
    assert.ok(sawLimit, 'all requests share the loopback socket peer, so the limiter must trip');
  } finally {
    server.close();
  }
});

// --- honeypot decoy expiry --------------------------------------------------

test('honeypot decoy token honors its signed expiry', () => {
  const secret = 'decoy-secret';
  const hp = createHoneypot({ secret });

  // A freshly issued token is valid.
  assert.equal(hp.isDecoyToken(hp.issueDecoyToken()), true);

  // Reconstruct the signing exactly as honeypot.js does, but with a past exp.
  const b64url = (buf) => Buffer.from(buf).toString('base64')
    .replace(/=+$/g, '').replace(/\+/g, '-').replace(/\//g, '_');
  const sign = (payload) => b64url(crypto.createHmac('sha256', secret).update(payload).digest());
  const nonce = b64url(crypto.randomBytes(12));
  const pastExp = Math.floor(Date.now() / 1000) - 1;
  const expired = `d.${nonce}.${pastExp}.${sign(`d.${nonce}.${pastExp}`)}`;

  assert.equal(hp.isDecoyToken(expired), false, 'an expired but validly-signed decoy token is rejected');
});
