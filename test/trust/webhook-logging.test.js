'use strict';

// Webhook delivery failure logging. Ensures operators get a console.warn
// when a webhook endpoint returns a non-2xx status, rather than a silent no-op.

const test = require('node:test');
const assert = require('node:assert/strict');
const createWebhook = require('../../lib/webhook');

function captureWarn(fn) {
  const messages = [];
  const orig = console.warn;
  console.warn = (...args) => messages.push(args.join(' '));
  return fn().finally(() => { console.warn = orig; }).then(() => messages);
}

test('fire() logs a warning when endpoint returns a non-2xx status', async () => {
  const origFetch = globalThis.fetch;
  // 403 is non-retryable — deliver() resolves immediately with { ok: false, status: 403 }.
  globalThis.fetch = async () => ({ ok: false, status: 403 });
  try {
    const wh = createWebhook({ url: 'http://localhost:9999/hook', secret: 'x'.repeat(32) });
    const warned = await captureWarn(() => {
      wh.fire('verify', { kind: 'verified' });
      return new Promise(r => setTimeout(r, 50));
    });
    assert.ok(warned.length > 0, 'expected at least one console.warn call');
    assert.ok(warned[0].includes('failed'), `warning should mention "failed": ${warned[0]}`);
    assert.ok(warned[0].includes('HTTP 403'), `warning should include status: ${warned[0]}`);
  } finally {
    globalThis.fetch = origFetch;
  }
});

test('fire() does not warn when endpoint returns 2xx', async () => {
  const origFetch = globalThis.fetch;
  globalThis.fetch = async () => ({ ok: true, status: 200 });
  try {
    const wh = createWebhook({ url: 'http://localhost:9999/hook', secret: 'x'.repeat(32) });
    const warned = await captureWarn(() => {
      wh.fire('verify', { kind: 'verified' });
      return new Promise(r => setTimeout(r, 50));
    });
    assert.equal(warned.length, 0, `expected no warnings on success, got: ${warned}`);
  } finally {
    globalThis.fetch = origFetch;
  }
});

test('fire() is a no-op when no url is configured', async () => {
  const wh = createWebhook();
  const warned = await captureWarn(() => {
    wh.fire('verify', { kind: 'verified' });
    return new Promise(r => setTimeout(r, 20));
  });
  assert.equal(warned.length, 0, 'no-op webhook must not warn');
});
