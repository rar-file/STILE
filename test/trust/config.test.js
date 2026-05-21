'use strict';

// Trust-critical: production posture must refuse to boot when the
// secret is missing, weak, or the published demo string.

const test = require('node:test');
const assert = require('node:assert/strict');
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
      // Need to satisfy bind-host check + admin
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
