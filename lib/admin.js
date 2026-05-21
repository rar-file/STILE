'use strict';

const crypto = require('crypto');
const config = require('./config');

function basicAuth(req, expectedHash) {
  const h = req.headers.authorization || '';
  if (!h.startsWith('Basic ')) return false;
  const decoded = Buffer.from(h.slice(6), 'base64').toString('utf8');
  const i = decoded.indexOf(':');
  if (i < 0) return false;
  const password = decoded.slice(i + 1);
  const got = crypto.createHash('sha256').update(password).digest('hex');
  if (got.length !== expectedHash.length) return false;
  try { return crypto.timingSafeEqual(Buffer.from(got), Buffer.from(expectedHash)); } catch { return false; }
}

function unauthorized(res) {
  res.statusCode = 401;
  res.setHeader('WWW-Authenticate', 'Basic realm="STILE admin"');
  res.setHeader('Content-Type', 'text/plain');
  res.end('Authentication required.');
}

function htmlEscape(s) {
  return String(s).replace(/[&<>"']/g, c => ({ '&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
}

function renderDashboard(summary, store) {
  const series = summary.series || [];
  const totals = summary.totals || {};
  const topAgents = summary.top_agents || [];
  const tiers = summary.tiers || {};
  const adopters = store.adopters.list().slice(0, 20);
  const reps = store.reputation.list({ limit: 20 });

  const seriesJSON = JSON.stringify(series);
  const tiersJSON = JSON.stringify(tiers);

  return `<!doctype html>
<html lang="en"><head><meta charset="utf-8">
<title>STILE · Operator dashboard</title>
<meta name="viewport" content="width=device-width,initial-scale=1">
<link rel="stylesheet" href="/styles.css">
</head><body>
<nav class="nav">
  <a class="brand" href="/">
    <span class="swatch"><span class="r"></span><span class="b"></span><span class="y"></span></span>
    <span class="name">STILE</span>
    <span class="tag">dashboard</span>
  </a>
  <ul class="nav-links">
    <li><a href="/spec">Spec</a></li>
    <li><a href="/playground">Playground</a></li>
    <li><a href="/wall">Wall</a></li>
    <li><a href="/">← Home</a></li>
  </ul>
  <a class="nav-pill" href="/dashboard">Go to Dashboard →</a>
</nav>

<div class="shell">
  <div class="shell-pad">
    <span class="label">Composition №13 — Operator view</span>
    <h1>Operator<br>dashboard.</h1>
    <p style="margin-top:14px;font-size:17px">Last 24h of STILE activity on this instance. In-memory store — process restart wipes the counters.</p>
  </div>

  <div class="admin-stat-row">
    <div class="admin-stat b"><div class="n">${(totals.verified||0).toLocaleString()}</div><div class="l">Verifications</div></div>
    <div class="admin-stat"><div class="n">${(totals.challenge_issued||0).toLocaleString()}</div><div class="l">Challenges issued</div></div>
    <div class="admin-stat r"><div class="n">${(totals.gated_blocked||0).toLocaleString()}</div><div class="l">Gated blocks</div></div>
    <div class="admin-stat y"><div class="n">${(totals.decoy_hit||0).toLocaleString()}</div><div class="l">Decoy hits</div></div>
  </div>

  <div class="admin-grid">
    <div class="admin-card">
      <h3>Verifications · 24h</h3>
      <canvas id="cVerified"></canvas>
    </div>
    <div class="admin-card">
      <h3>Funnel · issued → verified → blocked</h3>
      <canvas id="cFunnel"></canvas>
    </div>
    <div class="admin-card">
      <h3>Top self-declared agents</h3>
      <table><thead><tr><th>Agent</th><th>Count</th><th></th></tr></thead><tbody>
        ${topAgents.map(a => `<tr><td><code>${htmlEscape(a.name)}</code></td><td>${a.count}</td><td><div class="bar" style="width:${Math.min(100, a.count * 4)}%"></div></td></tr>`).join('') || '<tr><td colspan="3">No agent declarations yet.</td></tr>'}
      </tbody></table>
    </div>
    <div class="admin-card">
      <h3>Tier mix</h3>
      <table><thead><tr><th>Tier</th><th>Count</th></tr></thead><tbody>
        ${Object.entries(tiers).map(([k, v]) => `<tr><td><code>${htmlEscape(k)}</code></td><td>${v}</td></tr>`).join('') || '<tr><td colspan="2">No tier data yet.</td></tr>'}
      </tbody></table>
    </div>
    <div class="admin-card">
      <h3>Adopters</h3>
      <table><thead><tr><th>Domain</th><th>Status</th><th>Pings</th></tr></thead><tbody>
        ${adopters.map(a => `<tr><td><code>${htmlEscape(a.domain)}</code></td><td>${htmlEscape(a.status)}</td><td>${a.install_count||0}</td></tr>`).join('') || '<tr><td colspan="3">No adopters yet.</td></tr>'}
      </tbody></table>
    </div>
    <div class="admin-card">
      <h3>Lowest reputation</h3>
      <table><thead><tr><th>Identity</th><th>Score</th><th>Decoy</th><th>Verif.</th></tr></thead><tbody>
        ${reps.map(r => `<tr><td><code>${htmlEscape(r.identity)}</code></td><td>${r.score}</td><td>${r.counters.decoy_hits||0}</td><td>${r.counters.verifications||0}</td></tr>`).join('') || '<tr><td colspan="4">No reputation data yet.</td></tr>'}
      </tbody></table>
    </div>
  </div>
</div>

<div class="legend">
  <span>Composition №13 · Operator dashboard</span>
  <span>Range: last 24h</span>
  <span>STILE / v0.3 — MMXXVI</span>
</div>
<footer class="foot">
  <span>STILE · the captcha for AI agents</span>
  <span><a href="/">Home</a> · <a href="/spec">Spec</a></span>
  <span>© MMXXVI</span>
</footer>

<script>
  const series = ${seriesJSON};
  const totals = ${JSON.stringify(totals)};
  const PALETTE = { red: '#d62828', blue: '#1949b8', yellow: '#f6c11c', black: '#0a0a0a', paper: '#f4efe2' };

  function drawLine(canvas, points, key) {
    const ctx = canvas.getContext('2d');
    const dpr = window.devicePixelRatio || 1;
    const w = canvas.clientWidth, h = canvas.clientHeight;
    canvas.width = w * dpr; canvas.height = h * dpr;
    ctx.scale(dpr, dpr);
    ctx.clearRect(0, 0, w, h);
    // Gridlines
    ctx.strokeStyle = 'rgba(0,0,0,.12)'; ctx.lineWidth = 1;
    for (let i = 1; i < 4; i++) {
      const y = (h / 4) * i;
      ctx.beginPath(); ctx.moveTo(8, y); ctx.lineTo(w - 8, y); ctx.stroke();
    }
    if (!points.length) return;
    const max = Math.max(1, ...points.map(p => p[key]));
    // Bars (Mondrian-like)
    const barW = (w - 24) / points.length;
    points.forEach((p, i) => {
      const x = 12 + i * barW;
      const barH = (p[key] / max) * (h - 24);
      ctx.fillStyle = PALETTE.blue;
      ctx.fillRect(x + 2, h - 12 - barH, Math.max(2, barW - 6), barH);
      ctx.strokeStyle = PALETTE.black; ctx.lineWidth = 2;
      ctx.strokeRect(x + 2, h - 12 - barH, Math.max(2, barW - 6), barH);
    });
  }

  function drawFunnel(canvas) {
    const ctx = canvas.getContext('2d');
    const dpr = window.devicePixelRatio || 1;
    const w = canvas.clientWidth, h = canvas.clientHeight;
    canvas.width = w * dpr; canvas.height = h * dpr;
    ctx.scale(dpr, dpr);
    ctx.clearRect(0, 0, w, h);
    const data = [
      { label: 'Issued',   value: totals.challenge_issued || 0, color: PALETTE.yellow, fg: PALETTE.black },
      { label: 'Verified', value: totals.verified || 0,         color: PALETTE.blue,   fg: '#fff' },
      { label: 'Blocked',  value: totals.gated_blocked || 0,    color: PALETTE.red,    fg: '#fff' },
    ];
    const max = Math.max(1, ...data.map(d => d.value));
    const barW = (w - 24) / data.length;
    data.forEach((d, i) => {
      const x = 12 + i * barW;
      const barH = (d.value / max) * (h - 60);
      ctx.fillStyle = d.color;
      ctx.fillRect(x + 4, h - 30 - barH, barW - 12, barH);
      ctx.strokeStyle = PALETTE.black; ctx.lineWidth = 2;
      ctx.strokeRect(x + 4, h - 30 - barH, barW - 12, barH);
      ctx.fillStyle = PALETTE.black;
      ctx.font = '700 11px Inter, sans-serif';
      ctx.fillText(d.label.toUpperCase(), x + 4, h - 12);
      ctx.fillStyle = d.fg;
      ctx.font = '900 14px Inter, sans-serif';
      if (barH > 22) ctx.fillText(String(d.value), x + 8, h - 32 - barH + 16);
      else { ctx.fillStyle = PALETTE.black; ctx.fillText(String(d.value), x + 8, h - 36 - barH); }
    });
  }

  function paint() {
    drawLine(document.getElementById('cVerified'), series, 'verified');
    drawFunnel(document.getElementById('cFunnel'));
  }
  paint();
  window.addEventListener('resize', paint);
</script>
</body></html>`;
}

function createAdmin({ password, stile, loopbackOnly = false, enabled = true } = {}) {
  if (enabled && !password) {
    console.warn('[stile] admin enabled with no password — refusing to render.');
  }
  const passwordHash = (enabled && password) ? crypto.createHash('sha256').update(password).digest('hex') : null;

  function handle(req, res) {
    if (!enabled || !passwordHash) {
      res.statusCode = 503;
      res.setHeader('Content-Type', 'application/json');
      res.end(JSON.stringify({
        error: 'admin_disabled',
        message: 'Admin dashboard is disabled. Set STILE_ADMIN_PASSWORD (≥12 chars, not on the known-weak list).',
      }));
      return true;
    }
    if (loopbackOnly && !config.isLoopbackPeer(req)) {
      res.statusCode = 403;
      res.setHeader('Content-Type', 'application/json');
      res.end(JSON.stringify({
        error: 'admin_loopback_only',
        message: 'Admin dashboard is running with a demo password and only accepts connections from 127.0.0.1. Set STILE_ADMIN_PASSWORD to a real value to enable remote access.',
      }));
      return true;
    }
    if (!basicAuth(req, passwordHash)) { unauthorized(res); return true; }

    const url = new URL(req.url, `http://${req.headers.host || 'localhost'}`);
    const range = url.searchParams.get('range') || '24h';
    const rangeMs = range === '7d' ? 7 * 86400e3 : range === '30d' ? 30 * 86400e3 : 86400e3;
    const summary = stile.store.events.summary(rangeMs);

    res.statusCode = 200;
    res.setHeader('Content-Type', 'text/html; charset=utf-8');
    res.end(renderDashboard(summary, stile.store));
    return true;
  }

  return { handle, enabled: enabled && !!passwordHash, loopbackOnly };
}

module.exports = createAdmin;
module.exports.createAdmin = createAdmin;
