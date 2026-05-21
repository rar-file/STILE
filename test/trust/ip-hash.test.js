'use strict';

// Trust-critical: IP hash salt must isolate hashes across deployments.
// Without per-deployment STILE_IP_SALT, hashes are public-default-salted
// and joinable across instances.

const test = require('node:test');
const assert = require('node:assert/strict');
const crypto = require('node:crypto');

// We reuse the same hash construction as lib/stile.js#ipHash, since
// that helper is not exported. If the formula changes there, this test
// must be updated in the same change — that is intentional.
function ipHash(ip, secret) {
  if (!ip) return null;
  return crypto.createHmac('sha256', secret || 'stile-default-ip-salt')
    .update(String(ip)).digest('hex').slice(0, 16);
}

test('default salt produces stable hash', () => {
  const a = ipHash('203.0.113.4');
  const b = ipHash('203.0.113.4');
  assert.equal(a, b);
});

test('different salts produce different hashes for the same IP', () => {
  const a = ipHash('203.0.113.4', 'salt-deployment-A');
  const b = ipHash('203.0.113.4', 'salt-deployment-B');
  assert.notEqual(a, b, 'two deployments with different salts must not produce the same hash');
});

test('default salt vs explicit salt also differ', () => {
  const def = ipHash('203.0.113.4');
  const exp = ipHash('203.0.113.4', 'salt-X');
  assert.notEqual(def, exp);
});

test('null IP yields null hash, not crash', () => {
  assert.equal(ipHash(null, 'salt'), null);
  assert.equal(ipHash('', 'salt'), null);
});
