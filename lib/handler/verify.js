'use strict';

// Verification-facing endpoints: the gated /agents page, the demo data behind
// the gate, the AI-perspective /api/peek inspector, and the JSON Schema for
// the challenge envelope. The actual /__stile-verify HTTP endpoint lives in
// the wrapping stile middleware (see lib/stile.js); these handlers expose
// the surrounding surface that helps clients reason about it.

const path = require('path');
const { serveStatic } = require('./util');

function agentsPage(req, res, { templatesDir }) {
  return serveStatic(req, res, path.join(templatesDir, 'agents.html'));
}

function apiData(req, res) {
  res.statusCode = 200;
  res.setHeader('Content-Type', 'application/json');
  res.setHeader('Cache-Control', 'no-store');
  res.end(JSON.stringify({
    ok: true,
    message: 'Hello, verified AI agent.',
    catalog: [
      { id: 'sku-1001', name: 'Quantum widget',     price: 42, stock: 117  },
      { id: 'sku-1002', name: 'Recursive sprocket', price: 99, stock: 12   },
      { id: 'sku-1003', name: 'Holographic flange', price: 7,  stock: 9001 },
    ],
    schema: 'https://example.org/schemas/catalog.v1.json',
  }, null, 2));
}

function apiPeek(req, res, { stile, url }) {
  const tierParam = url.searchParams.get('tier');
  const tierOk = ['easy', 'medium', 'strong'].includes(tierParam);
  const challenge = stile.issueChallenge(tierOk ? { tier: tierParam } : undefined);
  const block = stile.challengeBlock(challenge);
  const verifyUrl = `/__stile-verify?token=${challenge.token}&word=${challenge.word}`;
  const decoyMatch = block.match(/\/__stile-verify-decoy\?token=[^"&\s]+/);
  const jsonldMatch = block.match(/<script type="application\/ld\+json"[^>]*>([\s\S]*?)<\/script>/);
  let jsonld = null; if (jsonldMatch) { try { jsonld = JSON.parse(jsonldMatch[1]); } catch {} }
  const ariaMatch = block.match(/<div data-stile aria-hidden[^>]*>([\s\S]*?)<\/div>/);
  const ariaText = ariaMatch ? ariaMatch[1].replace(/<[^>]+>/g, '').replace(/\s+/g, ' ').trim() : null;
  res.statusCode = 200;
  res.setHeader('Content-Type', 'application/json');
  res.setHeader('Cache-Control', 'no-store');
  res.end(JSON.stringify({
    what_humans_see: 'A friendly card saying the page is for AI agents.',
    what_ais_see: block,
    verify_url: verifyUrl,
    challenge_word: challenge.word,
    tier: challenge.tier,
    expires_at: challenge.exp,
    channels: {
      comment: `<!-- stile:v1 verify="${verifyUrl}" word="${challenge.word}" exp="${challenge.exp}" tier="${challenge.tier}" -->`,
      jsonld,
      aria_hidden_text: ariaText,
      svg_title: verifyUrl,
      meta_tags: {
        'stile-verify': verifyUrl,
        'stile-word': challenge.word,
        'stile-tier': challenge.tier,
        'stile-css-var': '--stile-verify',
      },
      honeypot_decoy_url: decoyMatch ? decoyMatch[0] : null,
    },
  }, null, 2));
}

function challengeSchemaResponse(req, res) {
  res.statusCode = 200;
  res.setHeader('Content-Type', 'application/schema+json');
  res.end(JSON.stringify(challengeSchema(), null, 2));
}

function challengeSchema() {
  return {
    $schema: 'https://json-schema.org/draft/2020-12/schema',
    $id: 'https://stile.dev/v1/challenge.schema.json',
    title: 'StileChallenge',
    type: 'object',
    required: ['verify_url', 'word', 'tier', 'expires_at', 'protocol'],
    properties: {
      '@context': { const: 'https://stile.dev/v1' },
      '@type': { const: 'StileChallenge' },
      verify_url: { type: 'string', description: 'URL the AI client should fetch to identify itself.' },
      word: { type: 'string', description: 'Challenge word — required for medium/strong tiers.' },
      tier: { enum: ['easy', 'medium', 'strong'] },
      expires_at: { type: 'integer', description: 'Unix seconds at which the challenge token becomes invalid.' },
      protocol: { const: 'stile/v1' },
    },
  };
}

module.exports = {
  agentsPage,
  apiData,
  apiPeek,
  challengeSchemaResponse,
  challengeSchema,
};
