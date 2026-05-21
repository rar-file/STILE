'use strict';

// Walk the AGENT MARKET strong-tier gate as Claude would, the hard way:
// fetch the HTML page (not the convenience JSON 401), parse the hidden
// challenge block out of the raw text, then POST a verification with
// {token, word, agent}. No URL-query shortcut, no JSON-LD shortcut.

const BASE = 'http://localhost:3001';
const ME   = 'claude-opus-4-7';

function log(label, body) {
  console.log('\n──────── ' + label + ' ────────');
  if (body) console.log(typeof body === 'string' ? body : JSON.stringify(body, null, 2));
}

function shorten(s) {
  return s.length > 100 ? s.slice(0, 60) + '…' + s.slice(-30) : s;
}

(async () => {
  // ---- 1. Fetch the gated page as HTML (no cookie, no JSON Accept) ----
  const r1 = await fetch(BASE + '/agents', { headers: { 'accept': 'text/html', 'user-agent': ME }, redirect: 'manual' });
  const html = await r1.text();
  log('1 · GET /agents (HTML, no cookie)', `status: ${r1.status}\nbody length: ${html.length} chars`);

  // ---- 2. Strip out the hidden aria-hidden challenge block ----
  const ariaMatch = html.match(/<div data-stile aria-hidden="true"[^>]*>([\s\S]*?)<\/div>/);
  if (!ariaMatch) { console.error('no challenge block found'); process.exit(1); }
  const ariaProse = ariaMatch[1].replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim();
  log('2 · hidden challenge block (aria-hidden text)', shorten(ariaProse));

  // ---- 3. Read the natural-language instructions to extract token + word ----
  // (This is what an LLM would do — comprehend the prose and pull the values out.)
  const verifyMatch = ariaProse.match(/\/__stile-verify\?[^\s)]+/);
  const wordMatch   = ariaProse.match(/(?:challenge\s+word\s+is|Challenge\s+word:|matching\s+challenge\s+word\s+is)\s*"?([a-z]+-[a-z]+)"?/i);
  if (!verifyMatch || !wordMatch) { console.error('failed to comprehend prose'); console.log(ariaProse); process.exit(1); }
  const verifyUrl = verifyMatch[0].replace(/&amp;/g, '&');
  const word = wordMatch[1];
  const token = new URL(BASE + verifyUrl).searchParams.get('token');
  log('3 · comprehension result', { verify_url: shorten(verifyUrl), word, token: shorten(token) });

  // ---- 4. Walk the strong-tier verify (POST, with token + word + agent) ----
  // Strong tier rejects easy/medium attempts that omit the word or agent.
  const verifyRes = await fetch(BASE + '/__stile-verify', {
    method: 'POST',
    headers: { 'content-type': 'application/json', 'accept': 'application/json', 'user-agent': ME },
    body: JSON.stringify({ token, word, agent: ME }),
  });
  const verifyJson = await verifyRes.json();
  const setCookie = verifyRes.headers.get('set-cookie') || '';
  log('4 · POST /__stile-verify  {token, word, agent}', { status: verifyRes.status, ...verifyJson, set_cookie: shorten(setCookie) });
  const cookie = (setCookie.match(/(stile=[^;]+)/) || [])[1];
  if (!cookie) { console.error('no cookie set — verify failed'); process.exit(1); }

  // ---- 5. Try the convenience routes only AFTER unlocking ----
  const catalogRes = await fetch(BASE + '/api/data', { headers: { 'cookie': cookie, 'accept': 'application/json', 'user-agent': ME } });
  const catalog = await catalogRes.json();
  log('5 · GET /api/data  (with cookie)', { status: catalogRes.status, products_count: catalog.products?.length, schema: catalog.schema });

  // ---- 6. Pick a thematic item, place an order ----
  const pick = catalog.products.find(p => p.sku === 'RUG-008') || catalog.products[0];
  const orderRes = await fetch(BASE + '/api/order', {
    method: 'POST',
    headers: { 'content-type': 'application/json', 'cookie': cookie, 'accept': 'application/json', 'user-agent': ME },
    body: JSON.stringify({
      sku: pick.sku, qty: 1, agent: ME,
      shipping_to: 'Anthropic, 548 Market St #59287, San Francisco CA 94104, USA',
    }),
  });
  const orderJson = await orderRes.json();
  log('6 · POST /api/order  ' + pick.sku, { status: orderRes.status, ...orderJson });

  // ---- Bonus: try to verify AGAIN with the same token — should 409 ----
  const replayRes = await fetch(BASE + '/__stile-verify', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ token, word, agent: ME }),
  });
  log('★ replay protection: re-POSTing the same token', { status: replayRes.status, ...(await replayRes.json()) });

  console.log('\nstrong-tier walk complete · agent: ' + ME);
})().catch(e => { console.error(e); process.exit(1); });
