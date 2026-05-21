'use strict';

// Next.js middleware adapter. Returns a function compatible with the
// Next.js `middleware.ts` export — accepts a NextRequest and returns
// either a NextResponse (when gating) or undefined (to fall through).
//
// Note: Next.js middleware runs in the Edge runtime by default and may
// restrict node:crypto APIs. To use this adapter, configure your route's
// runtime to 'nodejs' in `export const config = { runtime: 'nodejs' }`.

const createStile = require('../stile');

function buildFakeReq(nextRequest) {
  const headers = {};
  nextRequest.headers.forEach((v, k) => { headers[k.toLowerCase()] = v; });
  return {
    method: nextRequest.method,
    url: nextRequest.nextUrl ? nextRequest.nextUrl.pathname + (nextRequest.nextUrl.search || '') : new URL(nextRequest.url).pathname,
    headers,
    socket: { remoteAddress: headers['x-forwarded-for'] || null },
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
    write(c) { body += typeof c === 'string' ? c : Buffer.from(c).toString('utf8'); return true; },
    end(c) { if (c) body += typeof c === 'string' ? c : Buffer.from(c).toString('utf8'); ended = true; },
    flushHeaders() {},
    isEnded() { return ended; },
    snapshot() { return { statusCode: this.statusCode, headers, body }; },
  };
}

function createStileNext(opts = {}) {
  const stile = createStile(opts);
  return async function middleware(nextRequest) {
    const { NextResponse } = await import('next/server').catch(() => ({ NextResponse: null }));
    if (!NextResponse) throw new Error("stile next adapter requires next/server (Next.js >= 13).");
    const fakeReq = buildFakeReq(nextRequest);
    const fakeRes = buildFakeRes();
    const handled = stile.gate(fakeReq, fakeRes);
    if (handled === true || fakeRes.isEnded()) {
      const snap = fakeRes.snapshot();
      const resp = new NextResponse(snap.body, { status: snap.statusCode, headers: snap.headers });
      return resp;
    }
    const resp = NextResponse.next();
    if (fakeRes.getHeader('set-cookie')) resp.headers.set('set-cookie', fakeRes.getHeader('set-cookie'));
    return resp;
  };
}

module.exports = createStileNext;
module.exports.createStileNext = createStileNext;
