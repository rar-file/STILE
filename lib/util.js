'use strict';

// Shared low-level helpers used across the library. Kept dependency-free and
// side-effect-free so any module can require it without ordering concerns.

const crypto = require('crypto');

function b64url(buf) {
  return Buffer.from(buf).toString('base64')
    .replace(/=+$/g, '').replace(/\+/g, '-').replace(/\//g, '_');
}

function hmac(secret, msg) {
  return b64url(crypto.createHmac('sha256', secret).update(msg).digest());
}

// Constant-time string compare that never throws on length mismatch.
function safeEq(a, b) {
  if (!a || !b || a.length !== b.length) return false;
  try { return crypto.timingSafeEqual(Buffer.from(a), Buffer.from(b)); } catch { return false; }
}

function htmlEscape(s) {
  return String(s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
}

function todayIso() {
  return new Date().toISOString().slice(0, 10);
}

// Build a URL from an incoming request without trusting the Host header to be
// well-formed. A request with `Host: bad host name` would make `new URL()`
// throw; rather than crash the request (and, without a try/catch around the
// gate, the whole process), fall back to a localhost authority. The path and
// query come from req.url, which Node has already validated.
function requestUrl(req) {
  const host = (req.headers && req.headers.host) || 'localhost';
  for (const base of [`http://${host}`, 'http://localhost']) {
    try { return new URL(req.url, base); } catch { /* try next base */ }
  }
  return new URL('/', 'http://localhost');
}

function readBody(req, max = 16 * 1024) {
  return new Promise((resolve, reject) => {
    const chunks = []; let total = 0;
    req.on('data', (c) => {
      total += c.length;
      if (total > max) { req.destroy(); reject(new Error('body_too_large')); return; }
      chunks.push(c);
    });
    req.on('end', () => resolve(Buffer.concat(chunks).toString('utf8')));
    req.on('error', reject);
  });
}

module.exports = { b64url, hmac, safeEq, htmlEscape, todayIso, requestUrl, readBody };
