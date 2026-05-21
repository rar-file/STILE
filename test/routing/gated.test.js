'use strict';

// Routing: gated routes — /agents and /api/data — challenge unverified
// clients with the right shape per Accept header.

const test = require('node:test');
const assert = require('node:assert/strict');
const { startHandler, request } = require('./helper');

test('GET /api/data without verify → JSON 401 challenge envelope', async () => {
  const { server, port } = await startHandler();
  try {
    const r = await request(port, '/api/data', { headers: { accept: 'application/json' } });
    assert.equal(r.status, 401);
    assert.match(r.headers['content-type'], /application\/json/);
    const j = JSON.parse(r.body);
    assert.equal(j.error, 'ai_verification_required');
    assert.equal(j.protocol, 'stile/v1');
    assert.match(j.verify_url, /^\/__stile-verify\?token=/);
    assert.ok(j.challenge_word, 'challenge_word must be present');
    assert.ok(j.expires_at, 'expires_at must be present');
  } finally { server.close(); }
});

test('GET /api/data with HTML Accept → 401 HTML gate page', async () => {
  const { server, port } = await startHandler();
  try {
    const r = await request(port, '/api/data', { headers: { accept: 'text/html' } });
    assert.equal(r.status, 401);
    assert.match(r.headers['content-type'], /text\/html/);
    assert.match(r.body, /STILE/);
    // The hidden block is injected; it MUST contain a verify URL.
    assert.match(r.body, /__stile-verify\?token=/);
  } finally { server.close(); }
});

test('GET /agents with HTML accept → 401 gate page with challenge block', async () => {
  // /agents is in `protect`. Unverified HTML clients get the fallback gate
  // page (status 401) with the challenge block embedded — they never see
  // the templated /agents page until they verify.
  const { server, port } = await startHandler();
  try {
    const r = await request(port, '/agents', { headers: { accept: 'text/html' } });
    assert.equal(r.status, 401);
    assert.match(r.headers['content-type'], /text\/html/);
    assert.match(r.body, /__stile-verify\?token=/);
  } finally { server.close(); }
});

test('GET /agents with JSON accept → 401 challenge envelope', async () => {
  const { server, port } = await startHandler();
  try {
    const r = await request(port, '/agents', { headers: { accept: 'application/json' } });
    assert.equal(r.status, 401);
    const j = JSON.parse(r.body);
    assert.equal(j.protocol, 'stile/v1');
  } finally { server.close(); }
});

test('after /__stile-verify, /api/data returns 200 with the catalog', async () => {
  const { server, port } = await startHandler();
  try {
    // Step 1: get a challenge
    const a = await request(port, '/api/data', { headers: { accept: 'application/json' } });
    const j = JSON.parse(a.body);
    // Step 2: redeem the verify URL, capture the cookie
    const v = await request(port, j.verify_url);
    assert.equal(v.status, 200);
    const setCookie = v.headers['set-cookie'][0];
    const cookieValue = setCookie.split(';')[0]; // "stile=..."
    // Step 3: subsequent gated request with that cookie passes
    const data = await request(port, '/api/data', {
      headers: { accept: 'application/json', cookie: cookieValue },
    });
    assert.equal(data.status, 200);
    const payload = JSON.parse(data.body);
    assert.equal(payload.ok, true);
    assert.ok(Array.isArray(payload.catalog));
  } finally { server.close(); }
});
