'use strict';

// Factory that wires the stile + admin instances and hands them to the
// routing dispatcher. The bulk of the per-endpoint logic lives in
// lib/handler/{routing,verify,playground,stats,util}.js — this file just
// applies config, constructs collaborators, and returns the wrapped handler.

const path = require('path');
const createStile = require('./stile');
const createAdmin = require('./admin');
const config = require('./config');
const { createAppHandler } = require('./handler/routing');

function createHandler(opts = {}) {
  const root = opts.root || path.join(__dirname, '..');
  const publicDir = opts.publicDir || path.join(root, 'public');
  const templatesDir = opts.templatesDir || path.join(root, 'templates');

  // All deploy-sensitive values flow through the central config layer.
  // Caller can pre-load and pass it in (server.js does); otherwise we load here.
  const report = opts.config || opts.safetyReport || config.load();
  if (report.blocked) {
    throw new Error(
      'STILE refuses to construct a handler with unsafe defaults in production. ' +
      'Issues: ' + report.issues.join(' | ')
    );
  }
  const v = report.values;

  const stile = createStile({
    secret: opts.secret || v.secret,  // null in dev → library generates ephemeral
    ttl: 3600,
    challengeTtl: 180,
    protect: ['/agents', '/api/data'],
    tier: v.tier,
    honeypot: true,
    rules: {
      allow: [],
      deny: [],
    },
    onVerify: (info) => { /* no-op; events store covers it */ },
    webhook: v.webhookUrl ? { url: v.webhookUrl, secret: v.webhookSecret } : null,
    ipHashSecret: v.ipHashSecret,
    store: v.store,           // 'memory' | 'file' | 'file:./path' (resolved by createStile)
    storePath: v.storePath,
  });

  const admin = createAdmin({
    password: v.adminPassword,
    enabled: v.adminEnabled,
    loopbackOnly: v.adminLoopbackOnly,
    stile,
  });

  const appHandler = createAppHandler({ stile, admin, publicDir, templatesDir });
  return stile.wrap(appHandler);
}

module.exports = createHandler;
module.exports.createHandler = createHandler;
