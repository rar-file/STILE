'use strict';

// Read paths into the events/agents/adopters stores: live counter SSE, the
// JSON snapshot the dashboard polls, the summary aggregate, the Wall of
// Agents listing, the adopters listing + badge ping, and the badge.js
// snippet that adopter sites embed.

const { readBody, isPrivateHost } = require('./util');

function counterSnapshot(req, res, { stile }) {
  res.statusCode = 200;
  res.setHeader('Content-Type', 'application/json');
  res.setHeader('Cache-Control', 'no-store');
  res.end(JSON.stringify({
    today: stile.store.events.counterToday(),
    all_time: stile.store.events.counterAllTime(),
  }));
}

function counterStream(req, res, { stile }) {
  res.statusCode = 200;
  res.setHeader('Content-Type', 'text/event-stream');
  res.setHeader('Cache-Control', 'no-store');
  res.setHeader('Connection', 'keep-alive');
  res.flushHeaders && res.flushHeaders();
  const send = () => res.write(`data: ${JSON.stringify({
    today: stile.store.events.counterToday(),
    all_time: stile.store.events.counterAllTime(),
    ts: Date.now(),
  })}\n\n`);
  send();
  let pending = false;
  const unsubscribe = stile.store.events.subscribe((e) => {
    if (e.kind !== 'verified') return;
    if (pending) return;
    pending = true;
    setTimeout(() => { pending = false; send(); }, 500);
  });
  const heartbeat = setInterval(() => res.write(': hb\n\n'), 25_000);
  req.on('close', () => { clearInterval(heartbeat); unsubscribe(); });
}

function summary(req, res, { stile, url }) {
  const range = url.searchParams.get('range') || '24h';
  const rangeMs = range === '7d' ? 7 * 86400e3 : range === '30d' ? 30 * 86400e3 : 86400e3;
  res.statusCode = 200;
  res.setHeader('Content-Type', 'application/json');
  res.setHeader('Cache-Control', 'no-store');
  res.end(JSON.stringify(stile.store.events.summary(rangeMs), null, 2));
}

function wall(req, res, { stile }) {
  const list = stile.store.agents.list({ minVerifications: 1, limit: 200 });
  res.statusCode = 200;
  res.setHeader('Content-Type', 'application/json');
  res.setHeader('Cache-Control', 'no-store');
  res.end(JSON.stringify({ agents: list }, null, 2));
}

function adopters(req, res, { stile }) {
  res.statusCode = 200;
  res.setHeader('Content-Type', 'application/json');
  res.setHeader('Cache-Control', 'no-store');
  res.end(JSON.stringify({ adopters: stile.store.adopters.list() }, null, 2));
}

function badgePing(req, res, { stile }) {
  readBody(req).then(raw => {
    let payload = {};
    try { payload = JSON.parse(raw || '{}'); } catch { /* ignore */ }
    const referer = req.headers.referer || req.headers.origin || '';
    let domain = String(payload.domain || '').toLowerCase().slice(0, 200);
    if (!domain && referer) { try { domain = new URL(referer).hostname; } catch {} }
    if (!domain || isPrivateHost(domain)) {
      res.statusCode = 400;
      res.setHeader('Content-Type', 'application/json');
      res.end(JSON.stringify({ error: 'invalid_domain' }));
      return;
    }
    const refOk = !referer || referer.includes(domain);
    const adopter = stile.store.adopters.upsert(domain, {
      status: refOk ? 'claimed' : 'rejected',
      referer,
    });
    res.statusCode = 200;
    res.setHeader('Content-Type', 'application/json');
    res.end(JSON.stringify({ ok: true, adopter }));
  }).catch(err => {
    res.statusCode = 400; res.setHeader('Content-Type', 'application/json');
    res.end(JSON.stringify({ error: 'bad_request', message: String(err && err.message || err) }));
  });
}

function badgeJs(req, res) {
  res.statusCode = 200;
  res.setHeader('Content-Type', 'application/javascript; charset=utf-8');
  res.setHeader('Cache-Control', 'public, max-age=3600');
  res.end(badgeSnippet());
}

function badgeSnippet() {
  return `(function(){
  var script = document.currentScript;
  var domain = (script && script.dataset.domain) || location.hostname;
  var anonymous = script && script.dataset.anonymous != null;

  // Render badge
  var host = document.createElement('div');
  host.setAttribute('data-stile-badge', '1');
  host.style.cssText = 'all:initial;position:fixed;bottom:14px;right:14px;z-index:2147483647;font-family:ui-sans-serif,system-ui,sans-serif';
  var shadow = host.attachShadow ? host.attachShadow({ mode: 'closed' }) : host;
  shadow.innerHTML = '<style>a{all:unset;cursor:pointer;display:inline-flex;align-items:center;gap:6px;background:rgba(20,18,40,.85);color:#cdc3ff;border:1px solid rgba(167,139,250,.4);padding:6px 10px;border-radius:999px;font-size:11px;letter-spacing:.08em;text-transform:uppercase;backdrop-filter:blur(8px);font-family:inherit}.dot{width:6px;height:6px;border-radius:50%;background:linear-gradient(135deg,#a78bfa,#60a5fa);box-shadow:0 0 6px #a78bfa}</style><a href="https://stile.dev" target="_blank" rel="noopener"><span class="dot"></span>STILE</a>';
  document.body.appendChild(host);

  if (anonymous) return;

  // Self-register
  try {
    fetch((script && script.dataset.endpoint) || 'https://stile.dev/api/badge/ping', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ domain: domain, ts: Date.now() }),
      keepalive: true,
      credentials: 'omit',
    });
  } catch (e) { /* ignore */ }
})();`;
}

module.exports = {
  counterSnapshot,
  counterStream,
  summary,
  wall,
  adopters,
  badgePing,
  badgeJs,
  badgeSnippet,
};
