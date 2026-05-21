// Example: Next.js middleware integration.
// Place this file at the root of your Next.js project as `middleware.ts`.
// Set the runtime to 'nodejs' so node:crypto is available.

import createStileNext from '../../lib/adapters/next';

export const config = {
  matcher: ['/agents/:path*', '/api/data/:path*'],
  runtime: 'nodejs',
};

export default createStileNext({
  secret: process.env.STILE_SECRET || 'dev-secret',
  protect: ['/agents', '/api/data'],
  tier: 'easy',
});
