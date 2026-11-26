import { buildApp } from './app';
import { prisma } from './db';
import { env } from './env';
import { startKeepAlive } from './keepalive';
import { createIO } from './realtime/io';
import { roomManager } from './rooms/manager';

const app = await buildApp();
createIO(app.server);
roomManager.start();
startKeepAlive();

// Після перезапуску партій у пам'яті вже немає: кімнати повертаються в лобі
await prisma.room.updateMany({ where: { status: 'playing' }, data: { status: 'open' } });

await app.listen({ port: env.port, host: env.host });
console.log(`🎲 JVof games server: http://${env.host}:${env.port}`);

async function shutdown() {
  roomManager.stop();
  await app.close();
  await prisma.$disconnect();
  process.exit(0);
}
process.on('SIGINT', shutdown);
process.on('SIGTERM', shutdown);
