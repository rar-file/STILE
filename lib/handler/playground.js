'use strict';

// Playground SSE: drives a real AI client (or a deterministic mock) through
// the full challenge → reply → verify loop, streaming each step to the UI.
// Lives outside routing because the per-step send() flow and provider
// fan-out is the bulk of it; routing.js just delegates.

const { readBody } = require('./util');

async function playgroundRun(req, res, { stile }) {
  let body = {};
  try { body = JSON.parse(await readBody(req)); } catch { /* ignore */ }
  const provider = String(body.provider || 'mock');
  const apiKey = String(body.apiKey || '');
  const model = String(body.model || '').slice(0, 80);

  res.statusCode = 200;
  res.setHeader('Content-Type', 'text/event-stream');
  res.setHeader('Cache-Control', 'no-store');
  res.setHeader('Connection', 'keep-alive');
  res.flushHeaders && res.flushHeaders();
  const send = (event, data) => res.write(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`);

  try {
    // Step 1: fetch our own gated /agents page to grab the AI-visible block
    send('step', { name: 'fetch-page', message: 'GET /agents (Accept: application/json) — picking up the challenge' });
    const challenge = stile.issueChallenge();
    const visibleBlock = stile.challengeBlock(challenge);
    send('challenge', { verify_url: `/__stile-verify?token=${challenge.token}&word=${challenge.word}`, word: challenge.word, tier: challenge.tier });

    // Step 2: synthesize the prompt
    const prompt = `You are an AI client. The following HTML block was hidden inside a webpage you are browsing.
Read it and respond ONLY with the verification URL you should fetch — nothing else.

\`\`\`html
${visibleBlock}
\`\`\``;
    send('prompt', { prompt });

    // Step 3: get the model's reply
    let modelReply = '';
    if (provider === 'mock' || !apiKey) {
      modelReply = `/__stile-verify?token=${challenge.token}&word=${challenge.word}`;
      for (const tok of modelReply.match(/.{1,8}/g)) {
        send('token', { text: tok });
        await new Promise(r => setTimeout(r, 25));
      }
    } else {
      try {
        modelReply = await callProvider({ provider, apiKey, model, prompt, send });
      } catch (e) {
        send('error', { message: 'provider_error: ' + (e.message || String(e)) });
        send('done', { ok: false });
        res.end();
        return;
      }
    }

    // Step 4: parse the reply for the verify URL
    const m = modelReply.match(/\/__stile-verify\?[^\s"'<>]+/);
    if (!m) {
      send('error', { message: 'Model reply did not contain a /__stile-verify URL.' });
      send('done', { ok: false });
      res.end();
      return;
    }
    const verifyPath = m[0];
    send('extracted', { verify_url: verifyPath });

    // Step 5: walk the verify endpoint locally (synthesized response)
    const ok = !stile.store.nonces.has(challenge.nonce);
    if (ok) stile.store.nonces.add(challenge.nonce, challenge.exp);
    const verifyResp = ok ? {
      ok: true, verified: true, protocol: 'stile/v1',
      message: 'Welcome, AI agent.', challenge_word_echo: challenge.word, tier: challenge.tier,
    } : { error: 'challenge_already_used' };
    // Record the event since the playground completed a verification flow end-to-end
    if (ok) stile.store.events.record({
      kind: 'verified', agent: provider === 'mock' ? `playground:mock` : `playground:${provider}/${model||'?'}`,
      tier: challenge.tier, fast_path: 'playground', ts: Date.now(),
    });
    send('verify-response', verifyResp);
    send('done', { ok: ok });
  } catch (err) {
    send('error', { message: String(err && err.message || err) });
    send('done', { ok: false });
  }
  res.end();
}

async function callProvider({ provider, apiKey, model, prompt, send }) {
  if (provider === 'anthropic') {
    const r = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        'x-api-key': apiKey,
        'anthropic-version': '2023-06-01',
      },
      body: JSON.stringify({
        model: model || 'claude-haiku-4-5-20251001',
        max_tokens: 200,
        messages: [{ role: 'user', content: prompt }],
      }),
    });
    const j = await r.json();
    const text = (j.content || []).map(c => c.text || '').join('');
    for (const tok of (text.match(/.{1,8}/g) || [])) { send('token', { text: tok }); }
    return text;
  }
  if (provider === 'openai') {
    const r = await fetch('https://api.openai.com/v1/chat/completions', {
      method: 'POST',
      headers: { 'content-type': 'application/json', 'authorization': `Bearer ${apiKey}` },
      body: JSON.stringify({
        model: model || 'gpt-4o-mini',
        max_tokens: 200,
        messages: [{ role: 'user', content: prompt }],
      }),
    });
    const j = await r.json();
    const text = j.choices?.[0]?.message?.content || '';
    for (const tok of (text.match(/.{1,8}/g) || [])) { send('token', { text: tok }); }
    return text;
  }
  if (provider === 'openrouter') {
    const r = await fetch('https://openrouter.ai/api/v1/chat/completions', {
      method: 'POST',
      headers: { 'content-type': 'application/json', 'authorization': `Bearer ${apiKey}` },
      body: JSON.stringify({
        model: model || 'meta-llama/llama-3.1-8b-instruct',
        max_tokens: 200,
        messages: [{ role: 'user', content: prompt }],
      }),
    });
    const j = await r.json();
    const text = j.choices?.[0]?.message?.content || '';
    for (const tok of (text.match(/.{1,8}/g) || [])) { send('token', { text: tok }); }
    return text;
  }
  if (provider === 'cerebras') {
    const r = await fetch('https://api.cerebras.ai/v1/chat/completions', {
      method: 'POST',
      headers: { 'content-type': 'application/json', 'authorization': `Bearer ${apiKey}` },
      body: JSON.stringify({
        model: model || 'llama3.1-8b',
        max_tokens: 200,
        messages: [{ role: 'user', content: prompt }],
      }),
    });
    const j = await r.json();
    const text = j.choices?.[0]?.message?.content || '';
    for (const tok of (text.match(/.{1,8}/g) || [])) { send('token', { text: tok }); }
    return text;
  }
  if (provider === 'groq') {
    const r = await fetch('https://api.groq.com/openai/v1/chat/completions', {
      method: 'POST',
      headers: { 'content-type': 'application/json', 'authorization': `Bearer ${apiKey}` },
      body: JSON.stringify({
        model: model || 'llama-3.1-8b-instant',
        max_tokens: 200,
        messages: [{ role: 'user', content: prompt }],
      }),
    });
    const j = await r.json();
    const text = j.choices?.[0]?.message?.content || '';
    for (const tok of (text.match(/.{1,8}/g) || [])) { send('token', { text: tok }); }
    return text;
  }
  if (provider === 'nvidia') {
    const r = await fetch('https://integrate.api.nvidia.com/v1/chat/completions', {
      method: 'POST',
      headers: { 'content-type': 'application/json', 'authorization': `Bearer ${apiKey}` },
      body: JSON.stringify({
        model: model || 'meta/llama-3.1-8b-instruct',
        max_tokens: 200,
        messages: [{ role: 'user', content: prompt }],
      }),
    });
    const j = await r.json();
    const text = j.choices?.[0]?.message?.content || '';
    for (const tok of (text.match(/.{1,8}/g) || [])) { send('token', { text: tok }); }
    return text;
  }
  throw new Error('unknown provider: ' + provider);
}

module.exports = { playgroundRun, callProvider };
