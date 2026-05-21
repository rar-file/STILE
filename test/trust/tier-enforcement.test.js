'use strict';

// Trust-critical: tier enforcement at the verify endpoint.
//   easy   → token alone
//   medium → token + word
//   strong → token + word + agent

const test = require('node:test');
const assert = require('node:assert/strict');
const http = require('node:http');
const createStile = require('../../lib/stile');

const SECRET = 'e'.repeat(64);

function startServer(opts = {}) {
  const stile = createStile({ secret: SECRET, protect: ['/gated'], ...opts });
  const server = http.createServer(stile.wrap((req, res) => {
    res.statusCode = 200; res.end('pass');
  }));
  return new Promise(resolve => server.listen(0, '127.0.0.1', () => resolve({ server, stile, port: server.address().port })));
}

function get(port, path) {
  return new Promise((resolve, reject) => {
    http.request({ host: '127.0.0.1', port, path }, (res) => {
      const chunks = [];
      res.on('data', c => chunks.push(c));
      res.on('end', () => resolve({ status: res.statusCode, body: Buffer.concat(chunks).toString('utf8') }));
    }).on('error', reject).end();
  });
}

test('easy tier accepts token without word', async () => {
  const { server, stile, port } = await startServer({ tier: 'easy' });
  try {
    const c = stile.issueChallenge({ tier: 'easy' });
    const r = await get(port, `/__stile-verify?token=${encodeURIComponent(c.token)}`);
    assert.equal(r.status, 200);
  } finally { server.close(); }
});

test('medium tier rejects token without word', async () => {
  const { server, stile, port } = await startServer({ tier: 'medium' });
  try {
    const c = stile.issueChallenge({ tier: 'medium' });
    const r = await get(port, `/__stile-verify?token=${encodeURIComponent(c.token)}`);
    assert.equal(r.status, 400);
    assert.equal(JSON.parse(r.body).error, 'challenge_word_required');
  } finally { server.close(); }
});

test('medium tier rejects token + wrong word', async () => {
  const { server, stile, port } = await startServer({ tier: 'medium' });
  try {
    const c = stile.issueChallenge({ tier: 'medium' });
    const r = await get(port, `/__stile-verify?token=${encodeURIComponent(c.token)}&word=not-the-word`);
    assert.equal(r.status, 400);
  } finally { server.close(); }
});

test('medium tier accepts token + correct word', async () => {
  const { server, stile, port } = await startServer({ tier: 'medium' });
  try {
    const c = stile.issueChallenge({ tier: 'medium' });
    const r = await get(port, `/__stile-verify?token=${encodeURIComponent(c.token)}&word=${encodeURIComponent(c.word)}`);
    assert.equal(r.status, 200);
  } finally { server.close(); }
});

test('strong tier rejects without agent', async () => {
  const { server, stile, port } = await startServer({ tier: 'strong' });
  try {
    const c = stile.issueChallenge({ tier: 'strong' });
    const r = await get(port, `/__stile-verify?token=${encodeURIComponent(c.token)}&word=${encodeURIComponent(c.word)}`);
    assert.equal(r.status, 400);
    assert.equal(JSON.parse(r.body).error, 'agent_declaration_required');
  } finally { server.close(); }
});

test('strong tier accepts token + word + agent', async () => {
  const { server, stile, port } = await startServer({ tier: 'strong' });
  try {
    const c = stile.issueChallenge({ tier: 'strong' });
    const r = await get(port, `/__stile-verify?token=${encodeURIComponent(c.token)}&word=${encodeURIComponent(c.word)}&agent=acme%2Fbot-1`);
    assert.equal(r.status, 200);
    const j = JSON.parse(r.body);
    assert.equal(j.agent_echo, 'acme/bot-1');
  } finally { server.close(); }
});
