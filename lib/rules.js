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

// Parses a CIDR string into pre-computed BigInts used at match time.
// Throws with a descriptive message on invalid syntax so misconfigured rules
// fail loudly at createRules() time rather than silently returning false.
function parseCIDR(cidr) {
  if (!cidr.includes('/')) {
    if (ipToBigInt(cidr) === null) throw new Error(`Invalid IP address in rule: "${cidr}"`);
    return null; // exact-match — no mask needed
  }
  const parts = cidr.split('/');
  if (parts.length !== 2) throw new Error(`Invalid CIDR in rule: "${cidr}" (expected exactly one "/")`);
  const [base, prefixStr] = parts;
  const baseN = ipToBigInt(base);
  if (baseN === null) throw new Error(`Invalid CIDR base address in rule: "${cidr}"`);
  const bits = base.includes(':') ? 128 : 32;
  // Strict numeric check — parseInt is lenient ("8abc" → 8, " 8" → 8), which
  // would silently accept a typo'd prefix and defeat the fail-loudly intent.
  if (!/^\d+$/.test(prefixStr)) {
    throw new Error(`Invalid CIDR prefix length in rule: "${cidr}" (must be digits 0–${bits})`);
  }
  const prefix = parseInt(prefixStr, 10);
  if (prefix < 0 || prefix > bits) {
    throw new Error(`Invalid CIDR prefix length in rule: "${cidr}" (must be 0–${bits})`);
  }
  const mask = ((1n << BigInt(bits)) - 1n) ^ ((1n << BigInt(bits - prefix)) - 1n);
  return { mask, maskedBase: baseN & mask };
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
    case 'ip': {
      if (!ctx.ip) return false;
      if (!rule._parsed) return ctx.ip === rule.value; // exact match
      const ipN = ipToBigInt(ctx.ip);
      if (ipN === null) return false;
      return (ipN & rule._parsed.mask) === rule._parsed.maskedBase;
    }
    case 'asn':      return ctx.asn != null && Number(ctx.asn) === Number(rule.value);
    case 'country':  return ctx.country && String(ctx.country).toUpperCase() === String(rule.value).toUpperCase();
    case 'agent':    return ctx.agent && (rule.value instanceof RegExp ? rule.value.test(ctx.agent) : ctx.agent === rule.value);
    case 'signer':   return ctx.signer && ctx.signer === rule.value;
    default:         return false;
  }
}

// Pre-parse ip-kind rules to avoid BigInt string-parsing on every request.
// Throws immediately if any CIDR is malformed.
function prepareRules(rules) {
  return rules.map(r => {
    if (r.kind !== 'ip') return r;
    const parsed = parseCIDR(r.value);
    return parsed ? { ...r, _parsed: parsed } : r;
  });
}

function createRules({ allow = [], deny = [], geoLookup = null } = {}) {
  const preparedDeny = prepareRules(deny);
  const preparedAllow = prepareRules(allow);

  function evaluate(req, info) {
    const ip = remoteIp(req);
    let asn = null, country = null;
    if (geoLookup) {
      try { const g = geoLookup(ip); if (g) { asn = g.asn; country = g.country; } } catch { /* ignore */ }
    }
    const ctx = { ip, asn, country, agent: info && info.agent, signer: info && info.signer };
    for (const r of preparedDeny) if (ruleMatches(r, ctx)) return { decision: 'deny', rule: r };
    for (const r of preparedAllow) if (ruleMatches(r, ctx)) return { decision: 'allow', rule: r };
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
module.exports.parseCIDR = parseCIDR;
module.exports.remoteIp = remoteIp;
