'use strict';

// Example: protect a Hono app with STILE (Node runtime).
// Requires `npm install hono @hono/node-server` to run.

const { Hono } = require('hono');
const { serve } = require('@hono/node-server');
const createStileHono = require('../../lib/adapters/hono');

const app = new Hono();
app.use('*', createStileHono({
  secret: process.env.STILE_SECRET || 'dev-secret',
  protect: ['/api/data', '/agents'],
}));
app.get('/', (c) => c.html('<h1>Hono + STILE</h1>'));
app.get('/agents', (c) => c.html('<h1>Agent zone</h1>'));
app.get('/api/data', (c) => c.json({ ok: true, message: 'Hello, agent.' }));

serve({ fetch: app.fetch, port: 3002 }, () => console.log('Hono example on http://localhost:3002'));
