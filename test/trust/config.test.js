'use strict';

// Trust-critical: production posture must refuse to boot when the
// secret is missing, weak, or the published demo string.

const test = require('node:test');
const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const config = require('../../lib/config');

test('production with no secret is blocked', () => {
  const r = config.load({ env: { NODE_ENV: 'production' } });
  assert.equal(r.context, 'production');
  assert.equal(r.blocked, true);
  assert.ok(r.issues.some(i => i.includes('STILE_SECRET')));
});

test('production with the literal demo secret is blocked', () => {
  const r = config.load({ env: { NODE_ENV: 'production', STILE_SECRET: config.DEMO_SECRET } });
  assert.equal(r.blocked, true);
  assert.ok(r.issues.some(i => /demo string|published in the source/i.test(i)));
});

test('production with a 16-char secret is blocked (too short)', () => {
  const r = config.load({ env: { NODE_ENV: 'production', STILE_SECRET: 'a'.repeat(16) } });
  assert.equal(r.blocked, true);
  assert.ok(r.issues.some(i => i.includes('≥32')));
});

test('production with a real 64-char secret boots', () => {
  const r = config.load({
    env: {
      NODE_ENV: 'production',
      STILE_SECRET: 'a'.repeat(64),
      STILE_IP_SALT: 'b'.repeat(64),
    },
  });
  assert.equal(r.blocked, false);
  assert.equal(r.values.secret, 'a'.repeat(64));
});

test('production refuses a known-weak admin password', () => {
  const r = config.load({
    env: {
      NODE_ENV: 'production',
      STILE_SECRET: 'a'.repeat(64),
      STILE_ADMIN_PASSWORD: 'admin',
    },
  });
  assert.equal(r.blocked, true);
  assert.ok(r.issues.some(i => i.includes('known-weak')));
});

test('production refuses a short admin password', () => {
  const r = config.load({
    env: {
      NODE_ENV: 'production',
      STILE_SECRET: 'a'.repeat(64),
      STILE_ADMIN_PASSWORD: 'shorty',
    },
  });
  assert.equal(r.blocked, true);
  assert.ok(r.issues.some(i => i.includes('≥12')));
});

test('production refuses http:// webhook url', () => {
  const r = config.load({
    env: {
      NODE_ENV: 'production',
      STILE_SECRET: 'a'.repeat(64),
      STILE_WEBHOOK_URL: 'http://example.com/hook',
      STILE_WEBHOOK_SECRET: 'a'.repeat(32),
    },
  });
  assert.equal(r.blocked, true);
});

test('dev mode is permissive (warns, does not block)', () => {
  const r = config.load({ env: {} });
  assert.equal(r.context, 'dev');
  assert.equal(r.blocked, false);
});

test('detectContext picks up host indicators', () => {
  for (const k of config.PROD_ENV_KEYS) {
    assert.equal(config.detectContext({ [k]: '1' }), 'production', `expected production from ${k}`);
  }
});

test('production with no STILE_IP_SALT is blocked', () => {
  const r = config.load({
    env: {
      NODE_ENV: 'production',
      STILE_SECRET: 'a'.repeat(64),
      // STILE_IP_SALT intentionally omitted
    },
  });
  assert.equal(r.blocked, true);
  assert.ok(r.issues.some(i => /STILE_IP_SALT.*unset/i.test(i)),
    'expected an issue mentioning STILE_IP_SALT unset');
});

test('production with the literal default IP salt is blocked', () => {
  const r = config.load({
    env: {
      NODE_ENV: 'production',
      STILE_SECRET: 'a'.repeat(64),
      STILE_IP_SALT: config.DEFAULT_IP_SALT,
    },
  });
  assert.equal(r.blocked, true);
  assert.ok(r.issues.some(i => /STILE_IP_SALT.*literal default/i.test(i)));
});

test('production with a real STILE_IP_SALT boots', () => {
  const r = config.load({
    env: {
      NODE_ENV: 'production',
      STILE_SECRET: 'a'.repeat(64),
      STILE_IP_SALT: crypto.randomBytes(32).toString('hex'),
    },
  });
  assert.equal(r.blocked, false);
  assert.equal(typeof r.values.ipHashSecret, 'string');
  assert.equal(r.values.ipHashSecret.length, 64);
});

test('dev without STILE_IP_SALT gets an ephemeral random salt (not null, not the published default)', () => {
  const r1 = config.load({ env: {} });
  const r2 = config.load({ env: {} });
  assert.equal(r1.blocked, false);
  assert.equal(typeof r1.values.ipHashSecret, 'string');
  assert.ok(r1.values.ipHashSecret.length >= 32, 'ephemeral salt should be ≥32 chars');
  assert.notEqual(r1.values.ipHashSecret, config.DEFAULT_IP_SALT,
    'must not fall back to the published default in dev');
  assert.notEqual(r1.values.ipHashSecret, r2.values.ipHashSecret,
    'each load() in dev should mint a fresh ephemeral salt');
  assert.ok(r1.warnings.some(w => /ephemeral salt/i.test(w)),
    'expected an ephemeral-salt warning in dev');
});
