'use strict';

// Pure URL dispatcher. Holds no state of its own — the stile + admin
// instances are constructed by handler.js and threaded through here so this
// file stays a flat, scannable map of `path → handler`.

const fs = require('fs');
const path = require('path');
const { serveStatic } = require('./util');
const verify = require('./verify');
const stats = require('./stats');
const playground = require('./playground');

function createAppHandler({ stile, admin, publicDir, templatesDir }) {
  return function appHandler(req, res) {
    const url = new URL(req.url, `http://${req.headers.host || 'localhost'}`);
    const p = url.pathname;
    const method = req.method || 'GET';
    const ctx = { stile, url };

    // Verification surface
    if (p === '/agents' || p === '/agents/') {
      return verify.agentsPage(req, res, { templatesDir });
    }
    if (p === '/api/data') {
      return verify.apiData(req, res);
    }
    if (p === '/api/peek') {
      return verify.apiPeek(req, res, ctx);
    }
    if (p === '/v1/challenge.schema.json') {
      return verify.challengeSchemaResponse(req, res);
    }

    // Stats / counters / wall / adopters
    if (p === '/api/stats/counter') {
      return stats.counterSnapshot(req, res, ctx);
    }
    if (p === '/api/stats/counter/stream') {
      return stats.counterStream(req, res, ctx);
    }
    if (p === '/api/stats/summary') {
      return stats.summary(req, res, ctx);
    }
    if (p === '/api/wall') {
      return stats.wall(req, res, ctx);
    }
    if (p === '/api/adopters') {
      return stats.adopters(req, res, ctx);
    }
    if (p === '/api/badge/ping' && method === 'POST') {
      return stats.badgePing(req, res, ctx);
    }
    if (p === '/badge.js') {
      return stats.badgeJs(req, res);
    }

    // Playground
    if (p === '/api/playground/run' && method === 'POST') {
      return playground.playgroundRun(req, res, ctx);
    }

    // Health check — suitable for load-balancer probes.
    if (p === '/health') {
      if (method !== 'GET' && method !== 'HEAD') {
        res.statusCode = 405;
        res.setHeader('Allow', 'GET, HEAD');
        res.end();
        return;
      }

      let storeOk = true;
      try { stile.store.events.counterToday(); } catch { storeOk = false; }
      const storeType = (typeof stile.options.store === 'string' && stile.options.store.startsWith('file'))
        ? 'file' : 'memory';
      res.statusCode = storeOk ? 200 : 503;
      res.setHeader('Content-Type', 'application/json');
      if (method === 'HEAD') {
        res.end();
        return;
      }
      res.end(JSON.stringify({ ok: storeOk, store: storeType, uptime: Math.floor(process.uptime()) }));
      return;
    }

    // Admin dashboard
    if (p === '/admin/stats' || p === '/admin') {
      return admin.handle(req, res);
    }

    // Static pages
    if (p === '/spec' || p === '/spec/') {
      return serveStatic(req, res, path.join(publicDir, 'spec.html'));
    }
    if (p === '/playground' || p === '/playground/') {
      return serveStatic(req, res, path.join(publicDir, 'playground.html'));
    }
    if (p === '/wall' || p === '/wall/') {
      return serveStatic(req, res, path.join(publicDir, 'wall.html'));
    }
    if (p === '/dashboard' || p === '/dashboard/') {
      return serveStatic(req, res, path.join(publicDir, 'dashboard.html'));
    }
    if (p === '/signup' || p === '/signup/') {
      return serveStatic(req, res, path.join(publicDir, 'signup.html'));
    }
    if (p === '/login' || p === '/login/') {
      return serveStatic(req, res, path.join(publicDir, 'login.html'));
    }
    if (p === '/adopters' || p === '/adopters/') {
      return serveStatic(req, res, path.join(publicDir, 'adopters.html'));
    }
    if (p === '/examples' || p === '/examples/') {
      return serveStatic(req, res, path.join(publicDir, 'examples.html'));
    }
    {
      const m = p.match(/^\/examples\/(news|docs|shop|jobs|weather)\/?$/);
      if (m) {
        return serveStatic(req, res, path.join(publicDir, 'examples-' + m[1] + '.html'));
      }
    }
    if (p === '/' || p === '/index.html') {
      return serveStatic(req, res, path.join(publicDir, 'index.html'));
    }

    // Generic public/ fallthrough
    const safe = path.normalize(p).replace(/^([\\/])+/, '');
    const candidate = path.join(publicDir, safe);
    if (candidate.startsWith(publicDir) && fs.existsSync(candidate) && fs.statSync(candidate).isFile()) {
      return serveStatic(req, res, candidate);
    }

    res.statusCode = 404;
    res.setHeader('Content-Type', 'text/plain');
    res.end('Not found');
  };
}

module.exports = { createAppHandler };
