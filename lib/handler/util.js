'use strict';

const fs = require('fs');
const path = require('path');

const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.css':  'text/css; charset=utf-8',
  '.js':   'application/javascript; charset=utf-8',
  '.svg':  'image/svg+xml',
  '.json': 'application/json; charset=utf-8',
  '.ico':  'image/x-icon',
};

function serveStatic(req, res, filePath) {
  fs.readFile(filePath, (err, data) => {
    if (err) {
      res.statusCode = 404;
      res.setHeader('Content-Type', 'text/plain');
      res.end('Not found');
      return;
    }
    res.statusCode = 200;
    res.setHeader('Content-Type', MIME[path.extname(filePath)] || 'application/octet-stream');
    res.end(data);
  });
}

function readBody(req, max = 16 * 1024) {
  return new Promise((resolve, reject) => {
    const chunks = []; let total = 0;
    req.on('data', (c) => {
      total += c.length;
      if (total > max) { req.destroy(); reject(new Error('body_too_large')); return; }
      chunks.push(c);
    });
    req.on('end', () => resolve(Buffer.concat(chunks).toString('utf8')));
    req.on('error', reject);
  });
}

function isPrivateHost(host) {
  if (!host) return true;
  const h = String(host).toLowerCase();
  if (h === 'localhost' || h.startsWith('127.') || h.startsWith('10.') || h.startsWith('192.168.')
      || h.startsWith('172.16.') || h.startsWith('169.254.') || h.endsWith('.local') || h.includes(':')) return true;
  return false;
}

module.exports = { MIME, serveStatic, readBody, isPrivateHost };
