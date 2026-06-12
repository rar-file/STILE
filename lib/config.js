'use strict';

// STILE configuration layer.
//
// Single source of truth for every deploy-sensitive value. Each setting is
// declared in SCHEMA with: env var name, contexts where it's required,
// validators, and the explicit warning/error text the user sees if they
// misconfigure it.
//
// load({ env }) → { context, values, issues, warnings, checks, blocked }
//   - values is the flat object you wire into createStile / createAdmin / etc.
//   - issues block boot in any context (the report tells you why).
//   - warnings are surfaced but never block.
//
// renderReport(report) → string for stdout/stderr.

const crypto = require('crypto');

const DEMO_SECRET = 'demo-secret-rotate-me';
const DEMO_ADMIN_PASSWORD = 'demo-admin';
// Pre-0.4 builds shipped a hardcoded fallback IP-hash salt. The string is
// published in source — IP hashes generated with it correlate across any
// deployment that hasn't set its own salt. We treat its presence as a
// misconfiguration in production (see T11 in docs/THREAT_MODEL.md).
const DEFAULT_IP_SALT = 'stile-default-ip-salt';

const KNOWN_WEAK_PASSWORDS = new Set([
  'demo-admin', 'admin', 'administrator', 'root', 'password', 'passw0rd',
  'password1', 'letmein', '12345678', '123456789', 'changeme', 'change-me',
  'demo', 'test', 'qwerty', 'welcome', 'welcome1', 'p@ssw0rd', 'stile',
  'stile-admin', 'captcha', 'aicaptcha',
]);

const PROD_ENV_KEYS = [
  'VERCEL', 'VERCEL_ENV',
  'FLY_APP_NAME',
  'RENDER',
  'RAILWAY_ENVIRONMENT', 'RAILWAY_PROJECT_ID',
  'DYNO',
  'K_SERVICE',
  'AWS_LAMBDA_FUNCTION_NAME', 'AWS_EXECUTION_ENV',
  'GOOGLE_CLOUD_PROJECT', 'GAE_SERVICE',
  'KUBERNETES_SERVICE_HOST',
];

function detectContext(env) {
  const explicit = String(env.STILE_MODE || '').toLowerCase();
  if (explicit === 'production' || explicit === 'demo' || explicit === 'dev') return explicit;
  if (String(env.NODE_ENV || '').toLowerCase() === 'production') return 'production';
  for (const k of PROD_ENV_KEYS) if (env[k]) return 'production';
  return 'dev';
}

function isWeakPassword(pw) {
  if (!pw) return false;
  return KNOWN_WEAK_PASSWORDS.has(String(pw).toLowerCase());
}

function isLoopbackPeer(req) {
  const peer = req && req.socket && req.socket.remoteAddress;
  if (!peer) return false;
  if (peer === '::1' || peer === '::ffff:127.0.0.1') return true;
  if (peer.startsWith('127.')) return true;
  if (peer.startsWith('::ffff:127.')) return true;
  return false;
}

// ---------------------------------------------------------------------------
// SCHEMA
// ---------------------------------------------------------------------------

const SCHEMA = [
  // ---- secret -------------------------------------------------------------
  {
    key: 'secret',
    env: 'STILE_SECRET',
    sensitive: true,
    resolve(raw, ctx, out) {
      if (raw === DEMO_SECRET) {
        out.fail(`STILE_SECRET is set to the literal demo string '${DEMO_SECRET}'. ` +
          `That value is published in the source — it is NOT a secret. ` +
          `Generate one: openssl rand -hex 32`);
        return;
      }
      if (!raw) {
        if (ctx.isProd) {
          out.fail('STILE_SECRET is unset. Required in production. Generate one: openssl rand -hex 32');
        } else if (ctx.isDemo) {
          out.value = DEMO_SECRET;
          out.warn(`STILE_SECRET unset; using demo default because STILE_MODE=demo. ` +
            `Sessions issued by this instance are forgeable by anyone with internet access.`,
            'demo-default (STILE_MODE=demo)');
        } else {
          out.value = null; // null → library generates ephemeral random
          out.warn('STILE_SECRET unset; an ephemeral random secret will be generated. Sessions die on restart.',
            'ephemeral random (dev)');
        }
        return;
      }
      if (raw.length < 32) {
        if (ctx.isProd) {
          out.fail(`STILE_SECRET is ${raw.length} chars; production requires ≥32. ` +
            `Generate one: openssl rand -hex 32`,
            `${raw.length} chars (need ≥32)`);
        } else {
          out.value = raw;
          out.warn(`STILE_SECRET is ${raw.length} chars; recommend ≥32.`, `${raw.length} chars (short)`);
        }
        return;
      }
      out.value = raw;
      out.ok(`env (${raw.length} chars)`);
    },
  },

  // ---- admin password -----------------------------------------------------
  {
    key: 'adminPassword',
    env: 'STILE_ADMIN_PASSWORD',
    sensitive: true,
    extras: { adminEnabled: false, adminLoopbackOnly: false },
    resolve(raw, ctx, out) {
      if (!raw) {
        if (ctx.isProd) {
          out.value = null;
          out.ok('unset → admin disabled');
        } else {
          out.value = DEMO_ADMIN_PASSWORD;
          out.extras.adminEnabled = true;
          out.extras.adminLoopbackOnly = true;
          out.warn(`STILE_ADMIN_PASSWORD unset; using demo default '${DEMO_ADMIN_PASSWORD}'. ` +
            `Admin will only accept connections from 127.0.0.1.`,
            'demo-default (loopback only)');
        }
        return;
      }
      if (isWeakPassword(raw)) {
        if (ctx.isProd) {
          out.fail(`STILE_ADMIN_PASSWORD matches a known-weak value. Refusing. ` +
            `If you intended the demo password, set STILE_MODE=demo and unset the env var.`,
            'known-weak');
        } else {
          out.value = null;
          out.warn(`STILE_ADMIN_PASSWORD matches a known-weak value. Admin is disabled. ` +
            `Either pick a real password or unset the env var to fall back to the loopback-only demo default.`,
            'known-weak → admin disabled');
        }
        return;
      }
      if (raw.length < 12) {
        if (ctx.isProd) {
          out.fail(`STILE_ADMIN_PASSWORD is ${raw.length} chars; production requires ≥12.`,
            `${raw.length} chars (need ≥12)`);
        } else {
          out.value = raw;
          out.extras.adminEnabled = true;
          out.warn(`STILE_ADMIN_PASSWORD is ${raw.length} chars; recommend ≥12.`, `${raw.length} chars (short)`);
        }
        return;
      }
      out.value = raw;
      out.extras.adminEnabled = true;
      out.ok(`env (${raw.length} chars)`);
    },
  },

  // ---- ip hash salt -------------------------------------------------------
  {
    key: 'ipHashSecret',
    env: 'STILE_IP_SALT',
    sensitive: true,
    resolve(raw, ctx, out) {
      // Treat the published default as "unset" — it offers no real privacy.
      if (raw === DEFAULT_IP_SALT) {
        if (ctx.isProd) {
          out.fail(
            `STILE_IP_SALT is set to the literal default '${DEFAULT_IP_SALT}' — that string is published in source ` +
            `and is NOT a salt. Generate one: openssl rand -hex 32. See docs/DEPLOY.md.`,
            'public default salt');
          return;
        }
        // Dev/demo: fall through to ephemeral generation below.
        raw = '';
      }
      if (!raw) {
        if (ctx.isProd) {
          out.fail(
            'STILE_IP_SALT is unset. Required in production — without a per-deployment salt, IP hashes ' +
            'correlate across any STILE instance that also leaves it unset. ' +
            'Generate one: openssl rand -hex 32. See docs/DEPLOY.md.',
            'unset');
          return;
        }
        // Dev/demo: synthesize an ephemeral salt so we never silently fall
        // back to the published default at the call site. IP hashes won't
        // correlate across restarts, which is the right default for dev.
        out.value = crypto.randomBytes(32).toString('hex');
        out.warn(
          'STILE_IP_SALT not set — using an ephemeral salt. IP hashes will not correlate across restarts. ' +
          'Set STILE_IP_SALT for stable event attribution.',
          'ephemeral random (dev)');
        return;
      }
      out.value = raw;
      out.ok('env');
    },
  },

  // ---- tier ---------------------------------------------------------------
  {
    key: 'tier',
    env: 'STILE_TIER',
    resolve(raw, ctx, out) {
      const allowed = ['easy', 'medium', 'strong'];
      if (!raw) { out.value = 'easy'; out.ok('default (easy)'); return; }
      if (!allowed.includes(raw)) {
        out.fail(`STILE_TIER=${raw} is not one of ${allowed.join('|')}.`, 'invalid');
        return;
      }
      out.value = raw;
      if (raw === 'strong' && ctx.isProd) {
        out.warn('STILE_TIER=strong rejects some legitimate small models. Only use when you control the agent population.',
          'strong (caveat)');
      } else {
        out.ok(raw);
      }
    },
  },

  // ---- webhook ------------------------------------------------------------
  {
    key: 'webhookUrl',
    env: 'STILE_WEBHOOK_URL',
    resolve(raw, ctx, out) {
      if (!raw) { out.value = null; out.ok('unset'); return; }
      try {
        const u = new URL(raw);
        if (u.protocol !== 'https:' && u.protocol !== 'http:') {
          out.fail(`STILE_WEBHOOK_URL must be http(s); got ${u.protocol}`, 'bad scheme');
          return;
        }
        if (u.protocol === 'http:' && ctx.isProd) {
          out.fail('STILE_WEBHOOK_URL is http:// in production. Use https:// or unset.', 'http in prod');
          return;
        }
        out.value = raw;
        out.ok(u.host);
      } catch {
        out.fail(`STILE_WEBHOOK_URL is not a valid URL: ${raw}`, 'invalid url');
      }
    },
  },
  {
    key: 'webhookSecret',
    env: 'STILE_WEBHOOK_SECRET',
    sensitive: true,
    resolve(raw, ctx, out, values) {
      if (!values.webhookUrl) {
        out.value = null;
        if (raw) out.warn('STILE_WEBHOOK_SECRET set but STILE_WEBHOOK_URL is unset — secret will be ignored.', 'orphan secret');
        else out.ok('n/a');
        return;
      }
      if (!raw) {
        if (ctx.isProd) {
          out.fail('STILE_WEBHOOK_SECRET is required when STILE_WEBHOOK_URL is set in production.', 'missing in prod');
        } else {
          out.value = null;
          out.warn('STILE_WEBHOOK_SECRET unset; webhook signatures will use an ephemeral key. Receivers cannot verify across restart.',
            'unsigned (dev)');
        }
        return;
      }
      if (raw.length < 16) {
        out.fail(`STILE_WEBHOOK_SECRET is ${raw.length} chars; require ≥16 for signature integrity.`, `${raw.length} chars`);
        return;
      }
      out.value = raw;
      out.ok(`env (${raw.length} chars)`);
    },
  },

  // ---- store --------------------------------------------------------------
  {
    key: 'store',
    env: 'STILE_STORE',
    resolve(raw, ctx, out) {
      if (!raw) raw = 'memory';
      const allowed = ['memory', 'file'];
      let kind = raw;
      if (raw.startsWith('file:')) kind = 'file';
      if (!allowed.includes(kind)) {
        out.fail(`STILE_STORE=${raw} is not one of ${allowed.join('|')} (or file:/path).`, 'invalid');
        return;
      }
      out.value = raw;
      if (kind === 'memory' && ctx.isProd) {
        out.warn('STILE_STORE=memory in production: events, nonces, and reputation are wiped on restart.',
          'memory (prod caveat)');
      } else {
        out.ok(raw);
      }
    },
  },
  {
    key: 'storePath',
    env: 'STILE_STORE_PATH',
    resolve(raw, ctx, out, values) {
      const usingFile = String(values.store || '').startsWith('file');
      if (!usingFile) {
        out.value = null;
        if (raw) out.warn('STILE_STORE_PATH set but STILE_STORE is not a file store — path will be ignored.', 'orphan path');
        else out.ok('n/a');
        return;
      }
      // file:./foo embeds path; explicit STILE_STORE_PATH overrides
      let path = raw;
      if (!path && values.store && values.store.startsWith('file:')) path = values.store.slice(5);
      if (!path) path = './stile-data.json';
      out.value = path;
      out.ok(path);
    },
  },

  // ---- bind host (sanity) -------------------------------------------------
  {
    key: 'bindHost',
    env: 'HOST',
    resolve(raw, ctx, out, values) {
      const host = raw || process.env.BIND_HOST || null;
      out.value = host;
      const publicBind = host && host !== '127.0.0.1' && host !== 'localhost' && host !== '::1';
      if (publicBind && !ctx.isProd) {
        const secretIsToy = !values.secret || values.secret === DEMO_SECRET;
        if (secretIsToy) {
          out.fail(
            `HOST=${host} (public interface) with no real STILE_SECRET. ` +
            `Bind to 127.0.0.1, set NODE_ENV=production with a real secret, or accept the risk by setting STILE_MODE=demo.`,
            `${host} with toy secret`);
          return;
        }
      }
      out.ok(host || 'default');
    },
  },
];

// ---------------------------------------------------------------------------
// load() — runs the schema
// ---------------------------------------------------------------------------

function load({ env = process.env } = {}) {
  const context = detectContext(env);
  const ctx = { context, isProd: context === 'production', isDemo: context === 'demo' };
  const values = {};
  const checks = [];
  const issues = [];
  const warnings = [];
  const extras = {};

  for (const field of SCHEMA) {
    const raw = env[field.env];
    let resolvedDetail = null;
    let resolvedState = 'ok';
    const out = {
      value: undefined,
      extras: { ...(field.extras || {}) },
      ok(detail)   { resolvedState = 'ok';   resolvedDetail = detail; },
      warn(msg, detail) { resolvedState = 'warn'; resolvedDetail = detail || msg; warnings.push(msg); },
      fail(msg, detail) { resolvedState = 'fail'; resolvedDetail = detail || msg; issues.push(msg); },
    };
    field.resolve(raw, ctx, out, values);
    values[field.key] = out.value;
    Object.assign(extras, out.extras);
    checks.push({ name: field.env, state: resolvedState, detail: resolvedDetail });
  }

  Object.assign(values, extras);

  return {
    context,
    values,
    checks,
    issues,
    warnings,
    blocked: issues.length > 0,
  };
}

// ---------------------------------------------------------------------------
// renderReport — for stdout
// ---------------------------------------------------------------------------

function renderReport(report) {
  const lines = [];
  lines.push('');
  lines.push('  STILE · config check');
  lines.push('  ────────────────────');
  lines.push(`  context: ${report.context.toUpperCase()}`);
  for (const c of report.checks) {
    const tag = c.state === 'ok' ? '[ OK ]' : c.state === 'warn' ? '[WARN]' : '[FAIL]';
    lines.push(`  ${tag} ${c.name.padEnd(24)} ${c.detail}`);
  }
  if (report.warnings.length) {
    lines.push('');
    for (const w of report.warnings) lines.push(`  WARN  ${w}`);
  }
  if (report.issues.length) {
    lines.push('');
    for (const i of report.issues) lines.push(`  FAIL  ${i}`);
  }
  if (report.blocked) {
    lines.push('');
    lines.push('  Refusing to start. Fix the FAIL items above, or run with STILE_MODE=demo to override.');
    lines.push('  (STILE_MODE=demo is for local exploration only — it ships unsafe defaults.)');
  }
  lines.push('');
  return lines.join('\n');
}

module.exports = {
  load,
  renderReport,
  detectContext,
  isWeakPassword,
  isLoopbackPeer,
  DEMO_SECRET,
  DEMO_ADMIN_PASSWORD,
  DEFAULT_IP_SALT,
  KNOWN_WEAK_PASSWORDS,
  PROD_ENV_KEYS,
};
