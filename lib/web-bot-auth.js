'use strict';

// Minimal subset of HTTP Message Signatures (RFC 9421 — known as Web Bot Auth
// when used to identify automated clients). Verifies signatures created over
// a small, fixed component set and a single algorithm to keep the
// implementation tractable.
//
// Supported components:  "@method", "@authority", "@path"
// Supported algorithms:  ed25519
// Required parameters:   keyid, alg, created
//
// Trusted signers are passed in as { keyId -> { name, publicKeyPem } }.

const crypto = require('crypto');

function parseSignatureInput(header) {
  // sig1=("@method" "@authority" "@path");keyid="example-key";alg="ed25519";created=1730000000
  if (!header) return null;
  const eq = header.indexOf('=');
  if (eq < 0) return null;
  const label = header.slice(0, eq).trim();
  const rest = header.slice(eq + 1).trim();
  const compEnd = rest.indexOf(')');
  if (!rest.startsWith('(') || compEnd < 0) return null;
  const compsRaw = rest.slice(1, compEnd);
  const params = rest.slice(compEnd + 1).replace(/^;/, '');
  const components = compsRaw.match(/"[^"]+"/g)?.map(s => s.slice(1, -1)) || [];
  const paramMap = {};
  for (const p of params.split(';').map(s => s.trim()).filter(Boolean)) {
    const i = p.indexOf('=');
    if (i < 0) continue;
    const k = p.slice(0, i).trim();
    let v = p.slice(i + 1).trim();
    if (v.startsWith('"') && v.endsWith('"')) v = v.slice(1, -1);
    paramMap[k] = v;
  }
  return { label, components, params: paramMap };
}

function parseSignature(header, label) {
  // sig1=:base64sig:
  if (!header) return null;
  const eq = header.indexOf('=');
  if (eq < 0) return null;
  const lbl = header.slice(0, eq).trim();
  if (lbl !== label) return null;
  const v = header.slice(eq + 1).trim();
  if (!v.startsWith(':') || !v.endsWith(':')) return null;
  return Buffer.from(v.slice(1, -1), 'base64');
}

function buildSignatureBase(req, parsed) {
  const lines = [];
  for (const c of parsed.components) {
    if (c === '@method') lines.push(`"@method": ${(req.method || 'GET').toUpperCase()}`);
    else if (c === '@authority') lines.push(`"@authority": ${req.headers.host || ''}`);
    else if (c === '@path') {
      const u = new URL(req.url, `http://${req.headers.host || 'localhost'}`);
      lines.push(`"@path": ${u.pathname}`);
    } else {
      const v = req.headers[c.toLowerCase()];
      if (v == null) return null;
      lines.push(`"${c}": ${String(v)}`);
    }
  }
  const paramParts = [];
  for (const c of parsed.components) paramParts.push(`"${c}"`);
  const paramSuffix = Object.entries(parsed.params).map(([k, v]) => /^\d+$/.test(v) ? `${k}=${v}` : `${k}="${v}"`).join(';');
  lines.push(`"@signature-params": (${paramParts.join(' ')});${paramSuffix}`);
  return lines.join('\n');
}

function createWebBotAuth({ trustedSigners = [], maxAgeSec = 60 } = {}) {
  const byKeyId = new Map();
  for (const s of trustedSigners) {
    byKeyId.set(s.keyId, { ...s, publicKey: crypto.createPublicKey(s.publicKeyPem) });
  }

  function verify(req) {
    const sigInputHeader = req.headers['signature-input'];
    const sigHeader = req.headers['signature'];
    if (!sigInputHeader || !sigHeader) return null;
    const parsed = parseSignatureInput(sigInputHeader);
    if (!parsed) return null;
    if (parsed.params.alg !== 'ed25519') return null;
    const keyId = parsed.params.keyid;
    if (!keyId) return null;
    const signer = byKeyId.get(keyId);
    if (!signer) return null;

    const created = parseInt(parsed.params.created, 10);
    if (!Number.isFinite(created)) return null;
    const nowSec = Math.floor(Date.now() / 1000);
    if (Math.abs(nowSec - created) > maxAgeSec) return null;

    const base = buildSignatureBase(req, parsed);
    if (!base) return null;
    const sigBuf = parseSignature(sigHeader, parsed.label);
    if (!sigBuf) return null;

    let ok = false;
    try { ok = crypto.verify(null, Buffer.from(base, 'utf8'), signer.publicKey, sigBuf); }
    catch { return null; }
    if (!ok) return null;
    return { signer: signer.name || keyId, keyId, fast_path: 'web-bot-auth' };
  }

  return { verify, trustedSigners: byKeyId };
}

module.exports = createWebBotAuth;
module.exports.createWebBotAuth = createWebBotAuth;
module.exports.parseSignatureInput = parseSignatureInput;
module.exports.parseSignature = parseSignature;
module.exports.buildSignatureBase = buildSignatureBase;
