'use strict';

// Trust-critical: signed challenge tokens and the verifyChallenge contract.
// If any of these fail, the gate's authentication is broken.

const test = require('node:test');
const assert = require('node:assert/strict');
const createStile = require('../../lib/stile');

const SECRET = 'a'.repeat(64);

function fresh(opts = {}) {
  return createStile({ secret: SECRET, ...opts });
}

test('issued token round-trips through verifyChallenge', () => {
  const s = fresh();
  const c = s.issueChallenge();
  const claim = s.verifyChallenge(c.token);
  assert.ok(claim, 'fresh token must verify');
  assert.equal(claim.nonce, c.nonce);
  assert.equal(claim.word, c.word);
  assert.equal(claim.tier, c.tier);
});

test('tampered signature is rejected', () => {
  const s = fresh();
  const c = s.issueChallenge();
  const parts = c.token.split('.');
  parts[5] = parts[5].split('').reverse().join(''); // mutate sig
  assert.equal(s.verifyChallenge(parts.join('.')), null);
});

test('tampered payload (changed word) is rejected', () => {
  const s = fresh();
  const c = s.issueChallenge();
  const parts = c.token.split('.');
  parts[3] = 'tampered-word';
  assert.equal(s.verifyChallenge(parts.join('.')), null);
});

test('tampered payload (changed exp) is rejected', () => {
  const s = fresh();
  const c = s.issueChallenge();
  const parts = c.token.split('.');
  parts[2] = String(parseInt(parts[2], 10) + 9999);
  assert.equal(s.verifyChallenge(parts.join('.')), null);
});

test('expired token is rejected', () => {
  const s = fresh({ challengeTtl: 0 });
  const c = s.issueChallenge();
  // Even with TTL=0 the issue/verify race could pass within the same ms.
  // Force the clock forward.
  const realDateNow = Date.now;
  Date.now = () => realDateNow() + 5000;
  try {
    assert.equal(s.verifyChallenge(c.token), null, 'expired token must not verify');
  } finally {
    Date.now = realDateNow;
  }
});

test('garbage tokens are rejected, not crashed on', () => {
  const s = fresh();
  for (const bad of [null, '', 'x', 'a.b.c', 'a.b.c.d.e.f.g.h', 'c1.x.y.z.w.q', undefined, 42, {}, []]) {
    assert.equal(s.verifyChallenge(bad), null, `bad token should be null: ${JSON.stringify(bad)}`);
  }
});

test('different secrets produce different signatures', () => {
  const a = createStile({ secret: 'a'.repeat(64) });
  const b = createStile({ secret: 'b'.repeat(64) });
  const c = a.issueChallenge();
  // Token signed by A must not verify under B.
  assert.equal(b.verifyChallenge(c.token), null);
});
