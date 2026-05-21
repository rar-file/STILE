'use strict';

// ============================================================================
//  AGENT MARKET — a tiny demo storefront an AI agent can DO things on.
//
//  The HUMAN side is a single Mondrian-styled landing page that says "this
//  site is for AI agents."  The AGENT side is gated by STILE — once a client
//  walks the handshake, it can read the catalog and POST orders.
//
//  Each successful verification AND each order fires a Discord webhook.
//
//  Run:   node examples/agent-market/server.js     (defaults to port 3001)
//
//  Discord notifications: set AGENT_MARKET_DISCORD_WEBHOOK in your env
//  to a webhook URL from your channel's integrations settings. Without
//  it, the example runs fine — Discord notifications are skipped.
//
//  Do not commit a webhook URL to source. If you have an old one in
//  your shell history from earlier versions of this file, rotate it
//  in Discord (Channel → Integrations → Webhooks → Delete) before
//  running this in a place where the URL might leak.
// ============================================================================

const http = require('http');
const fs   = require('fs');
const path = require('path');
const createStile = require('../../lib/stile');

const PORT = process.env.PORT || 3001;
const DISCORD_WEBHOOK = process.env.AGENT_MARKET_DISCORD_WEBHOOK || null;

const catalog = JSON.parse(fs.readFileSync(path.join(__dirname, 'catalog.json'), 'utf8'));
const orders  = [];   // { id, sku, qty, agent, shipping_to, total, ts }

// ---------------------------------------------------------------------------
//  Discord notifier  (fire-and-forget, never blocks the response)
// ---------------------------------------------------------------------------
function discord(content, embeds) {
  if (!DISCORD_WEBHOOK) return;
  const body = JSON.stringify({ content, embeds, username: 'agent-market', allowed_mentions: { parse: [] } });
  Promise.resolve().then(() =>
    fetch(DISCORD_WEBHOOK, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body,
    }).catch(() => { /* swallow */ })
  );
}

// ---------------------------------------------------------------------------
//  STILE — gate the agent endpoints
// ---------------------------------------------------------------------------
const stile = createStile({
  secret: process.env.STILE_SECRET || 'agent-market-demo-secret-rotate-me',
  protect: ['/agents', '/api/data', '/api/order', '/api/orders'],
  tier: process.env.STILE_TIER || 'strong',
  ttl: 3600,
  challengeTtl: 180,
  honeypot: true,
  // We use onVerify (not the generic webhook) so we can format the message
  // for Discord's specific payload schema.
  onVerify: (info) => {
    discord(null, [{
      title: '🚪 STILE — agent verified',
      color: 0x1949b8,
      fields: [
        { name: 'agent',     value: '`' + (info.agent || '(anonymous)') + '`',   inline: true },
        { name: 'tier',      value: '`' + (info.tier  || 'easy')         + '`',  inline: true },
        { name: 'fast-path', value: '`' + (info.fast_path || 'challenge') + '`', inline: true },
      ],
      footer: { text: 'agent-market · ' + new Date().toISOString() },
    }]);
  },
});

// ---------------------------------------------------------------------------
//  Human-facing landing (Mondrian, inline CSS — no static dir needed)
// ---------------------------------------------------------------------------
function humanLanding() {
  return `<!doctype html>
<html lang="en"><head><meta charset="utf-8"><title>AGENT MARKET — a demo store for AI agents</title>
<meta name="viewport" content="width=device-width,initial-scale=1">
<style>
@import url('https://fonts.googleapis.com/css2?family=Inter:wght@400;700;900&family=JetBrains+Mono:wght@400;700&display=swap');
*{box-sizing:border-box;margin:0;padding:0}
:root{--red:#d62828;--blue:#1949b8;--yellow:#f6c11c;--black:#0a0a0a;--paper:#f4efe2;--lw:8px}
html,body{font-family:'Inter',sans-serif;background:var(--paper);color:var(--black);min-height:100vh;line-height:1.5}
.nav{display:flex;justify-content:space-between;align-items:center;padding:18px 36px;border-bottom:var(--lw) solid var(--black)}
.brand{display:flex;align-items:center;gap:14px}
.swatch{display:inline-flex}.swatch span{width:16px;height:16px;border:2px solid var(--black);display:inline-block}
.r{background:var(--red)}.b{background:var(--blue)}.y{background:var(--yellow)}
.name{font-weight:900;font-size:24px;letter-spacing:-.02em}
.tag{font-weight:700;font-size:11px;letter-spacing:.18em;text-transform:uppercase;border:2px solid var(--black);padding:3px 8px;margin-left:4px}
.composition{display:grid;grid-template-columns:repeat(12,1fr);border-left:var(--lw) solid var(--black);border-right:var(--lw) solid var(--black)}
.cell{padding:32px 36px;border-bottom:var(--lw) solid var(--black);border-right:var(--lw) solid var(--black)}
.cell.no-r{border-right:none}.cell.b{background:var(--blue);color:#fff}.cell.y{background:var(--yellow)}
.cell.r{background:var(--red);color:#fff}.cell.k{background:var(--black);color:var(--paper)}
.s4{grid-column:span 4}.s5{grid-column:span 5}.s7{grid-column:span 7}.s8{grid-column:span 8}.s12{grid-column:span 12}
@media(max-width:900px){.s4,.s5,.s7,.s8{grid-column:span 12}}
.label{font-size:11px;letter-spacing:.18em;text-transform:uppercase;font-weight:700;display:block;margin-bottom:14px}
.label::before{content:'★ '}
h1{font-size:clamp(56px,7vw,100px);font-weight:900;letter-spacing:-.04em;line-height:.92}
h2{font-size:34px;font-weight:900;letter-spacing:-.02em;line-height:1}
h3{font-size:18px;font-weight:900;margin-top:8px}
.lead{margin-top:18px;font-size:18px;line-height:1.5;max-width:60ch}
pre{font-family:'JetBrains Mono',monospace;font-size:12px;line-height:1.55;border:2px solid var(--black);padding:14px 16px;margin-top:14px;overflow-x:auto;background:var(--paper)}
.cell.k pre{background:var(--black);color:var(--paper);border-color:#fff}
.btn{display:inline-block;padding:9px 14px;border:2px solid var(--black);font-weight:700;font-size:12px;letter-spacing:.06em;text-transform:uppercase;text-decoration:none;background:var(--paper);color:var(--black);margin-right:8px;margin-top:14px}
.btn.solid{background:var(--black);color:var(--paper)}
.cell.b .btn,.cell.r .btn,.cell.k .btn{border-color:#fff;color:#fff;background:transparent}
.legend{padding:18px 36px;display:flex;justify-content:space-between;font-size:11px;letter-spacing:.18em;text-transform:uppercase;font-weight:700;border-top:var(--lw) solid var(--black);background:var(--paper);flex-wrap:wrap;gap:12px}
footer{padding:16px 36px;background:var(--black);color:var(--paper);display:flex;justify-content:space-between;font-size:12px;letter-spacing:.18em;text-transform:uppercase;font-weight:700}
</style></head><body>
<nav class="nav">
  <div class="brand">
    <span class="swatch"><span class="r"></span><span class="b"></span><span class="y"></span></span>
    <span class="name">AGENT MARKET</span>
    <span class="tag">demo · powered by STILE</span>
  </div>
  <span class="tag" style="border-color:#0a0a0a">${orders.length} orders today</span>
</nav>

<section class="composition">

  <div class="cell s8">
    <span class="label">A storefront for AI agents</span>
    <h1>This shop is<br>for the bots.</h1>
    <p class="lead">A tiny demo store where AI agents can browse a catalog and place orders programmatically. Humans are welcome to look around — but the action lives behind the STILE gate.</p>
    <div>
      <a class="btn solid" href="/agents">Open the agent landing →</a>
      <a class="btn" href="/api/data">View catalog (JSON)</a>
    </div>
  </div>

  <div class="cell y s4 no-r">
    <span class="label">For your AI</span>
    <h3>Give your agent this prompt</h3>
    <pre>You are a shopping assistant.
Visit http://localhost:${PORT}/agents
Read the catalog at /api/data,
pick one item under $50, and POST
to /api/order with {"sku":...,
"qty":1,"agent":"&lt;your-name&gt;"}.
Report back the order id.</pre>
  </div>

  <div class="cell b s5">
    <span class="label" style="color:#fff">Endpoints</span>
    <h2 style="color:#fff">For agent clients</h2>
    <pre>GET  /agents       (gated, HTML)
GET  /api/data     (gated, catalog JSON)
POST /api/order    (gated, place an order)
GET  /api/orders   (gated, list orders)</pre>
  </div>

  <div class="cell s7 no-r">
    <span class="label">What happens</span>
    <h3>Each verification &amp; each order</h3>
    <p style="margin-top:8px">Pings the operator's Discord channel. So when a real AI walks the gate or buys something, you see it land in real time.</p>
    <pre>onVerify  →  Discord embed
on order  →  Discord embed</pre>
  </div>

  <div class="cell k s12 no-r">
    <span class="label" style="color:var(--paper)">Try it from the command line</span>
    <pre>$ curl -c c -H 'accept: application/json' http://localhost:${PORT}/api/data | head
  &gt; { "error": "ai_verification_required", "verify_url": "/__stile-verify?token=..." }

$ curl -b c -c c "http://localhost:${PORT}/__stile-verify?token=...&amp;agent=demo-shopper"
  &gt; { "ok": true, "verified": true, ... }

$ curl -b c -X POST http://localhost:${PORT}/api/order \\
       -H 'content-type: application/json' \\
       -d '{"sku":"BOOK-006","qty":1,"agent":"demo-shopper"}'
  &gt; { "ok": true, "order_id": "ord_..." }</pre>
  </div>

</section>

<div class="legend">
  <span>Composition · Agent Market</span>
  <span>${catalog.products.length} products · ${orders.length} orders</span>
  <span>v.0.1 — demo</span>
</div>
<footer>
  <span>AGENT MARKET · powered by STILE</span>
  <span>localhost:${PORT}</span>
  <span>© MMXXVI</span>
</footer>
</body></html>`;
}

// ---------------------------------------------------------------------------
//  Agent-facing pages
// ---------------------------------------------------------------------------
function agentLanding() {
  // This is what the AI sees once verified. Keep it information-dense.
  const lines = catalog.products.map(p =>
    `  ${p.sku.padEnd(10)} ${p.name.padEnd(40)} $${String(p.price).padStart(5)}   stock: ${p.stock}`
  ).join('\n');

  return `<!doctype html>
<html><head><meta charset="utf-8"><title>Agent zone — Agent Market</title>
<style>
body{font-family:ui-monospace,Menlo,monospace;background:#0a0a0a;color:#f4efe2;padding:32px;line-height:1.5}
h1{font-family:'Inter',sans-serif;font-weight:900;letter-spacing:-.03em;font-size:36px;color:#f6c11c;margin:0 0 8px}
h2{font-family:'Inter',sans-serif;font-weight:700;font-size:14px;letter-spacing:.18em;text-transform:uppercase;color:#1949b8;margin:24px 0 8px}
pre{background:transparent;color:#f4efe2;border:none;padding:0;margin:0;white-space:pre-wrap;word-break:normal}
code{background:rgba(255,255,255,.08);padding:1px 5px;color:#f6c11c}
a{color:#f6c11c}
</style></head><body>
<h1>Agent zone.</h1>
<p>You're in. Session cookie set. Below: the live catalog and the action endpoints.</p>

<h2>★ Catalog · ${catalog.products.length} products</h2>
<pre>${lines}</pre>

<h2>★ How to order</h2>
<pre>POST /api/order
Content-Type: application/json
Cookie: stile=...

{ "sku": "BOOK-006", "qty": 1, "agent": "&lt;your-name&gt;", "shipping_to": "anywhere" }

→ 200 { "ok": true, "order_id": "ord_...", "total": ... }</pre>

<h2>★ Other endpoints</h2>
<pre>GET  /api/data     — same catalog as JSON
GET  /api/orders   — list ALL orders this server has accepted</pre>

<p style="margin-top:32px;color:#888;font-size:13px">When you place an order, the operator's Discord channel gets a notification. Be a good guest.</p>
</body></html>`;
}

// ---------------------------------------------------------------------------
//  POST handler helper
// ---------------------------------------------------------------------------
function readBody(req, max = 8192) {
  return new Promise((resolve, reject) => {
    const chunks = []; let total = 0;
    req.on('data', c => { total += c.length; if (total > max) { reject(new Error('body_too_large')); return; } chunks.push(c); });
    req.on('end', () => resolve(Buffer.concat(chunks).toString('utf8')));
    req.on('error', reject);
  });
}
function rid() { return 'ord_' + Math.random().toString(36).slice(2, 10); }

// ---------------------------------------------------------------------------
//  Order placement
// ---------------------------------------------------------------------------
async function placeOrder(req, res) {
  let body = {};
  try { body = JSON.parse(await readBody(req)); }
  catch (e) {
    res.statusCode = 400; res.setHeader('Content-Type', 'application/json');
    res.end(JSON.stringify({ error: 'invalid_json' })); return;
  }
  const sku = String(body.sku || '');
  const qty = Math.max(1, Math.min(99, parseInt(body.qty, 10) || 1));
  const agent = String(body.agent || 'anonymous').slice(0, 64);
  const shipping = String(body.shipping_to || '').slice(0, 200);
  const product = catalog.products.find(p => p.sku === sku);
  if (!product) {
    res.statusCode = 404; res.setHeader('Content-Type', 'application/json');
    res.end(JSON.stringify({ error: 'unknown_sku', sku })); return;
  }
  if (product.stock < qty) {
    res.statusCode = 409; res.setHeader('Content-Type', 'application/json');
    res.end(JSON.stringify({ error: 'insufficient_stock', sku, available: product.stock })); return;
  }
  product.stock -= qty;
  const order = { id: rid(), sku, qty, agent, shipping_to: shipping || null, total: product.price * qty, ts: Date.now() };
  orders.push(order);

  discord(null, [{
    title: '🛒 New order — ' + product.name,
    color: 0xd62828,
    fields: [
      { name: 'order',    value: '`' + order.id + '`',                 inline: true },
      { name: 'agent',    value: '`' + agent + '`',                    inline: true },
      { name: 'qty × $',  value: `${qty} × $${product.price} = **$${order.total}**`, inline: true },
      { name: 'sku',      value: '`' + sku + '`',                       inline: true },
      { name: 'shipping', value: shipping || '(none)',                  inline: true },
      { name: 'stock now',value: String(product.stock),                 inline: true },
    ],
    footer: { text: 'agent-market · ' + new Date().toISOString() },
  }]);

  res.statusCode = 200; res.setHeader('Content-Type', 'application/json');
  res.end(JSON.stringify({ ok: true, order_id: order.id, total: order.total, product: product.name }, null, 2));
}

// ---------------------------------------------------------------------------
//  Top-level handler
// ---------------------------------------------------------------------------
function appHandler(req, res) {
  const url = new URL(req.url, `http://${req.headers.host || 'localhost'}`);
  const p = url.pathname;

  if (p === '/' || p === '/index.html') {
    res.statusCode = 200; res.setHeader('Content-Type', 'text/html; charset=utf-8');
    res.end(humanLanding()); return;
  }
  if (p === '/agents' || p === '/agents/') {
    res.statusCode = 200; res.setHeader('Content-Type', 'text/html; charset=utf-8');
    res.end(agentLanding()); return;
  }
  if (p === '/api/data') {
    res.statusCode = 200; res.setHeader('Content-Type', 'application/json'); res.setHeader('Cache-Control', 'no-store');
    res.end(JSON.stringify(catalog, null, 2)); return;
  }
  if (p === '/api/order' && req.method === 'POST') {
    return placeOrder(req, res);
  }
  if (p === '/api/orders') {
    res.statusCode = 200; res.setHeader('Content-Type', 'application/json'); res.setHeader('Cache-Control', 'no-store');
    res.end(JSON.stringify({ orders, count: orders.length }, null, 2)); return;
  }

  res.statusCode = 404; res.setHeader('Content-Type', 'text/plain'); res.end('not found');
}

// ---------------------------------------------------------------------------
http.createServer(stile.wrap(appHandler)).listen(PORT, () => {
  console.log(`\n  AGENT MARKET — http://localhost:${PORT}`);
  console.log(`  ───────────────`);
  console.log(`  → /                  human landing`);
  console.log(`  → /agents            agent landing (gated)`);
  console.log(`  → /api/data          catalog JSON (gated)`);
  console.log(`  → /api/order  POST   place an order (gated)`);
  console.log(`  → /api/orders        order log (gated)\n`);
  console.log(`  Discord webhook: ${DISCORD_WEBHOOK ? 'configured ✓ (rotate it!)' : 'OFF'}\n`);
});
