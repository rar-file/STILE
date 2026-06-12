'use strict';

const { todayIso } = require('./util');

function createMemoryStore({
  maxEvents = 50000,
} = {}) {
  // ---- single-use nonces (#18)
  const usedNonces = new Map(); // nonce -> expiresAt (ms)
  const nonceCleanup = setInterval(() => {
    const now = Date.now();
    for (const [n, e] of usedNonces) if (e <= now) usedNonces.delete(n);
  }, 30_000);
  if (nonceCleanup.unref) nonceCleanup.unref();

  // ---- events log (#30)
  const events = []; // { ts, kind, agent, ip_hash, ua_hash, tier, fast_path, signer, decoy_token }
  const eventsListeners = new Set();

  // ---- per-day counters (#1)
  const dailyCounts = new Map(); // dateIso -> count of 'verified' events

  // ---- agent aggregate (#3)
  const agents = new Map(); // name -> { name, vendor, first_seen, last_seen, verification_count }

  // ---- reputation (#24)
  const reputations = new Map(); // identity -> { counters, score, updated_at }

  // ---- adopters (#4)
  const adopters = new Map(); // domain -> { domain, status, first_seen, last_ping, install_count }

  // ---- rate limits (#6) ----
  // key → { count, expiresAt(ms) }. Each hit() either starts a fresh window
  // or increments an existing one. We sweep expired entries opportunistically
  // on hit() and on a low-frequency interval — there is no global GC needed.
  const rateLimitWindows = new Map();
  const rateLimitCleanup = setInterval(() => {
    const now = Date.now();
    for (const [k, w] of rateLimitWindows) if (w.expiresAt <= now) rateLimitWindows.delete(k);
  }, 60_000);
  if (rateLimitCleanup.unref) rateLimitCleanup.unref();

  function pushEvent(ev) {
    const e = { ts: Date.now(), ...ev };
    events.push(e);
    if (events.length > maxEvents) events.splice(0, events.length - maxEvents);

    if (e.kind === 'verified') {
      const day = todayIso();
      dailyCounts.set(day, (dailyCounts.get(day) || 0) + 1);
      if (e.agent) {
        const a = agents.get(e.agent) || { name: e.agent, vendor: null, first_seen: e.ts, last_seen: e.ts, verification_count: 0 };
        a.last_seen = e.ts;
        a.verification_count += 1;
        agents.set(e.agent, a);
      }
    }
    for (const fn of eventsListeners) {
      try { fn(e); } catch { /* swallow listener errors */ }
    }
    return e;
  }

  function summary(rangeMs = 24 * 60 * 60 * 1000) {
    const cutoff = Date.now() - rangeMs;
    const recent = events.filter(e => e.ts >= cutoff);
    const buckets = new Map(); // hour bucket -> { issued, verified, blocked, decoy }
    const bucketSize = rangeMs <= 24 * 3600 * 1000 ? 3600 * 1000 : 24 * 3600 * 1000;
    for (const e of recent) {
      const b = Math.floor(e.ts / bucketSize) * bucketSize;
      let row = buckets.get(b);
      if (!row) { row = { ts: b, issued: 0, verified: 0, blocked: 0, decoy: 0 }; buckets.set(b, row); }
      if (e.kind === 'challenge_issued') row.issued += 1;
      else if (e.kind === 'verified') row.verified += 1;
      else if (e.kind === 'gated_blocked') row.blocked += 1;
      else if (e.kind === 'decoy_hit') row.decoy += 1;
    }
    const series = Array.from(buckets.values()).sort((a, b) => a.ts - b.ts);

    const totals = recent.reduce((acc, e) => { acc[e.kind] = (acc[e.kind] || 0) + 1; return acc; }, {});

    const agentTotals = new Map();
    for (const e of recent) {
      if (e.kind !== 'verified' || !e.agent) continue;
      agentTotals.set(e.agent, (agentTotals.get(e.agent) || 0) + 1);
    }
    const topAgents = Array.from(agentTotals.entries())
      .sort((a, b) => b[1] - a[1]).slice(0, 10)
      .map(([name, count]) => ({ name, count }));

    const tiers = recent.reduce((acc, e) => {
      if (e.tier) acc[e.tier] = (acc[e.tier] || 0) + 1;
      return acc;
    }, {});

    return { range_ms: rangeMs, series, totals, top_agents: topAgents, tiers, total_events: recent.length };
  }

  return {
    nonces: {
      has(nonce) { return usedNonces.has(nonce); },
      add(nonce, expSec) { usedNonces.set(nonce, expSec * 1000); },
      // Atomic check-and-add: returns true if newly recorded, false if already
      // present. In a single Node process the Map check-and-set runs without
      // interleaving, so this is the strongest guarantee an in-memory store
      // can offer. Multi-process deployments must use a shared store whose
      // consume() is backed by an atomic primitive (e.g. SETNX in Redis).
      consume(nonce, expSec) {
        if (usedNonces.has(nonce)) return false;
        usedNonces.set(nonce, expSec * 1000);
        return true;
      },
    },
    events: {
      record: pushEvent,
      summary,
      counterToday() { return dailyCounts.get(todayIso()) || 0; },
      counterAllTime() {
        let total = 0;
        for (const v of dailyCounts.values()) total += v;
        return total;
      },
      subscribe(fn) { eventsListeners.add(fn); return () => eventsListeners.delete(fn); },
    },
    agents: {
      list({ minVerifications = 1, limit = 100 } = {}) {
        return Array.from(agents.values())
          .filter(a => a.verification_count >= minVerifications)
          .sort((a, b) => b.last_seen - a.last_seen)
          .slice(0, limit);
      },
      get(name) { return agents.get(name) || null; },
    },
    reputation: {
      get(identity) {
        return reputations.get(identity) || { identity, score: 100, counters: { verifications: 0, decoy_hits: 0, ratelimit_hits: 0 }, updated_at: Date.now() };
      },
      record(identity, change) {
        const cur = reputations.get(identity) || { identity, counters: { verifications: 0, decoy_hits: 0, ratelimit_hits: 0 }, score: 100 };
        for (const k of Object.keys(change || {})) cur.counters[k] = (cur.counters[k] || 0) + (change[k] || 0);
        const c = cur.counters;
        const raw = 100 - 25 * (c.decoy_hits || 0) - 5 * (c.ratelimit_hits || 0) + Math.log10(1 + (c.verifications || 0)) * 5;
        cur.score = Math.max(0, Math.min(100, Math.round(raw)));
        cur.updated_at = Date.now();
        reputations.set(identity, cur);
        return cur;
      },
      list({ limit = 50 } = {}) {
        return Array.from(reputations.values()).sort((a, b) => a.score - b.score).slice(0, limit);
      },
    },
    rateLimits: {
      // Increment `key`'s counter inside a sliding window of length
      // `windowMs`. Returns the new count and the time at which the window
      // expires. Callers compare `count` to their threshold and use
      // `expiresAt` to derive `Retry-After`.
      hit(key, windowMs) {
        const now = Date.now();
        let w = rateLimitWindows.get(key);
        if (!w || w.expiresAt <= now) {
          w = { count: 0, expiresAt: now + windowMs };
          rateLimitWindows.set(key, w);
        }
        w.count += 1;
        return { count: w.count, expiresAt: w.expiresAt };
      },
      reset(key) { rateLimitWindows.delete(key); },
    },
    adopters: {
      upsert(domain, info = {}) {
        const cur = adopters.get(domain) || { domain, status: 'claimed', first_seen: Date.now(), last_ping: Date.now(), install_count: 0 };
        cur.last_ping = Date.now();
        cur.install_count = (cur.install_count || 0) + 1;
        Object.assign(cur, info);
        adopters.set(domain, cur);
        return cur;
      },
      setStatus(domain, status) {
        const cur = adopters.get(domain);
        if (cur) { cur.status = status; adopters.set(domain, cur); }
        return cur;
      },
      list({ status } = {}) {
        const arr = Array.from(adopters.values());
        return status ? arr.filter(a => a.status === status) : arr;
      },
      get(domain) { return adopters.get(domain) || null; },
    },
  };
}

module.exports = createMemoryStore;
module.exports.createMemoryStore = createMemoryStore;
