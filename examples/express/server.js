'use strict';

// Example: protect an Express app with STILE.
// Usage: node examples/express/server.js
//
// Requires `npm install express` if you want to actually run this example.

const express = require('express');
const createStileExpress = require('../../lib/adapters/express');

const app = express();

app.use(createStileExpress({
  secret: process.env.STILE_SECRET || 'dev-secret',
  protect: ['/api/data', '/agents'],
  tier: 'easy',
}));

app.get('/', (_, res) => res.send('<h1>Express + STILE</h1><p>Try /agents or /api/data.</p>'));
app.get('/agents', (_, res) => res.send('<h1>Agent zone</h1><p>You are verified.</p>'));
app.get('/api/data', (_, res) => res.json({ ok: true, message: 'Hello, agent.' }));

app.listen(3001, () => console.log('Express example on http://localhost:3001'));
