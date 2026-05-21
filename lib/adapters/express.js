'use strict';

// Express adapter. Express requests/responses are already Node-compatible,
// so this is mostly a passthrough — but we keep the wrapper so users get
// a single, ergonomic API: `app.use(createStileExpress(opts))`.

const createStile = require('../stile');

function createStileExpress(opts = {}) {
  const stile = createStile(opts);
  const inner = stile.middleware();
  const fn = function (req, res, next) {
    inner(req, res, next);
  };
  fn.stile = stile;
  return fn;
}

module.exports = createStileExpress;
module.exports.createStileExpress = createStileExpress;
