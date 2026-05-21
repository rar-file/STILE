'use strict';

// Fastify adapter. Fastify wraps Node http and exposes the raw req/res, so
// we attach an onRequest hook that runs our gate against the raw objects.

const createStile = require('../stile');

function createStileFastify(opts = {}) {
  const stile = createStile(opts);
  const inject = stile.middleware();
  const plugin = function (fastify, _opts, done) {
    fastify.addHook('onRequest', (request, reply, hookDone) => {
      const req = request.raw;
      const res = reply.raw;
      // The stile middleware will end the response itself if it gates;
      // otherwise it injects an HTML challenge into HTML responses on the
      // way out and calls our continuation.
      inject(req, res, () => hookDone());
      // If stile already ended res, don't call hookDone (Fastify detects).
    });
    done();
  };
  plugin.stile = stile;
  return plugin;
}

module.exports = createStileFastify;
module.exports.createStileFastify = createStileFastify;
