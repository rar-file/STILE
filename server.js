'use strict';

const http = require('http');
const createHandler = require('./lib/handler');
const config = require('./lib/config');

const PORT = process.env.PORT || 4173;

// Load and validate every deploy-sensitive value through the central config
// layer. In production, FAIL items block boot; in dev/demo, warnings are
// surfaced but allowed.
const report = config.load();
process.stdout.write(config.renderReport(report));
if (report.blocked) {
  process.exit(1);
}

const handler = createHandler({ config: report });

http.createServer(handler).listen(PORT, () => {
  printBanner(report, PORT);
});

// Single-source-of-truth banner. Anything noisy goes through here so the
// posture of this instance is visible at a glance and impossible to miss.
function printBanner(report, port) {
  const v = report.values;
  const ctx = String(report.context).toUpperCase();
  const isProd = report.context === 'production';
  const isDemo = report.context === 'demo';

  const secretSrc = (() => {
    if (v.secret === config.DEMO_SECRET) return 'DEMO (forgeable — anyone with the source can mint sessions)';
    if (!v.secret) return 'EPHEMERAL (random, lost on restart)';
    return 'env STILE_SECRET';
  })();

  const storeKind = String(v.store || 'memory');
  const storeDetail = storeKind === 'memory'
    ? 'in-memory (wiped on restart)'
    : storeKind.startsWith('file') ? `file (${v.storePath})` : storeKind;

  const adminLine = !v.adminEnabled
    ? 'disabled'
    : v.adminLoopbackOnly ? 'enabled (loopback-only, demo password)' : 'enabled (password protected)';

  const webhookLine = v.webhookUrl
    ? `→ ${new URL(v.webhookUrl).host}${v.webhookSecret ? ' (signed)' : ' (UNSIGNED)'}`
    : 'disabled';

  console.log('');
  console.log(`  STILE  ·  http://localhost:${port}`);
  console.log(`  ─────────────────────────────────`);
  console.log(`  context  ${ctx}${isProd ? '' : isDemo ? '   (DEMO MODE — NOT FOR REAL TRAFFIC)' : '   (dev — not safe for the open internet)'}`);
  console.log(`  secret   ${secretSrc}`);
  console.log(`  store    ${storeDetail}`);
  console.log(`  admin    ${adminLine}`);
  console.log(`  webhook  ${webhookLine}`);
  console.log(`  tier     ${v.tier}`);
  console.log('');
  if (!isProd) {
    console.log('  This is a demo / dev instance. Do not put real users behind it.');
    console.log('  See docs/DEPLOY.md for production posture.');
    console.log('');
  }
  console.log(`  → /         landing + interactive demo`);
  console.log(`  → /agents   protected page (gated)`);
  console.log(`  → /api/data protected JSON (gated)`);
  console.log(`  → /api/peek inspect what an AI sees`);
  console.log('');
}
