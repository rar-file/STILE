'use strict';

const http = require('node:http');
const createHandler = require('../../lib/handler');

function startHandler() {
  const handler = createHandler({
    config: {
      context: 'dev',
      values: {
        secret: 'a'.repeat(64),
        adminPassword: null,
        adminEnabled: false,
        adminLoopbackOnly: false,
        ipHashSecret: 'salt-for-tests',
        tier: 'easy',
        webhookUrl: null,
        webhookSecret: null,
        store: 'memory',
        storePath: null,
        bindHost: null,
      },
      checks: [],
      issues: [],
      warnings: [],
      blocked: false,
    },
  });
  const server = http.createServer(handler);
  return new Promise((resolve) => {
    server.listen(0, '127.0.0.1', () => {
      resolve({ server, port: server.address().port });
    });
  });
}

function request(port, path, { method = 'GET', headers = {}, body } = {}) {
  return new Promise((resolve, reject) => {
    const req = http.request({ host: '127.0.0.1', port, path, method, headers }, (res) => {
      const chunks = [];
      res.on('data', (c) => chunks.push(c));
      res.on('end', () => resolve({
        status: res.statusCode,
        headers: res.headers,
        body: Buffer.concat(chunks).toString('utf8'),
      }));
    });
    req.on('error', reject);
    if (body) req.write(body);
    req.end();
  });
}

module.exports = { startHandler, request };
