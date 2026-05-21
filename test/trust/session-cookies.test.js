'use strict';

// Trust-critical: session cookies (s2 v2 format) and v1 back-compat path.

const test = require('node:test');
const assert = require('node:assert/strict');
const createStile = require('../../lib/stile');

const SECRET = 'b'.repeat(64);

test('issued session round-trips through verifySession', () => {
  const s = createStile({ secret: SECRET, ttl: 60 });
  const cookie = s.issueSession({ agent: 'acme/agent-1', fast_path: 'web-bot-auth' });
  const info = s.verifySession(cookie);
  assert.ok(info, 'fresh session must verify');
  assert.equal(info.agent, 'acme/agent-1');
  assert.equal(info.fast_path, 'web-bot-auth');
});

test('unsigned cookie fails verification', () => {
  const s = createStile({ secret: SECRET, ttl: 60 });
  const cookie = s.issueSession({ agent: 'acme/agent-1' });
  const parts = cookie.split('.');
  parts[5] = 'forged';
  assert.equal(s.verifySession(parts.join('.')), null);
});

test('cookie signed by other secret fails', () => {
  const a = createStile({ secret: SECRET, ttl: 60 });
  const b = createStile({ secret: 'c'.repeat(64), ttl: 60 });
  const cookie = a.issueSession({ agent: 'mover' });
  assert.equal(b.verifySession(cookie), null);
});

test('expired session is rejected', () => {
  const s = createStile({ secret: SECRET, ttl: 0 });
  const cookie = s.issueSession({ agent: 'expired' });
  const realDateNow = Date.now;
  Date.now = () => realDateNow() + 5000;
  try {
    assert.equal(s.verifySession(cookie), null);
  } finally {
    Date.now = realDateNow;
  }
});

test('garbage cookies are rejected, not crashed on', () => {
  const s = createStile({ secret: SECRET });
  for (const bad of [null, '', 'x', 's2.a.b.c.d', 's2.a.b.c.d.e.f.extra', undefined]) {
    assert.equal(s.verifySession(bad), null, `bad cookie: ${JSON.stringify(bad)}`);
  }
});
