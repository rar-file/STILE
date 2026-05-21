'use strict';

// Routing: the badge ping accepts a public-looking domain and rejects
// loopback / private hosts to prevent self-registration spoofing.

const test = require('node:test');
const assert = require('node:assert/strict');
const { startHandler, request } = require('./helper');

test('POST /api/badge/ping with a public domain → 200 + adopter record', async () => {
  const { server, port } = await startHandler();
  try {
    const r = await request(port, '/api/badge/ping', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ domain: 'example.com' }),
    });
    assert.equal(r.status, 200);
    const j = JSON.parse(r.body);
    assert.equal(j.ok, true);
    assert.equal(j.adopter.domain, 'example.com');
  } finally { server.close(); }
});

test('POST /api/badge/ping with localhost → 400', async () => {
  const { server, port } = await startHandler();
  try {
    const r = await request(port, '/api/badge/ping', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ domain: 'localhost' }),
    });
    assert.equal(r.status, 400);
    assert.equal(JSON.parse(r.body).error, 'invalid_domain');
  } finally { server.close(); }
});

test('POST /api/badge/ping with 127.0.0.1 → 400', async () => {
  const { server, port } = await startHandler();
  try {
    const r = await request(port, '/api/badge/ping', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ domain: '127.0.0.1' }),
    });
    assert.equal(r.status, 400);
  } finally { server.close(); }
});

test('POST /api/badge/ping with no domain and no referer → 400', async () => {
  const { server, port } = await startHandler();
  try {
    const r = await request(port, '/api/badge/ping', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({}),
    });
    assert.equal(r.status, 400);
  } finally { server.close(); }
});
