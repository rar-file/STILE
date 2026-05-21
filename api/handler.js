'use strict';

const createHandler = require('../lib/handler');
const handler = createHandler();
module.exports = (req, res) => handler(req, res);
