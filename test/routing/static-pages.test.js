'use strict';

// Routing: the static / templated HTML pages render and serve a 200.

const test = require('node:test');
const assert = require('node:assert/strict');
const { startHandler, request } = require('./helper');

test('GET / serves index.html', async () => {
  const { server, port } = await startHandler();
  try {
    const r = await request(port, '/');
    assert.equal(r.status, 200);
    assert.match(r.headers['content-type'], /text\/html/);
    assert.match(r.body, /<title>STILE/i);
  } finally { server.close(); }
});

test('GET /spec serves spec.html', async () => {
  const { server, port } = await startHandler();
  try {
    const r = await request(port, '/spec');
    assert.equal(r.status, 200);
    assert.match(r.headers['content-type'], /text\/html/);
  } finally { server.close(); }
});

for (const p of ['/playground', '/wall', '/dashboard', '/adopters', '/examples']) {
  test(`GET ${p} serves an HTML page`, async () => {
    const { server, port } = await startHandler();
    try {
      const r = await request(port, p);
      assert.equal(r.status, 200, `${p} should be 200`);
      assert.match(r.headers['content-type'], /text\/html/);
    } finally { server.close(); }
  });
}

for (const slug of ['news', 'docs', 'shop', 'jobs', 'weather']) {
  test(`GET /examples/${slug} serves a mock site`, async () => {
    const { server, port } = await startHandler();
    try {
      const r = await request(port, `/examples/${slug}`);
      assert.equal(r.status, 200);
    } finally { server.close(); }
  });
}

test('GET unknown path → 404', async () => {
  const { server, port } = await startHandler();
  try {
    const r = await request(port, '/this-route-does-not-exist-anywhere');
    assert.equal(r.status, 404);
  } finally { server.close(); }
});

test('GET path-traversal-y URL does not escape publicDir', async () => {
  const { server, port } = await startHandler();
  try {
    const r = await request(port, '/../package.json');
    // Either 404 or 200 of an in-publicDir file — but never package.json.
    assert.notEqual(r.body.includes('"name": "stile"'), true,
      'must not serve package.json from above publicDir');
  } finally { server.close(); }
});
