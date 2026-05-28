'use strict';

// /health endpoint contract. A load-balancer probe should get 200 with
// { ok: true, store, uptime } when the store is reachable.

const test = require('node:test');
const assert = require('node:assert/strict');
const { startHandler, request } = require('./helper');

test('GET /health returns 200 with ok/store/uptime fields', async () => {
  const { server, port } = await startHandler();
  try {
    const r = await request(port, '/health');
    assert.equal(r.status, 200);
    assert.equal(r.headers['content-type'], 'application/json');
    const j = JSON.parse(r.body);
    assert.equal(j.ok, true);
    assert.ok(['memory', 'file'].includes(j.store), `unexpected store: ${j.store}`);
    assert.equal(typeof j.uptime, 'number');
    assert.ok(j.uptime >= 0);
  } finally { server.close(); }
});

test('GET /health reports store type as memory for the default config', async () => {
  const { server, port } = await startHandler();
  try {
    const r = await request(port, '/health');
    const j = JSON.parse(r.body);
    assert.equal(j.store, 'memory');
  } finally { server.close(); }
});
