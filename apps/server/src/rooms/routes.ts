import type { FastifyInstance } from 'fastify';
import { createRoomSchema, inviteSchema, type IceConfigDto, type PublicRoomDto, type RoomInfoDto } from '@jvof/shared';
import { prisma } from '../db';
import { getIceServers } from '../realtime/ice';
import { requireAuth } from '../auth/tokens';
import { forbidden, parse } from '../lib/errors';
import { emitToUser } from '../realtime/hub';
import { publicUserSelect, toPublicUser } from '../users/dto';
import { roomManager } from './manager';

type CodeParams = { Params: { code: string } };

export async function roomRoutes(app: FastifyInstance) {
  app.addHook('preHandler', requireAuth);

  app.post('/rooms', { config: { rateLimit: { max: 10, timeWindow: '1 minute' } } }, async (req) => {
    const input = parse(createRoomSchema, req.body);
    const code = await roomManager.create(req.userId, input);
    await roomManager.join(code, req.userId);
    return { code };
  });

  app.get('/rooms/public', async (req): Promise<PublicRoomDto[]> => roomManager.publicRooms(req.userId));

  app.get<CodeParams>('/rooms/:code', async (req): Promise<RoomInfoDto> => roomManager.info(req.params.code.toUpperCase(), req.userId));

  app.post<CodeParams>('/rooms/:code/join', async (req) => roomManager.join(req.params.code.toUpperCase(), req.userId));

  app.post<CodeParams>('/rooms/:code/invite', { config: { rateLimit: { max: 30, timeWindow: '1 minute' } } }, async (req) => {
    const { friendId } = parse(inviteSchema, req.body);
    const room = await roomManager.invite(req.params.code.toUpperCase(), req.userId, friendId);
    const me = await prisma.user.findUniqueOrThrow({ where: { id: req.userId }, select: publicUserSelect });
    emitToUser(friendId, 'room:invite', { from: toPublicUser(me), code: room.code, gameTitle: room.module.title });
    return { ok: true };
  });

  // Налаштування STUN/TURN видаються лише учасникам кімнати
  app.get<CodeParams>('/rooms/:code/ice-config', async (req): Promise<IceConfigDto> => {
    if (!roomManager.isMember(req.params.code.toUpperCase(), req.userId)) throw forbidden('Ви не в цій кімнаті');
    return { iceServers: await getIceServers() };
  });
}
