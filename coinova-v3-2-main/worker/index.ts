import { Hono } from 'hono';
import { cors } from 'hono/cors';
import { CloudflareEnv } from './types';
import { ensureD1Schema } from './db';
import { registerAuthAndAdminRoutes } from './routes/authAndAdmin';
import { registerGameAndUgcRoutes } from './routes/gameAndUgc';

const app = new Hono<{ Bindings: CloudflareEnv }>();

app.use(
  '/api/*',
  cors({
    origin: (origin, c) => {
      const configured = c.env?.CORS_ORIGIN;
      if (configured && configured !== '*') return configured;
      return origin || '*';
    },
    allowMethods: ['GET', 'POST', 'PUT', 'DELETE', 'OPTIONS'],
    allowHeaders: ['Content-Type', 'Authorization'],
    credentials: true,
  })
);

app.get('/api/health', async (c) => {
  await ensureD1Schema(c.env.DB);
  return c.json({
    ok: true,
    service: 'coinova-cloudflare-worker-d1',
    runtime: 'cloudflare-workers',
    database: 'cloudflare-d1',
    timestamp: new Date().toISOString(),
  });
});

registerAuthAndAdminRoutes(app);
registerGameAndUgcRoutes(app);

export default app;
