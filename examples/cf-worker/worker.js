// Example: Cloudflare Worker entrypoint.
// Deploy with `wrangler deploy`. Bind a KV namespace named STILE_KV
// for shared nonce + event storage across cold starts.

import createCfWorkerHandler from '../../lib/adapters/cf-worker.js';

const handle = createCfWorkerHandler({
  secret: 'dev-secret-rotate-me',
  protect: ['/agents', '/api/data'],
}, async (request) => {
  const url = new URL(request.url);
  if (url.pathname === '/api/data') {
    return new Response(JSON.stringify({ ok: true, message: 'Hello, agent.' }), {
      headers: { 'content-type': 'application/json' },
    });
  }
  return new Response('<h1>CF Worker + STILE</h1>', {
    headers: { 'content-type': 'text/html' },
  });
});

export default { fetch: handle };
