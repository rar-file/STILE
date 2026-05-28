'use strict';

const crypto = require('crypto');

function sign(secret, body) {
  return 'sha256=' + crypto.createHmac('sha256', secret).update(body).digest('hex');
}

function deliver({ url, secret, payload, attempt = 1, maxAttempts = 3 }) {
  const body = JSON.stringify(payload);
  const headers = {
    'Content-Type': 'application/json',
    'User-Agent': 'stile-webhook/1',
  };
  if (secret) headers['X-Stile-Signature'] = sign(secret, body);

  return fetch(url, { method: 'POST', headers, body })
    .then(async (r) => {
      if (r.status >= 500 && attempt < maxAttempts) {
        const delay = Math.min(30_000, 1000 * Math.pow(2, attempt));
        return new Promise(res => setTimeout(res, delay))
          .then(() => deliver({ url, secret, payload, attempt: attempt + 1, maxAttempts }));
      }
      return { ok: r.ok, status: r.status };
    })
    .catch((err) => {
      if (attempt < maxAttempts) {
        const delay = Math.min(30_000, 1000 * Math.pow(2, attempt));
        return new Promise(res => setTimeout(res, delay))
          .then(() => deliver({ url, secret, payload, attempt: attempt + 1, maxAttempts }));
      }
      return { ok: false, error: String(err) };
    });
}

function createWebhook({ url, secret } = {}) {
  if (!url) return { fire: () => {} };
  return {
    fire(event, info) {
      const payload = { event, version: 1, info };
      // Fire and forget — never block the verify response.
      Promise.resolve()
        .then(() => deliver({ url, secret, payload }))
        .then((result) => {
          if (!result.ok) {
            const detail = result.error || `HTTP ${result.status}`;
            console.warn(`[stile] webhook POST ${url} failed: ${detail}`);
          }
        })
        .catch((err) => {
          console.warn(`[stile] webhook POST ${url} error: ${err}`);
        });
    },
  };
}

module.exports = createWebhook;
module.exports.createWebhook = createWebhook;
module.exports.sign = sign;
