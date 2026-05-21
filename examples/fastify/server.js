'use strict';

// Example: protect a Fastify app with STILE.
// Requires `npm install fastify` to run.

const Fastify = require('fastify');
const createStileFastify = require('../../lib/adapters/fastify');

const app = Fastify();
app.register(createStileFastify({
  secret: process.env.STILE_SECRET || 'dev-secret',
  protect: ['/api/data', '/agents'],
}));

app.get('/', (_, reply) => reply.type('text/html').send('<h1>Fastify + STILE</h1>'));
app.get('/agents', (_, reply) => reply.type('text/html').send('<h1>Agent zone</h1>'));
app.get('/api/data', (_, reply) => reply.send({ ok: true, message: 'Hello, agent.' }));

app.listen({ port: 3003 }).then(() => console.log('Fastify example on http://localhost:3003'));
