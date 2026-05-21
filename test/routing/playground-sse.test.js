'use strict';

// Routing: the playground SSE endpoint, mock mode, end-to-end.
// Verifies the documented event ordering: step → challenge → prompt
// → token(s) → extracted → verify-response → done.

const test = require('node:test');
const assert = require('node:assert/strict');
const http = require('node:http');
const { startHandler } = require('./helper');

function readSse(port, path, body) {
  return new Promise((resolve, reject) => {
    const req = http.request({
      host: '127.0.0.1', port, path, method: 'POST',
      headers: { 'content-type': 'application/json' },
    }, (res) => {
      let buf = '';
      const events = [];
      res.on('data', (chunk) => {
        buf += chunk.toString('utf8');
        let idx;
        while ((idx = buf.indexOf('\n\n')) !== -1) {
          const ev = buf.slice(0, idx);
          buf = buf.slice(idx + 2);
          const lines = ev.split('\n');
          let event = 'message', data = '';
          for (const ln of lines) {
            if (ln.startsWith('event: ')) event = ln.slice(7);
            else if (ln.startsWith('data: ')) data = ln.slice(6);
          }
          if (event && data !== '') {
            try { events.push({ event, data: JSON.parse(data) }); }
            catch { events.push({ event, data }); }
          }
          if (event === 'done') {
            res.destroy();
            resolve(events);
            return;
          }
        }
      });
      res.on('error', reject);
      res.on('end', () => resolve(events));
    });
    req.on('error', reject);
    req.write(body);
    req.end();
  });
}

test('mock-mode playground emits the documented event sequence', async () => {
  const { server, port } = await startHandler();
  try {
    const events = await readSse(port, '/api/playground/run',
      JSON.stringify({ provider: 'mock' }));
    const seq = events.map(e => e.event);
    // We expect the canonical order; tokens appear multiple times between
    // 'prompt' and 'extracted'.
    assert.ok(seq.includes('step'), 'no step event');
    assert.ok(seq.includes('challenge'), 'no challenge event');
    assert.ok(seq.includes('prompt'), 'no prompt event');
    assert.ok(seq.includes('extracted'), 'no extracted event');
    assert.ok(seq.includes('verify-response'), 'no verify-response event');
    assert.ok(seq.includes('done'), 'no done event');

    const stepIdx = seq.indexOf('step');
    const challengeIdx = seq.indexOf('challenge');
    const promptIdx = seq.indexOf('prompt');
    const extractedIdx = seq.indexOf('extracted');
    const verifyIdx = seq.indexOf('verify-response');
    const doneIdx = seq.indexOf('done');

    assert.ok(stepIdx < challengeIdx);
    assert.ok(challengeIdx < promptIdx);
    assert.ok(promptIdx < extractedIdx);
    assert.ok(extractedIdx < verifyIdx);
    assert.ok(verifyIdx < doneIdx);

    const done = events.find(e => e.event === 'done');
    assert.equal(done.data.ok, true, 'mock-mode should always succeed');

    const verify = events.find(e => e.event === 'verify-response');
    assert.equal(verify.data.ok, true);
    assert.equal(verify.data.protocol, 'stile/v1');
  } finally { server.close(); }
});
