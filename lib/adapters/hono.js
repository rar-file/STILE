'use strict';

// Hono adapter. Hono uses the Web Fetch (Request/Response) API, which is
// different shape from Node http. We adapt by:
//   1. Capturing the incoming Request → synthesize a minimal Node-like req
//   2. Building a "fake" res that records statusCode, headers and body
//   3. Running our gate; if the gate ends the response, return a Response;
//      otherwise call next() so Hono handles it.

const createStile = require('../stile');

function buildFakeReq(c) {
  const req = c.req.raw; // Web Request
  const url = new URL(req.url);
  const headers = {};
  req.headers.forEach((v, k) => { headers[k.toLowerCase()] = v; });
  // Cookie header (Hono normalizes to req.header('cookie'))
  if (!headers.cookie && c.req.header('cookie')) headers.cookie = c.req.header('cookie');
  return {
    method: req.method,
    url: url.pathname + url.search,
    headers,
    socket: { remoteAddress: c.req.header('x-forwarded-for') || null },
    on() {}, // body stream not needed for gate-only paths
  };
}

function buildFakeRes() {
  const headers = {};
  let statusCode = 200;
  let body = '';
  let ended = false;
  return {
    statusCode,
    headers,
    setHeader(k, v) { headers[k.toLowerCase()] = v; },
    getHeader(k) { return headers[k.toLowerCase()]; },
    removeHeader(k) { delete headers[k.toLowerCase()]; },
    write(c) { body += typeof c === 'string' ? c : Buffer.from(c).toString('utf8'); return true; },
    end(c) { if (c) body += typeof c === 'string' ? c : Buffer.from(c).toString('utf8'); ended = true; this._final = { statusCode: this.statusCode, headers: this.headers, body }; },
    flushHeaders() {},
    isEnded() { return ended; },
    snapshot() { return { statusCode: this.statusCode, headers: { ...headers }, body }; },
  };
}

function createStileHono(opts = {}) {
  const stile = createStile(opts);
  return async function (c, next) {
    const fakeReq = buildFakeReq(c);
    const fakeRes = buildFakeRes();
    const handled = stile.gate(fakeReq, fakeRes);
    if (handled === true || fakeRes.isEnded()) {
      const snap = fakeRes.snapshot();
      const resp = new Response(snap.body, { status: snap.statusCode, headers: snap.headers });
      return resp;
    }
    // Forward Set-Cookie from fast-path
    if (fakeRes.getHeader('set-cookie')) c.header('set-cookie', fakeRes.getHeader('set-cookie'));
    return next();
  };
}

module.exports = createStileHono;
module.exports.createStileHono = createStileHono;
