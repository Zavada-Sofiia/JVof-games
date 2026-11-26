import type { FastifyInstance } from 'fastify';
import {
  FRIEND_CODE_LENGTH,
  blockSchema,
  friendRequestSchema,
  isValidCode,
  normalizeCode,
  type BlockDto,
  type FriendDto,
  type FriendRequestDto,
} from '@jvof/shared';
import { prisma } from '../db';
import { requireAuth } from '../auth/tokens';
import { badRequest, conflict, forbidden, notFound, parse } from '../lib/errors';
import { emitToUser } from '../realtime/hub';
import { presence } from '../realtime/presence';
import { publicUserSelect, toPublicUser } from '../users/dto';
import { hasBlocked, orderPair } from './service';

async function makeFriends(a: string, b: string) {
  const [userA, userB] = orderPair(a, b);
  await prisma.friendship.upsert({ where: { userA_userB: { userA, userB } }, create: { userA, userB }, update: {} });
}

async function requestDto(id: string, viewerId: string): Promise<FriendRequestDto> {
  const r = await prisma.friendRequest.findUniqueOrThrow({
    where: { id },
    include: { from: { select: publicUserSelect }, to: { select: publicUserSelect } },
  });
  const incoming = r.toUser === viewerId;
  return { id: r.id, direction: incoming ? 'incoming' : 'outgoing', user: toPublicUser(incoming ? r.from : r.to), createdAt: r.createdAt.toISOString() };
}

export async function friendRoutes(app: FastifyInstance) {
  app.addHook('preHandler', requireAuth);

  app.get('/friends', async (req): Promise<FriendDto[]> => {
    const me = req.userId;
    const rows = await prisma.friendship.findMany({
      where: { OR: [{ userA: me }, { userB: me }] },
      include: { a: { select: publicUserSelect }, b: { select: publicUserSelect } },
    });
    const list = rows.map((r) => {
      const u = r.userA === me ? r.b : r.a;
      return { ...toPublicUser(u), ...presence.get(u.id), since: r.createdAt.toISOString() };
    });
    const rank = { in_game: 0, in_room: 1, online: 2, offline: 3 } as const;
    return list.sort((x, y) => rank[x.status] - rank[y.status] || x.nickname.localeCompare(y.nickname, 'uk'));
  });

  app.get('/friends/requests', async (req): Promise<FriendRequestDto[]> => {
    const me = req.userId;
    const rows = await prisma.friendRequest.findMany({
      where: { status: 'pending', OR: [{ toUser: me }, { fromUser: me }] },
      include: { from: { select: publicUserSelect }, to: { select: publicUserSelect } },
      orderBy: { createdAt: 'desc' },
    });
    return rows.map((r) => {
      const incoming = r.toUser === me;
      return { id: r.id, direction: incoming ? 'incoming' : 'outgoing', user: toPublicUser(incoming ? r.from : r.to), createdAt: r.createdAt.toISOString() };
    });
  });

  // Обмеження частоти: 10 спроб на хвилину, щоб код не підбирали перебором
  app.post('/friends/requests', { config: { rateLimit: { max: 10, timeWindow: '1 minute' } } }, async (req) => {
    const me = req.userId;
    const code = normalizeCode(parse(friendRequestSchema, req.body).code);
    if (!isValidCode(code, FRIEND_CODE_LENGTH)) throw badRequest('Код друга складається з 8 символів, наприклад K7M2-9QXP', 'bad_code');
    const target = await prisma.user.findUnique({ where: { friendCode: code }, select: { id: true } });
    if (!target) throw notFound('Користувача з таким кодом не знайдено');
    if (target.id === me) throw badRequest('Це ваш власний код', 'self');
    if (await hasBlocked(me, target.id)) throw forbidden('Ви заблокували цього користувача. Спершу розблокуйте його в профілі.');
    if (await hasBlocked(target.id, me)) throw notFound('Користувача з таким кодом не знайдено');
    const [userA, userB] = orderPair(me, target.id);
    if (await prisma.friendship.findUnique({ where: { userA_userB: { userA, userB } } })) throw conflict('Ви вже друзі', 'already_friends');

    // Якщо ця людина вже надіслала запит нам — просто приймаємо його
    const reverse = await prisma.friendRequest.findUnique({ where: { fromUser_toUser: { fromUser: target.id, toUser: me } } });
    if (reverse?.status === 'pending') {
      await prisma.friendRequest.update({ where: { id: reverse.id }, data: { status: 'accepted' } });
      await makeFriends(me, target.id);
      emitToUser(target.id, 'friend:changed');
      emitToUser(me, 'friend:changed');
      return { ok: true, status: 'accepted' };
    }

    const existing = await prisma.friendRequest.findUnique({ where: { fromUser_toUser: { fromUser: me, toUser: target.id } } });
    if (existing?.status === 'pending') throw conflict('Запит уже надіслано, чекаємо відповіді', 'duplicate');
    const request = existing
      ? await prisma.friendRequest.update({ where: { id: existing.id }, data: { status: 'pending', createdAt: new Date() } })
      : await prisma.friendRequest.create({ data: { fromUser: me, toUser: target.id } });
    emitToUser(target.id, 'friend:request', await requestDto(request.id, target.id));
    return { ok: true, status: 'pending' };
  });

  app.post<{ Params: { id: string } }>('/friends/requests/:id/accept', async (req) => {
    const r = await prisma.friendRequest.findUnique({ where: { id: req.params.id } });
    if (!r || r.toUser !== req.userId || r.status !== 'pending') throw notFound('Запит не знайдено');
    await prisma.friendRequest.update({ where: { id: r.id }, data: { status: 'accepted' } });
    await makeFriends(r.fromUser, r.toUser);
    emitToUser(r.fromUser, 'friend:changed');
    emitToUser(r.toUser, 'friend:changed');
    return { ok: true };
  });

  app.post<{ Params: { id: string } }>('/friends/requests/:id/decline', async (req) => {
    const r = await prisma.friendRequest.findUnique({ where: { id: req.params.id } });
    if (!r || r.toUser !== req.userId || r.status !== 'pending') throw notFound('Запит не знайдено');
    await prisma.friendRequest.update({ where: { id: r.id }, data: { status: 'declined' } });
    emitToUser(r.fromUser, 'friend:changed');
    return { ok: true };
  });

  // Скасувати свій вихідний запит
  app.delete<{ Params: { id: string } }>('/friends/requests/:id', async (req) => {
    const r = await prisma.friendRequest.findUnique({ where: { id: req.params.id } });
    if (!r || r.fromUser !== req.userId || r.status !== 'pending') throw notFound('Запит не знайдено');
    await prisma.friendRequest.delete({ where: { id: r.id } });
    emitToUser(r.toUser, 'friend:changed');
    return { ok: true };
  });

  app.delete<{ Params: { id: string } }>('/friends/:id', async (req) => {
    const other = req.params.id;
    const [userA, userB] = orderPair(req.userId, other);
    await prisma.$transaction([
      prisma.friendship.deleteMany({ where: { userA, userB } }),
      prisma.friendRequest.deleteMany({
        where: { OR: [{ fromUser: req.userId, toUser: other }, { fromUser: other, toUser: req.userId }] },
      }),
    ]);
    emitToUser(other, 'friend:changed');
    emitToUser(req.userId, 'friend:changed');
    return { ok: true };
  });

  // ---------- Блокування ----------

  app.get('/blocks', async (req): Promise<BlockDto[]> => {
    const rows = await prisma.block.findMany({
      where: { blockerId: req.userId },
      include: { blocked: { select: publicUserSelect } },
      orderBy: { createdAt: 'desc' },
    });
    return rows.map((b) => ({ user: toPublicUser(b.blocked), createdAt: b.createdAt.toISOString() }));
  });

  app.post('/blocks', async (req) => {
    const { userId } = parse(blockSchema, req.body);
    if (userId === req.userId) throw badRequest('Не можна заблокувати себе');
    if (!(await prisma.user.findUnique({ where: { id: userId }, select: { id: true } }))) throw notFound('Користувача не знайдено');
    const [userA, userB] = orderPair(req.userId, userId);
    // Блокування прибирає дружбу та всі запити між двома людьми
    await prisma.$transaction([
      prisma.block.upsert({
        where: { blockerId_blockedId: { blockerId: req.userId, blockedId: userId } },
        create: { blockerId: req.userId, blockedId: userId },
        update: {},
      }),
      prisma.friendship.deleteMany({ where: { userA, userB } }),
      prisma.friendRequest.deleteMany({
        where: { OR: [{ fromUser: req.userId, toUser: userId }, { fromUser: userId, toUser: req.userId }] },
      }),
    ]);
    emitToUser(userId, 'friend:changed');
    emitToUser(req.userId, 'friend:changed');
    return { ok: true };
  });

  app.delete<{ Params: { id: string } }>('/blocks/:id', async (req) => {
    await prisma.block.deleteMany({ where: { blockerId: req.userId, blockedId: req.params.id } });
    return { ok: true };
  });
}
