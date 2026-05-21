'use strict';

// Cloudflare Worker adapter. Workers use Web Fetch primitives. We adapt
// the (request, env, ctx) signature into our Node-shape gate. For state
// (single-use nonces, events), pass an env binding (KV / Durable Object /
// D1) via `opts.store` — the in-memory default will not survive cold starts.

const createStile = require('../stile');

function buildFakeReq(request) {
  const url = new URL(request.url);
  const headers = {};
  request.headers.forEach((v, k) => { headers[k.toLowerCase()] = v; });
  return {
    method: request.method,
    url: url.pathname + url.search,
    headers,
    socket: { remoteAddress: headers['cf-connecting-ip'] || headers['x-forwarded-for'] || null },
    on() {},
  };
}

function buildFakeRes() {
  const headers = {};
  let statusCode = 200;
  let body = '';
  let ended = false;
  return {
    statusCode,
    setHeader(k, v) { headers[k.toLowerCase()] = v; },
    getHeader(k) { return headers[k.toLowerCase()]; },
    removeHeader(k) { delete headers[k.toLowerCase()]; },
    write(c) { body += typeof c === 'string' ? c : new TextDecoder().decode(c); return true; },
    end(c) { if (c) body += typeof c === 'string' ? c : new TextDecoder().decode(c); ended = true; },
    flushHeaders() {},
    isEnded() { return ended; },
    snapshot() { return { statusCode: this.statusCode, headers: { ...headers }, body }; },
  };
}

function createCfWorkerHandler(opts = {}, downstream) {
  const stile = createStile(opts);
  return async function (request, env, ctx) {
    const fakeReq = buildFakeReq(request);
    const fakeRes = buildFakeRes();
    const handled = stile.gate(fakeReq, fakeRes);
    if (handled === true || fakeRes.isEnded()) {
      const snap = fakeRes.snapshot();
      return new Response(snap.body, { status: snap.statusCode, headers: snap.headers });
    }
    const downstreamResp = downstream ? await downstream(request, env, ctx) : new Response('OK');
    if (fakeRes.getHeader('set-cookie')) {
      const newHeaders = new Headers(downstreamResp.headers);
      newHeaders.append('set-cookie', fakeRes.getHeader('set-cookie'));
      return new Response(downstreamResp.body, { status: downstreamResp.status, headers: newHeaders });
    }
    return downstreamResp;
  };
}

module.exports = createCfWorkerHandler;
module.exports.createCfWorkerHandler = createCfWorkerHandler;
