'use strict';

// File-backed JSON store. Same interface as createMemoryStore, but the state
// survives process restart. Loads from disk on construct, holds the working
// state in memory for fast reads, and flushes mutations back to disk via a
// debounced atomic write (write to <path>.tmp, fsync, then rename).
//
// Durability
// ----------
//   - Atomic write: temp-file + rename ensures readers never see a partial
//     JSON payload. On POSIX rename(2) is atomic; on Windows Node uses
//     MoveFileEx with the replace-existing flag, which is also atomic for
//     the directory entry.
//   - fsync: we fsync the temp file before rename so its bytes are on the
//     storage device before it becomes visible. We do NOT fsync the parent
//     directory because the syscall is unreliable on Windows; on POSIX a
//     hard crash within a few hundred ms of a flush may revert to the
//     previous snapshot. That tradeoff is acceptable for the intended use
//     of this store (single-node dev / small deploys).
//   - Debounce: writes are coalesced over `flushDebounceMs` (default 250)
//     and flushed at least every `flushIntervalMs` (default 30s). On hard
//     crash you lose up to one debounce window of mutations.
//
// Concurrency
// -----------
//   This store is NOT multi-process safe. Two processes pointing at the
//   same file will lose writes from whichever process flushes second. Run
//   one writer or use a real database (any object that matches the
//   pluggable store shape is valid).
//
// For higher write volume or multi-node deploys, supply your own store
// (KV / Redis / Postgres / Durable Object) via opts.store on createStile.

const fs = require('fs');
const path = require('path');

function todayIso() {
  return new Date().toISOString().slice(0, 10);
}

function safeReadJson(file) {
  let raw;
  try {
    raw = fs.readFileSync(file, 'utf8');
  } catch (e) {
    if (e.code === 'ENOENT') return null;
    console.warn(`[stile] could not read ${file} (${e.message}); starting fresh`);
    return null;
  }
  if (!raw.trim()) return null;
  try {
    return JSON.parse(raw);
  } catch (e) {
    // Don't silently drop corrupt state — preserve a copy so an operator
    // can recover. Then start fresh.
    const backup = `${file}.corrupt-${Date.now()}.bak`;
    try { fs.writeFileSync(backup, raw); } catch { /* best effort */ }
    console.warn(`[stile] could not parse ${file} (${e.message}); preserved at ${backup}; starting fresh`);
    return null;
  }
}

function createFileStore({
  filePath = './stile-data.json',
  flushDebounceMs = 250,
  flushIntervalMs = 30_000,
  maxEvents = 50_000,
  nonceTtlMs = 5 * 60 * 1000,          // unused at the persistence layer; nonces auto-expire in memory
  eventsRetentionMs = 30 * 24 * 60 * 60 * 1000,
} = {}) {
  const abs = path.resolve(filePath);
  const dir = path.dirname(abs);
  try { fs.mkdirSync(dir, { recursive: true }); } catch { /* already exists */ }

  // ---- Load ----------------------------------------------------------------
  const raw = safeReadJson(abs) || {};
  const usedNonces = new Map();        // nonce → expiresAt(ms)
  for (const [n, exp] of Object.entries(raw.nonces || {})) {
    if (typeof exp === 'number' && exp > Date.now()) usedNonces.set(n, exp);
  }
  const events = Array.isArray(raw.events) ? raw.events.slice(-maxEvents) : [];
  const dailyCounts = new Map(Object.entries(raw.dailyCounts || {}));
  const agents = new Map(Object.entries(raw.agents || {}));
  const reputations = new Map(Object.entries(raw.reputations || {}));
  const adopters = new Map(Object.entries(raw.adopters || {}));
  const eventsListeners = new Set();
  const rateLimitCounters = new Map(); // key -> { count, windowStart } — in-memory only

  // ---- Flush ---------------------------------------------------------------
  let dirty = false;
  let flushTimer = null;

  function snapshot() {
    return {
      version: 1,
      saved_at: Date.now(),
      nonces: Object.fromEntries(usedNonces),
      events,
      dailyCounts: Object.fromEntries(dailyCounts),
      agents: Object.fromEntries(agents),
      reputations: Object.fromEntries(reputations),
      adopters: Object.fromEntries(adopters),
    };
  }

  function flushNow() {
    if (!dirty) return;
    dirty = false;
    const tmp = abs + '.tmp';
    let fd = null;
    try {
      // Open + write + fsync + close so the bytes are durable BEFORE rename
      // makes the new snapshot visible to readers and crash recovery.
      fd = fs.openSync(tmp, 'w');
      fs.writeSync(fd, JSON.stringify(snapshot()));
      try { fs.fsyncSync(fd); } catch { /* fsync may be unavailable on some FS — accept */ }
      fs.closeSync(fd);
      fd = null;
      fs.renameSync(tmp, abs);
    } catch (e) {
      if (fd != null) { try { fs.closeSync(fd); } catch {} }
      try { fs.unlinkSync(tmp); } catch {}
      dirty = true;
      // Retry on the next debounce window so we don't have to wait the full
      // flushIntervalMs for a transient EBUSY / disk-full to clear.
      if (!flushTimer) {
        flushTimer = setTimeout(() => { flushTimer = null; flushNow(); }, flushDebounceMs);
        if (flushTimer.unref) flushTimer.unref();
      }
      console.warn(`[stile] could not write ${abs}: ${e.message}`);
    }
  }
  function markDirty() {
    dirty = true;
    if (flushTimer) return;
    flushTimer = setTimeout(() => { flushTimer = null; flushNow(); }, flushDebounceMs);
    if (flushTimer.unref) flushTimer.unref();
  }
  const periodic = setInterval(flushNow, flushIntervalMs);
  if (periodic.unref) periodic.unref();

  // Best-effort flush on graceful shutdown.
  const shutdown = () => { try { flushNow(); } catch {} };
  process.once('beforeExit', shutdown);
  process.once('SIGINT',  () => { shutdown(); process.exit(130); });
  process.once('SIGTERM', () => { shutdown(); process.exit(143); });

  // ---- Nonce GC (in-memory only, on a timer) ------------------------------
  const nonceCleanup = setInterval(() => {
    const now = Date.now();
    let removed = 0;
    for (const [n, e] of usedNonces) if (e <= now) { usedNonces.delete(n); removed++; }
    if (removed) markDirty();
  }, 30_000);
  if (nonceCleanup.unref) nonceCleanup.unref();

  // ---- Events --------------------------------------------------------------
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
        a.verification_count = (a.verification_count || 0) + 1;
        agents.set(e.agent, a);
      }
    }
    for (const fn of eventsListeners) { try { fn(e); } catch {} }
    markDirty();
    return e;
  }

  function summary(rangeMs = 24 * 60 * 60 * 1000) {
    const cutoff = Date.now() - rangeMs;
    const recent = events.filter(e => e.ts >= cutoff);
    const buckets = new Map();
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
    const tiers = recent.reduce((acc, e) => { if (e.tier) acc[e.tier] = (acc[e.tier] || 0) + 1; return acc; }, {});
    return { range_ms: rangeMs, series, totals, top_agents: topAgents, tiers, total_events: recent.length };
  }

  return {
    nonces: {
      has(n) { return usedNonces.has(n); },
      add(n, expSec) { usedNonces.set(n, expSec * 1000); markDirty(); },
    },
    rateLimits: {
      hit(key, windowMs) {
        const now = Date.now();
        let entry = rateLimitCounters.get(key);
        if (!entry || now >= entry.windowStart + windowMs) {
          entry = { count: 0, windowStart: now };
        }
        entry.count += 1;
        rateLimitCounters.set(key, entry);
        return entry.count;
      },
      reset(key) { rateLimitCounters.delete(key); },
    },
    events: {
      record: pushEvent,
      summary,
      counterToday() { return dailyCounts.get(todayIso()) || 0; },
      counterAllTime() { let t = 0; for (const v of dailyCounts.values()) t += v; return t; },
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
        markDirty();
        return cur;
      },
      list({ limit = 50 } = {}) {
        return Array.from(reputations.values()).sort((a, b) => a.score - b.score).slice(0, limit);
      },
    },
    adopters: {
      upsert(domain, info = {}) {
        const cur = adopters.get(domain) || { domain, status: 'claimed', first_seen: Date.now(), last_ping: Date.now(), install_count: 0 };
        cur.last_ping = Date.now();
        cur.install_count = (cur.install_count || 0) + 1;
        Object.assign(cur, info);
        adopters.set(domain, cur);
        markDirty();
        return cur;
      },
      setStatus(domain, status) {
        const cur = adopters.get(domain);
        if (cur) { cur.status = status; adopters.set(domain, cur); markDirty(); }
        return cur;
      },
      list({ status } = {}) {
        const arr = Array.from(adopters.values());
        return status ? arr.filter(a => a.status === status) : arr;
      },
      get(domain) { return adopters.get(domain) || null; },
    },
    // Diagnostic helpers (not part of the standard store interface)
    _flushNow: flushNow,
    _filePath: abs,
  };
}

module.exports = createFileStore;
module.exports.createFileStore = createFileStore;
