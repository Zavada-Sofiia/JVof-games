import { existsSync } from 'node:fs';
import cookie from '@fastify/cookie';
import cors from '@fastify/cors';
import rateLimit from '@fastify/rate-limit';
import fastifyStatic from '@fastify/static';
import Fastify from 'fastify';
import { authRoutes } from './auth/routes';
import { env } from './env';
import { friendRoutes } from './friends/routes';
import { gameRoutes } from './games/routes';
import { registerErrorHandler } from './lib/errors';
import { roomRoutes } from './rooms/routes';
import { userRoutes } from './users/routes';

export async function buildApp() {
  const app = Fastify({
    logger: { level: env.isProd ? 'info' : 'warn' },
    bodyLimit: 200 * 1024,
    trustProxy: true,
  });
  registerErrorHandler(app);
  await app.register(cors, { origin: env.webOrigin, credentials: true });
  await app.register(cookie);
  await app.register(rateLimit, { global: false });

  await app.register(
    async (api) => {
      api.get('/health', async () => ({ ok: true }));
      await api.register(authRoutes);
      await api.register(userRoutes);
      await api.register(friendRoutes);
      await api.register(roomRoutes);
      await api.register(gameRoutes);
    },
    { prefix: '/api' },
  );

  // У продакшені сервер сам віддає зібраний фронтенд (один безкоштовний сервіс замість двох)
  if (existsSync(env.webDist)) {
    await app.register(fastifyStatic, { root: env.webDist, wildcard: false });
    app.setNotFoundHandler((req, reply) => {
      if (req.method === 'GET' && !req.url.startsWith('/api') && !req.url.startsWith('/socket.io')) return reply.sendFile('index.html');
      return reply.status(404).send({ error: 'not_found', message: 'Не знайдено' });
    });
  }
  return app;
}
