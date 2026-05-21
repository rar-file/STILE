// =============================================================
//  STILE landing scripts
// =============================================================

function escapeHtml(s) {
  return String(s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
}

function shortToken(url) {
  if (!url) return '';
  return String(url).replace(/(token=)([^&\s]{6,})/, (_, k, t) => k + t.slice(0, 8) + '…');
}

// ---- Copy-to-clipboard
document.addEventListener('click', (e) => {
  const btn = e.target.closest('.copy-btn');
  if (!btn) return;
  const id = btn.dataset.copy;
  const src = document.getElementById(id);
  if (!src) return;
  navigator.clipboard.writeText(src.value).then(() => {
    btn.classList.add('copied');
    const old = btn.textContent;
    btn.textContent = 'Copied';
    setTimeout(() => { btn.classList.remove('copied'); btn.textContent = old; }, 1400);
  });
});

// ---- Reveal AI-visible block — render as 5 channel cards
const peekBtn = document.getElementById('peek-btn');
const peekOut = document.getElementById('peek-out');
if (peekBtn) {
  peekBtn.addEventListener('click', async () => {
    peekOut.classList.remove('hidden');
    peekOut.innerHTML = '<div class="result-empty" style="border:2px solid var(--black);padding:20px">Loading…</div>';
    try {
      const r = await fetch('/api/peek', { headers: { 'accept': 'application/json' } });
      const j = await r.json();
      renderChannels(peekOut, j);
    } catch (err) {
      peekOut.innerHTML = `<div class="result-empty" style="border:2px solid var(--black);padding:20px">Error: ${escapeHtml(err.message)}</div>`;
    }
  });
}

function renderChannels(host, j) {
  const ch = j.channels || {};
  const html = `
    <div class="channel-grid">
      <div class="channel">
        <div class="channel-head"><span><span class="channel-num">1</span><span class="channel-name">HTML comment</span></span><span class="channel-tag">marker</span></div>
        <pre>${escapeHtml(shortToken(ch.comment || ''))}</pre>
      </div>
      <div class="channel b">
        <div class="channel-head"><span><span class="channel-num">2</span><span class="channel-name">JSON-LD</span></span><span class="channel-tag">schema.org</span></div>
        <pre>${escapeHtml(JSON.stringify(maskTokens(ch.jsonld) || {}, null, 2))}</pre>
      </div>
      <div class="channel y">
        <div class="channel-head"><span><span class="channel-num">3</span><span class="channel-name">aria-hidden text</span></span><span class="channel-tag">canonical</span></div>
        <pre>${escapeHtml(shortToken(ch.aria_hidden_text || '').slice(0, 280))}${(ch.aria_hidden_text || '').length > 280 ? '…' : ''}</pre>
      </div>
      <div class="channel">
        <div class="channel-head"><span><span class="channel-num">4</span><span class="channel-name">SVG title</span></span><span class="channel-tag">stego</span></div>
        <pre>${escapeHtml(shortToken(ch.svg_title || ''))}</pre>
      </div>
      <div class="channel k full">
        <div class="channel-head"><span><span class="channel-num" style="border-color:#fff">5</span><span class="channel-name">meta + CSS variable</span></span><span class="channel-tag">${Object.keys(ch.meta_tags || {}).length} tags</span></div>
        <pre>${escapeHtml(formatMetaTags(ch.meta_tags))}</pre>
      </div>
      <div class="channel r full">
        <div class="channel-head"><span><span class="channel-num" style="border-color:#fff">★</span><span class="channel-name">honeypot decoy — DO NOT FOLLOW</span></span><span class="channel-tag">trap</span></div>
        <pre>${escapeHtml(shortToken(ch.honeypot_decoy_url || ''))}</pre>
      </div>
    </div>
    <div style="display:flex;justify-content:space-between;align-items:center;margin-top:8px;font-size:10px;letter-spacing:.14em;text-transform:uppercase;font-weight:700;opacity:.7">
      <span>tier: ${j.tier} · word: ${j.challenge_word}</span>
      <span>expires ${new Date(j.expires_at * 1000).toLocaleTimeString()}</span>
    </div>`;
  host.innerHTML = html;
}

function maskTokens(obj) {
  if (!obj) return obj;
  const cloned = JSON.parse(JSON.stringify(obj));
  for (const k of Object.keys(cloned)) {
    if (typeof cloned[k] === 'string') cloned[k] = shortToken(cloned[k]);
  }
  return cloned;
}

function formatMetaTags(tags) {
  if (!tags) return '';
  return Object.entries(tags).map(([k, v]) => `<meta name="${k}" content="${shortToken(v)}">`).join('\n');
}

// ---- Walk through the gate — render compact log instead of raw dump
const walkBtn = document.getElementById('walk-btn');
const walkOut = document.getElementById('walk-out');
if (walkBtn) {
  walkBtn.addEventListener('click', async () => {
    walkOut.classList.remove('hidden');
    walkOut.innerHTML = '';
    walkOut.className = 'channel-grid'; // Mondrian sub-grid for the steps
    walkOut.style.gridTemplateColumns = '1fr';
    const step = (n, color, label, lines) => {
      const cell = document.createElement('div');
      cell.className = 'channel ' + color + ' full';
      cell.style.borderRight = 'none';
      cell.innerHTML = `
        <div class="channel-head"><span><span class="channel-num"${color === 'k' || color === 'b' || color === 'r' ? ' style="border-color:#fff"' : ''}>${n}</span><span class="channel-name">${label}</span></span></div>
        <pre>${lines.map(escapeHtml).join('\n')}</pre>`;
      walkOut.appendChild(cell);
    };
    try {
      const r1 = await fetch('/api/data', { headers: { 'accept': 'application/json' }, credentials: 'omit' });
      const j1 = await r1.json();
      step(1, '', `${r1.status} · GET /api/data (no cookie)`, [
        `→ Accept: application/json`,
        `← ${j1.error || 'ok'}`,
        `← verify_url: ${shortToken(j1.verify_url || '')}`,
        `← word: ${j1.challenge_word}`,
      ]);

      const r2 = await fetch(j1.verify_url, { headers: { 'accept': 'application/json' }, credentials: 'include' });
      const j2 = await r2.json();
      step(2, 'b', `${r2.status} · GET ${shortToken(j1.verify_url)}`, [
        `→ Set-Cookie: stile`,
        `← ${j2.message || j2.error}`,
        `← tier: ${j2.tier} · session_ttl: ${j2.session_ttl}s`,
      ]);

      const r3 = await fetch('/api/data', { headers: { 'accept': 'application/json' }, credentials: 'include' });
      const j3 = await r3.json();
      step(3, 'y', `${r3.status} · GET /api/data (with cookie)`, [
        `← ${j3.message}`,
        `← catalog: ${(j3.catalog || []).length} items`,
      ]);
    } catch (err) {
      step('!', 'r', 'error', [String(err.message || err)]);
    }
  });
}

// ---- Live counter (SSE) + adjacent counters (polling)
(function () {
  const todayEl    = document.querySelector('[data-counter="today"]');
  const allTimeEl  = document.querySelector('[data-counter="all-time"]');
  const decoyEl    = document.querySelector('[data-counter-decoy="today"]');
  const adoptersEl = document.querySelector('[data-counter-adopters]');
  const agentsEl   = document.querySelector('[data-counter-agents]');
  if (!todayEl && !allTimeEl && !decoyEl && !adoptersEl && !agentsEl) return;

  const state = { today: 0, allTime: 0, dToday: 0, dAll: 0, raf: null };
  function tween() {
    let changed = false;
    if (Math.abs(state.dToday - state.today) > 0.5) { state.dToday += (state.today - state.dToday) * 0.18; changed = true; } else state.dToday = state.today;
    if (Math.abs(state.dAll - state.allTime)  > 0.5) { state.dAll   += (state.allTime - state.dAll) * 0.18; changed = true; } else state.dAll   = state.allTime;
    if (todayEl)   todayEl.textContent   = Math.round(state.dToday).toLocaleString();
    if (allTimeEl) allTimeEl.textContent = Math.round(state.dAll).toLocaleString();
    state.raf = changed ? requestAnimationFrame(tween) : null;
  }
  function update(j) {
    state.today = j.today; state.allTime = j.all_time;
    if (!state.raf) state.raf = requestAnimationFrame(tween);
  }
  fetch('/api/stats/counter').then(r => r.json()).then(update).catch(() => {});
  try {
    const es = new EventSource('/api/stats/counter/stream');
    es.onmessage = (ev) => { try { update(JSON.parse(ev.data)); } catch {} };
  } catch {
    setInterval(() => { fetch('/api/stats/counter').then(r => r.json()).then(update).catch(() => {}); }, 5000);
  }
  async function pollAdjacent() {
    try { if (decoyEl) { const s = await fetch('/api/stats/summary').then(r => r.json()); decoyEl.textContent = (s.totals && s.totals.decoy_hit || 0).toLocaleString(); } } catch {}
    try { if (adoptersEl) { const a = await fetch('/api/adopters').then(r => r.json()); adoptersEl.textContent = (a.adopters || []).length.toLocaleString(); } } catch {}
    try { if (agentsEl) { const w = await fetch('/api/wall').then(r => r.json()); agentsEl.textContent = (w.agents || []).length.toLocaleString(); } } catch {}
  }
  pollAdjacent();
  setInterval(pollAdjacent, 8000);
})();

// ---- Wall mini fetcher
(function () {
  const mini = document.getElementById('wall-mini');
  if (!mini) return;
  async function load() {
    try {
      const r = await fetch('/api/wall');
      const j = await r.json();
      if (!j.agents || j.agents.length === 0) return;
      mini.innerHTML = '';
      const top = j.agents.slice(0, 8);
      for (const a of top) {
        const cell = document.createElement('div');
        cell.className = 'wm-cell';
        cell.innerHTML = `<div class="wn">${escapeHtml(a.name)}</div>
                          <div class="wc">${a.verification_count.toLocaleString()} verifications</div>`;
        mini.appendChild(cell);
      }
    } catch {}
  }
  load();
  setInterval(load, 8000);
})();

// ---- Hero "live agent" stack
(function () {
  const stack = document.getElementById('hero-agent');
  const progress = document.getElementById('hero-progress');
  if (!stack) return;
  const sequences = [
    [
      ['<b>GET</b> /agents <code>(Accept: text/html)</code>', 20],
      ['<b>read</b> aria-hidden block · found verify URL', 50],
      ['<b>GET</b> /__stile-verify?token=<code>c2.…</code>', 78],
      ['<b>200</b> · Set-Cookie stile · ttl 1h', 100],
    ],
    [
      ['<b>GET</b> /api/data <code>(Accept: application/json)</code>', 18],
      ['<b>401</b> · ai_verification_required', 40],
      ['<b>parse</b> JSON-LD StileChallenge', 65],
      ['<b>POST</b> /__stile-verify <code>{token, agent}</code>', 100],
    ],
    [
      ['<b>HEAD</b> /agents <code>(Signature-Input: ed25519)</code>', 30],
      ['<b>verify</b> Web Bot Auth signature OK', 70],
      ['<b>fast-path</b> · Set-Cookie · skip challenge', 100],
    ],
  ];
  let seqIdx = 0;
  function play() {
    const seq = sequences[seqIdx % sequences.length]; seqIdx++;
    const msgEls = stack.querySelectorAll('.agent-msg');
    let i = 0;
    function step() {
      if (i >= seq.length || i >= msgEls.length) return;
      msgEls[i].innerHTML = seq[i][0];
      if (progress) progress.style.width = seq[i][1] + '%';
      i++;
      setTimeout(step, 900);
    }
    step();
  }
  play();
  setInterval(play, 9000);
})();

// =============================================================
//  Playground rendering — receipt / stream / result cards
//  Used by both #pg-* (embedded) and #pl-* (full page)
// =============================================================

function setupPlayground(prefix) {
  const runBtn = document.getElementById(prefix + '-run');
  if (!runBtn) return;
  const provider = document.getElementById(prefix + '-provider');
  const model = document.getElementById(prefix + '-model');
  const key = document.getElementById(prefix + '-key');
  const promptEl = document.getElementById(prefix + '-prompt');
  const replyEl = document.getElementById(prefix + '-reply');
  const resultEl = document.getElementById(prefix + '-result');
  if (!promptEl || !replyEl || !resultEl) return;

  try { key.value = sessionStorage.getItem('stile-pg-key') || ''; } catch {}
  key.addEventListener('change', () => { try { sessionStorage.setItem('stile-pg-key', key.value); } catch {} });

  function renderReceipt(meta) {
    promptEl.className = 'receipt';
    promptEl.style.minHeight = promptEl.style.minHeight || '220px';
    const lengthStr = (meta.prompt || '').length.toLocaleString() + ' chars';
    const channels = ['comment', 'JSON-LD', 'aria-hidden', 'SVG title', 'meta + CSS'];
    promptEl.innerHTML = `
      <div class="receipt-head">
        <span>request · ${escapeHtml(meta.provider)}</span>
        <span>${lengthStr}</span>
      </div>
      <div class="receipt-rows">
        <div class="receipt-row"><span class="k">model</span><span class="v">${escapeHtml(meta.model || '(default)')}</span></div>
        <div class="receipt-row"><span class="k">prompt</span><span class="v">"Read this HTML and return the verify URL"</span></div>
        <div class="receipt-row"><span class="k">channels</span><span class="v">${channels.length} (${channels.join(', ')})</span></div>
        <div class="receipt-row"><span class="k">tier</span><span class="v">${escapeHtml(meta.tier || 'easy')}</span></div>
        <div class="receipt-row"><span class="k">word</span><span class="v">${escapeHtml(meta.word || '')}</span></div>
        <div class="receipt-row"><span class="k">token</span><span class="v">${escapeHtml(meta.tokenShort || '')}</span></div>
      </div>
      <div class="receipt-foot">
        <span>${meta.streaming ? 'streaming…' : 'sent ✓'}</span>
        <button data-toggle-full>Show full prompt</button>
      </div>`;
    promptEl.querySelector('[data-toggle-full]').addEventListener('click', (e) => {
      const btn = e.currentTarget;
      const next = promptEl.querySelector('.full-prompt');
      if (next) { next.remove(); btn.textContent = 'Show full prompt'; return; }
      const div = document.createElement('div');
      div.className = 'full-prompt';
      div.style.cssText = 'border-top:2px solid var(--black);padding:10px 12px;font-family:var(--mono);font-size:10.5px;line-height:1.5;max-height:160px;overflow:auto;white-space:pre-wrap;word-break:break-all;background:var(--paper-2)';
      div.textContent = meta.prompt || '';
      promptEl.querySelector('.receipt-foot').before(div);
      btn.textContent = 'Hide full prompt';
    });
  }

  function startStream() {
    replyEl.className = 'stream';
    replyEl.innerHTML = `
      <div class="stream-head">
        <span>tokens streaming</span>
        <span data-token-count>0</span>
      </div>
      <div class="stream-body" data-stream-body></div>
      <div class="stream-foot">
        <span data-stream-status>open</span>
        <span data-stream-bytes>0 b</span>
      </div>`;
  }
  function appendToken(text) {
    const body = replyEl.querySelector('[data-stream-body]'); if (!body) return;
    const span = document.createElement('span');
    span.className = 'stream-token';
    span.textContent = text;
    body.appendChild(span);
    body.scrollTop = body.scrollHeight;
    const cnt = replyEl.querySelector('[data-token-count]');
    if (cnt) cnt.textContent = (parseInt(cnt.textContent || '0') + 1).toString();
    const bytes = replyEl.querySelector('[data-stream-bytes]');
    if (bytes) bytes.textContent = (body.textContent.length).toLocaleString() + ' b';
  }
  function streamExtracted(url) {
    const body = replyEl.querySelector('[data-stream-body]'); if (!body) return;
    const div = document.createElement('div');
    div.className = 'stream-extracted';
    div.textContent = shortToken(url);
    body.appendChild(div);
    const status = replyEl.querySelector('[data-stream-status]');
    if (status) status.textContent = 'extracted ✓';
  }

  function renderResult(j) {
    resultEl.className = 'result';
    if (j.error) {
      resultEl.innerHTML = `
        <div class="result-head fail"><span>verification failed</span><span>${escapeHtml(j.error)}</span></div>
        <div class="result-body">
          <div class="result-row"><span class="k">error</span><span class="v r">${escapeHtml(j.error)}</span></div>
          ${j.message ? `<div class="result-row"><span class="k">message</span><span class="v">${escapeHtml(j.message)}</span></div>` : ''}
        </div>`;
      return;
    }
    resultEl.innerHTML = `
      <div class="result-head ok"><span>verified ✓</span><span>200</span></div>
      <div class="result-body">
        <div class="result-row"><span class="k">protocol</span><span class="v">${escapeHtml(j.protocol || '')}</span></div>
        <div class="result-row"><span class="k">tier</span><span class="v b">${escapeHtml(j.tier || '')}</span></div>
        <div class="result-row"><span class="k">agent</span><span class="v">${escapeHtml(j.agent_echo || '(none declared)')}</span></div>
        <div class="result-row"><span class="k">word echo</span><span class="v">${escapeHtml(j.challenge_word_echo || '')}</span></div>
        <div class="result-row"><span class="k">session ttl</span><span class="v">${(j.session_ttl || 0).toLocaleString()}s</span></div>
        <div class="result-row"><span class="k">message</span><span class="v" style="font-family:var(--sans);font-size:11.5px">${escapeHtml(j.message || '')}</span></div>
      </div>`;
  }

  runBtn.addEventListener('click', async () => {
    promptEl.innerHTML = '<div class="result-empty">sending…</div>';
    replyEl.innerHTML = '<div class="result-empty">awaiting reply…</div>';
    resultEl.innerHTML = '<div class="result-empty">awaiting verification…</div>';
    let meta = { provider: provider.value, model: model.value, prompt: '', streaming: true };
    try {
      const res = await fetch('/api/playground/run', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ provider: provider.value, apiKey: key.value, model: model.value }),
      });
      const reader = res.body.getReader();
      const dec = new TextDecoder();
      let buf = '';
      let streamStarted = false;
      while (true) {
        const { value, done } = await reader.read();
        if (done) break;
        buf += dec.decode(value, { stream: true });
        let idx;
        while ((idx = buf.indexOf('\n\n')) >= 0) {
          const ev = parseSse(buf.slice(0, idx)); buf = buf.slice(idx + 2);
          if (!ev.data) continue;
          if (ev.event === 'challenge') {
            meta.tokenShort = shortToken(ev.data.verify_url);
            meta.word = ev.data.word;
            meta.tier = ev.data.tier;
          } else if (ev.event === 'prompt') {
            meta.prompt = ev.data.prompt || '';
            renderReceipt(meta);
          } else if (ev.event === 'token') {
            if (!streamStarted) { startStream(); streamStarted = true; }
            appendToken(ev.data.text || '');
          } else if (ev.event === 'extracted') {
            if (!streamStarted) { startStream(); streamStarted = true; }
            streamExtracted(ev.data.verify_url);
          } else if (ev.event === 'verify-response') {
            renderResult(ev.data);
          } else if (ev.event === 'error') {
            renderResult({ error: 'provider_error', message: ev.data.message });
          }
        }
      }
    } catch (err) {
      renderResult({ error: 'network_error', message: err.message || String(err) });
    }
  });
}

function parseSse(block) {
  const lines = block.split('\n');
  let event = 'message', data = '';
  for (const l of lines) {
    if (l.startsWith('event:')) event = l.slice(6).trim();
    else if (l.startsWith('data:')) data += l.slice(5).trim();
  }
  let p = null; try { p = JSON.parse(data); } catch {}
  return { event, data: p };
}

setupPlayground('pg');  // embedded on landing
setupPlayground('pl');  // full page

// Export for the full /playground page if it loads its own scripts
window.STILE = { setupPlayground };
