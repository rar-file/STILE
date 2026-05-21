'use strict';

const crypto = require('crypto');

function b64url(buf) {
  return Buffer.from(buf).toString('base64')
    .replace(/=+$/g, '').replace(/\+/g, '-').replace(/\//g, '_');
}

function hmac(secret, msg) {
  return b64url(crypto.createHmac('sha256', secret).update(msg).digest());
}

function createHoneypot({ secret, decoyPath = '/__stile-decoy', poisonCookieName = 'stile_blocked', poisonTtl = 24 * 3600 } = {}) {
  if (!secret) throw new Error('honeypot requires a secret');

  function issueDecoyToken() {
    const nonce = b64url(crypto.randomBytes(12));
    const exp = Math.floor(Date.now() / 1000) + 3600;
    const payload = `d.${nonce}.${exp}`;
    const sig = hmac(secret, payload);
    return `${payload}.${sig}`;
  }

  function isDecoyToken(token) {
    if (!token || typeof token !== 'string') return false;
    const parts = token.split('.');
    if (parts.length !== 4 || parts[0] !== 'd') return false;
    const [, nonce, expStr, sig] = parts;
    const expected = hmac(secret, `d.${nonce}.${expStr}`);
    if (sig.length !== expected.length) return false;
    try {
      return crypto.timingSafeEqual(Buffer.from(sig), Buffer.from(expected));
    } catch { return false; }
  }

  function issuePoisonCookie() {
    const exp = Math.floor(Date.now() / 1000) + poisonTtl;
    const nonce = b64url(crypto.randomBytes(8));
    const payload = `p.${nonce}.${exp}`;
    const sig = hmac(secret, payload);
    return `${payload}.${sig}`;
  }

  function isPoisoned(cookieValue) {
    if (!cookieValue) return false;
    const parts = cookieValue.split('.');
    if (parts.length !== 4 || parts[0] !== 'p') return false;
    const [, nonce, expStr, sig] = parts;
    const expected = hmac(secret, `p.${nonce}.${expStr}`);
    if (sig.length !== expected.length) return false;
    try {
      if (!crypto.timingSafeEqual(Buffer.from(sig), Buffer.from(expected))) return false;
    } catch { return false; }
    const exp = parseInt(expStr, 10);
    return Number.isFinite(exp) && exp >= Math.floor(Date.now() / 1000);
  }

  return {
    decoyPath,
    poisonCookieName,
    poisonTtl,
    issueDecoyToken,
    isDecoyToken,
    issuePoisonCookie,
    isPoisoned,
  };
}

module.exports = createHoneypot;
module.exports.createHoneypot = createHoneypot;
