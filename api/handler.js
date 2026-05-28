'use strict';

const crypto = require('crypto');
const createHandler = require('../lib/handler');
const config = require('../lib/config');

// This is the public *demo* entrypoint (e.g. the Vercel deployment). STILE
// correctly refuses to boot in production without a real STILE_SECRET — but a
// zero-config demo deploy often has none, which would 500 every request. If no
// usable secret is configured, generate an ephemeral one so the demo runs in
// normal production posture (sessions just won't survive a cold start). Set
// STILE_SECRET in the platform env for a stable, real secret instead.
const report = config.load();
if (!report.values.secret) {
  report.values.secret = crypto.randomBytes(32).toString('hex');
  report.blocked = false;
  report.issues = [];
}

const handler = createHandler({ config: report });
module.exports = (req, res) => handler(req, res);
