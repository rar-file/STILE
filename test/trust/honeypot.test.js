'use strict';

// Trust-critical: honeypot decoy tokens and the poison cookie that
// follows from triggering them.

const test = require('node:test');
const assert = require('node:assert/strict');
const createHoneypot = require('../../lib/honeypot');

test('issued decoy token is recognized', () => {
  const h = createHoneypot({ secret: 'sekret-secret-32-chars-long-padding' });
  const tok = h.issueDecoyToken();
  assert.ok(h.isDecoyToken(tok));
});

test('forged decoy token is rejected', () => {
  const h = createHoneypot({ secret: 'sekret-secret-32-chars-long-padding' });
  // A token that looks similar but isn't signed.
  assert.equal(h.isDecoyToken('d.aaa.123.fakefake'), false);
  assert.equal(h.isDecoyToken('not-a-token'), false);
  assert.equal(h.isDecoyToken(null), false);
  assert.equal(h.isDecoyToken(''), false);
});

test('decoy issued by one secret is not valid under another', () => {
  const a = createHoneypot({ secret: 'a-secret-with-enough-padding-here-aaa' });
  const b = createHoneypot({ secret: 'b-secret-with-enough-padding-here-bbb' });
  const tok = a.issueDecoyToken();
  assert.equal(b.isDecoyToken(tok), false);
});

test('issued poison cookie is recognized as poisoned', () => {
  const h = createHoneypot({ secret: 'p-secret-with-enough-padding-here-pp' });
  const cookie = h.issuePoisonCookie();
  assert.equal(h.isPoisoned(cookie), true);
});

test('forged poison cookie is rejected', () => {
  const h = createHoneypot({ secret: 'p-secret-with-enough-padding-here-pp' });
  assert.equal(h.isPoisoned('p.x.99999999999.forged'), false);
  assert.equal(h.isPoisoned('not-a-cookie'), false);
  assert.equal(h.isPoisoned(null), false);
});
