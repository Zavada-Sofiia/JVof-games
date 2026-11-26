import type { FastifyInstance } from 'fastify';
import { changePasswordSchema, deleteAccountSchema, updateMeSchema, type MeDto } from '@jvof/shared';
import { prisma } from '../db';
import { generateUniqueFriendCode, hashPassword, verifyPassword } from '../auth/routes';
import { clearRefreshCookie, requireAuth } from '../auth/tokens';
import { badRequest, notFound, parse } from '../lib/errors';
import { userUpdated } from '../realtime/hub';
import { roomManager } from '../rooms/manager';
import { NICKNAME_COOLDOWN_MS, toMe } from './dto';

export async function userRoutes(app: FastifyInstance) {
  // Аватар віддається без авторизації: його вставляють у <img>, а id користувача — випадковий UUID
  app.get<{ Params: { id: string } }>('/users/:id/avatar', async (req, reply) => {
    if (!/^[0-9a-f-]{36}$/i.test(req.params.id)) throw notFound();
    const u = await prisma.user.findUnique({ where: { id: req.params.id }, select: { avatarImage: true } });
    const m = u?.avatarImage?.match(/^data:(image\/(?:png|jpeg|webp));base64,(.+)$/);
    if (!m) throw notFound();
    reply.header('Cache-Control', 'public, max-age=31536000, immutable');
    return reply.type(m[1]).send(Buffer.from(m[2], 'base64'));
  });

  app.register(async (r) => {
    r.addHook('preHandler', requireAuth);

    r.get('/me', async (req): Promise<MeDto> => toMe(await prisma.user.findUniqueOrThrow({ where: { id: req.userId } })));

    r.patch('/me', async (req): Promise<MeDto> => {
      const input = parse(updateMeSchema, req.body);
      const user = await prisma.user.findUniqueOrThrow({ where: { id: req.userId } });
      const data: Record<string, unknown> = {};
      if (input.nickname !== undefined && input.nickname !== user.nickname) {
        const next = (user.nicknameChangedAt?.getTime() ?? 0) + NICKNAME_COOLDOWN_MS;
        if (user.nicknameChangedAt && next > Date.now()) {
          throw badRequest(`Нікнейм можна змінювати раз на 14 днів. Наступна зміна: ${new Date(next).toLocaleDateString('uk-UA')}`, 'nickname_cooldown');
        }
        data.nickname = input.nickname;
        data.nicknameChangedAt = new Date();
      }
      if (input.avatarColor !== undefined) data.avatarColor = input.avatarColor;
      if (input.avatarImage !== undefined) data.avatarImage = input.avatarImage;
      const updated = await prisma.user.update({ where: { id: req.userId }, data });
      userUpdated(req.userId);
      return toMe(updated);
    });

    r.post('/me/password', { config: { rateLimit: { max: 5, timeWindow: '1 minute' } } }, async (req) => {
      const input = parse(changePasswordSchema, req.body);
      const user = await prisma.user.findUniqueOrThrow({ where: { id: req.userId } });
      if (!(await verifyPassword(user.passwordHash, input.currentPassword))) throw badRequest('Поточний пароль невірний', 'wrong_password');
      await prisma.user.update({ where: { id: req.userId }, data: { passwordHash: await hashPassword(input.newPassword) } });
      return { ok: true };
    });

    r.post('/me/friend-code/regenerate', { config: { rateLimit: { max: 5, timeWindow: '1 minute' } } }, async (req): Promise<MeDto> => {
      const updated = await prisma.user.update({ where: { id: req.userId }, data: { friendCode: await generateUniqueFriendCode() } });
      return toMe(updated);
    });

    r.delete('/me', { config: { rateLimit: { max: 5, timeWindow: '1 minute' } } }, async (req, reply) => {
      const { password } = parse(deleteAccountSchema, req.body);
      const user = await prisma.user.findUniqueOrThrow({ where: { id: req.userId } });
      if (!(await verifyPassword(user.passwordHash, password))) throw badRequest('Пароль невірний', 'wrong_password');
      roomManager.removeUserEverywhere(req.userId);
      await prisma.user.delete({ where: { id: req.userId } });
      clearRefreshCookie(reply);
      return { ok: true };
    });
  });
}
