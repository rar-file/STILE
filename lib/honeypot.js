'use strict';

const crypto = require('crypto');
const { b64url, hmac, safeEq } = require('./util');

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
    if (!safeEq(sig, expected)) return false;
    // Honor the signed expiry, like isPoisoned does. A decoy URL is re-issued
    // fresh on every page render, so an honest scraper trips it within seconds;
    // enforcing exp only ignores stale tokens replayed long after issuance.
    const exp = parseInt(expStr, 10);
    return Number.isFinite(exp) && exp >= Math.floor(Date.now() / 1000);
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
    if (!safeEq(sig, expected)) return false;
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
