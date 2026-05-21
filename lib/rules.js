'use strict';

// Allow / deny rules. Each rule = { kind, value, name? }
// Kinds: 'ip' (CIDR or exact), 'asn', 'country', 'agent' (exact or regex), 'signer'
// Order: deny first → if matched, blocked; allow next → if matched, fast-path.

function ipToBigInt(ip) {
  if (ip.includes(':')) {
    // IPv6 — full form
    const parts = expandIPv6(ip).split(':').map(p => parseInt(p, 16));
    let n = 0n;
    for (const p of parts) n = (n << 16n) | BigInt(p);
    return n;
  }
  const parts = ip.split('.').map(p => parseInt(p, 10));
  if (parts.length !== 4 || parts.some(p => isNaN(p) || p < 0 || p > 255)) return null;
  return BigInt(parts[0] * 16777216 + parts[1] * 65536 + parts[2] * 256 + parts[3]);
}

function expandIPv6(ip) {
  if (!ip.includes('::')) return ip;
  const [head, tail] = ip.split('::');
  const headParts = head ? head.split(':') : [];
  const tailParts = tail ? tail.split(':') : [];
  const fill = 8 - headParts.length - tailParts.length;
  return [...headParts, ...new Array(fill).fill('0'), ...tailParts].map(p => p.padStart(4, '0')).join(':');
}

function matchCIDR(ip, cidr) {
  if (!cidr.includes('/')) return ip === cidr;
  const [base, prefixStr] = cidr.split('/');
  const prefix = parseInt(prefixStr, 10);
  const ipN = ipToBigInt(ip); const baseN = ipToBigInt(base);
  if (ipN == null || baseN == null) return false;
  const bits = base.includes(':') ? 128 : 32;
  const mask = ((1n << BigInt(bits)) - 1n) ^ ((1n << BigInt(bits - prefix)) - 1n);
  return (ipN & mask) === (baseN & mask);
}

function ruleMatches(rule, ctx) {
  switch (rule.kind) {
    case 'ip':       return ctx.ip && matchCIDR(ctx.ip, rule.value);
    case 'asn':      return ctx.asn != null && Number(ctx.asn) === Number(rule.value);
    case 'country':  return ctx.country && String(ctx.country).toUpperCase() === String(rule.value).toUpperCase();
    case 'agent':    return ctx.agent && (rule.value instanceof RegExp ? rule.value.test(ctx.agent) : ctx.agent === rule.value);
    case 'signer':   return ctx.signer && ctx.signer === rule.value;
    default:         return false;
  }
}

function createRules({ allow = [], deny = [], geoLookup = null } = {}) {
  function evaluate(req, info) {
    const ip = remoteIp(req);
    let asn = null, country = null;
    if (geoLookup) {
      try { const g = geoLookup(ip); if (g) { asn = g.asn; country = g.country; } } catch { /* ignore */ }
    }
    const ctx = { ip, asn, country, agent: info && info.agent, signer: info && info.signer };
    for (const r of deny) if (ruleMatches(r, ctx)) return { decision: 'deny', rule: r };
    for (const r of allow) if (ruleMatches(r, ctx)) return { decision: 'allow', rule: r };
    return { decision: 'pass' };
  }
  return { evaluate };
}

function remoteIp(req) {
  const xff = req.headers['x-forwarded-for'];
  if (xff) return String(xff).split(',')[0].trim();
  return req.socket && req.socket.remoteAddress || null;
}

module.exports = createRules;
module.exports.createRules = createRules;
module.exports.matchCIDR = matchCIDR;
module.exports.remoteIp = remoteIp;
