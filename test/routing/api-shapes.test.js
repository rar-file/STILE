'use strict';

// Routing: the JSON shapes for the inspection / stats / wall / adopters /
// schema endpoints. Locks the wire contract documented in docs/API.md.

const test = require('node:test');
const assert = require('node:assert/strict');
const { startHandler, request } = require('./helper');

test('GET /api/peek returns inspection envelope with the documented keys', async () => {
  const { server, port } = await startHandler();
  try {
    const r = await request(port, '/api/peek');
    assert.equal(r.status, 200);
    const j = JSON.parse(r.body);
    for (const k of ['what_humans_see', 'what_ais_see', 'verify_url',
      'challenge_word', 'tier', 'expires_at', 'channels']) {
      assert.ok(k in j, `missing ${k}`);
    }
    for (const k of ['comment', 'jsonld', 'aria_hidden_text', 'svg_title',
      'meta_tags', 'honeypot_decoy_url']) {
      assert.ok(k in j.channels, `missing channels.${k}`);
    }
  } finally { server.close(); }
});

test('GET /api/peek?tier=strong respects the tier override', async () => {
  const { server, port } = await startHandler();
  try {
    const r = await request(port, '/api/peek?tier=strong');
    const j = JSON.parse(r.body);
    assert.equal(j.tier, 'strong');
  } finally { server.close(); }
});

test('GET /api/peek?tier=garbage falls back to default', async () => {
  const { server, port } = await startHandler();
  try {
    const r = await request(port, '/api/peek?tier=hax');
    assert.equal(r.status, 200);
    const j = JSON.parse(r.body);
    assert.ok(['easy', 'medium', 'strong'].includes(j.tier));
  } finally { server.close(); }
});

test('GET /api/stats/counter returns today/all_time numbers', async () => {
  const { server, port } = await startHandler();
  try {
    const r = await request(port, '/api/stats/counter');
    assert.equal(r.status, 200);
    const j = JSON.parse(r.body);
    assert.equal(typeof j.today, 'number');
    assert.equal(typeof j.all_time, 'number');
  } finally { server.close(); }
});

test('GET /api/stats/summary returns a structured aggregate', async () => {
  const { server, port } = await startHandler();
  try {
    const r = await request(port, '/api/stats/summary');
    assert.equal(r.status, 200);
    const j = JSON.parse(r.body);
    for (const k of ['range_ms', 'series', 'totals', 'top_agents', 'tiers', 'total_events']) {
      assert.ok(k in j, `missing ${k}`);
    }
  } finally { server.close(); }
});

test('GET /api/wall returns an agents list', async () => {
  const { server, port } = await startHandler();
  try {
    const r = await request(port, '/api/wall');
    assert.equal(r.status, 200);
    const j = JSON.parse(r.body);
    assert.ok(Array.isArray(j.agents));
  } finally { server.close(); }
});

test('GET /api/adopters returns an adopters list', async () => {
  const { server, port } = await startHandler();
  try {
    const r = await request(port, '/api/adopters');
    assert.equal(r.status, 200);
    const j = JSON.parse(r.body);
    assert.ok(Array.isArray(j.adopters));
  } finally { server.close(); }
});

test('GET /v1/challenge.schema.json returns the JSON schema', async () => {
  const { server, port } = await startHandler();
  try {
    const r = await request(port, '/v1/challenge.schema.json');
    assert.equal(r.status, 200);
    assert.match(r.headers['content-type'], /schema\+json|json/);
    const j = JSON.parse(r.body);
    assert.equal(j.title, 'StileChallenge');
    assert.deepEqual(j.required.sort(),
      ['expires_at', 'protocol', 'tier', 'verify_url', 'word'].sort());
  } finally { server.close(); }
});

test('GET /badge.js returns the JS snippet with the right Content-Type', async () => {
  const { server, port } = await startHandler();
  try {
    const r = await request(port, '/badge.js');
    assert.equal(r.status, 200);
    assert.match(r.headers['content-type'], /application\/javascript/);
    assert.match(r.body, /data-stile-badge/);
  } finally { server.close(); }
});
