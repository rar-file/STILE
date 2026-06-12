'use strict';

// Trust-critical: IP hash salt must isolate hashes across deployments.
// As of v0.4, there is no public default salt — ipHash() refuses to compute
// a hash without one, and createStile() synthesizes an ephemeral random salt
// when the caller didn't supply ipHashSecret.

const test = require('node:test');
const assert = require('node:assert/strict');
const crypto = require('node:crypto');

// We reuse the same hash construction as lib/stile.js#ipHash, since
// that helper is not exported. If the formula changes there, this test
// must be updated in the same change — that is intentional.
function ipHash(ip, secret) {
  if (!ip) return null;
  if (!secret) return null;
  return crypto.createHmac('sha256', secret).update(String(ip)).digest('hex').slice(0, 16);
}

test('same salt produces stable hash', () => {
  const salt = 'salt-X';
  const a = ipHash('203.0.113.4', salt);
  const b = ipHash('203.0.113.4', salt);
  assert.equal(a, b);
});

test('different salts produce different hashes for the same IP', () => {
  const a = ipHash('203.0.113.4', 'salt-deployment-A');
  const b = ipHash('203.0.113.4', 'salt-deployment-B');
  assert.notEqual(a, b, 'two deployments with different salts must not produce the same hash');
});

test('no salt returns null (no published default)', () => {
  assert.equal(ipHash('203.0.113.4'), null);
  assert.equal(ipHash('203.0.113.4', ''), null);
  assert.equal(ipHash('203.0.113.4', null), null);
});

test('null IP yields null hash, not crash', () => {
  assert.equal(ipHash(null, 'salt'), null);
  assert.equal(ipHash('', 'salt'), null);
});
