import type { FastifyInstance } from 'fastify';
import type { GameDetailDto, GameSummaryDto, StatsDto } from '@jvof/shared';
import { prisma } from '../db';
import { requireAuth } from '../auth/tokens';
import { notFound } from '../lib/errors';
import { publicUserSelect, toPublicUser } from '../users/dto';
import { gameTitle } from './registry';

export async function gameRoutes(app: FastifyInstance) {
  app.addHook('preHandler', requireAuth);

  app.get('/me/games', async (req): Promise<GameSummaryDto[]> => {
    const rows = await prisma.gamePlayer.findMany({
      where: { userId: req.userId },
      include: { game: { include: { _count: { select: { players: true } } } } },
      orderBy: { game: { startedAt: 'desc' } },
      take: 50,
    });
    return rows.map((r) => ({
      id: r.game.id,
      gameType: r.game.gameType,
      gameTitle: gameTitle(r.game.gameType),
      startedAt: r.game.startedAt.toISOString(),
      endedAt: r.game.endedAt?.toISOString() ?? null,
      winner: r.game.winner,
      myRole: r.role,
      myTeam: r.team,
      won: r.won,
      playerCount: r.game._count.players,
    }));
  });

  app.get('/me/stats', async (req): Promise<StatsDto> => {
    const rows = await prisma.gamePlayer.findMany({
      where: { userId: req.userId, game: { winner: { not: null } } },
      select: { role: true, won: true, game: { select: { gameType: true } } },
    });
    const byRole = new Map<string, { games: number; wins: number }>();
    const byGame = new Map<string, { games: number; wins: number }>();
    for (const r of rows) {
      for (const [map, key] of [
        [byRole, r.role],
        [byGame, r.game.gameType],
      ] as const) {
        const v = map.get(key) ?? { games: 0, wins: 0 };
        v.games++;
        if (r.won) v.wins++;
        map.set(key, v);
      }
    }
    return {
      total: rows.length,
      wins: rows.filter((r) => r.won).length,
      byRole: [...byRole].map(([role, v]) => ({ role, ...v })),
      byGame: [...byGame].map(([gameType, v]) => ({ gameType, gameTitle: gameTitle(gameType), ...v })),
    };
  });

  // Розбір партії бачать лише її учасники (та ведучий)
  app.get<{ Params: { id: string } }>('/games/:id', async (req): Promise<GameDetailDto> => {
    if (!/^[0-9a-f-]{36}$/i.test(req.params.id)) throw notFound('Партію не знайдено');
    const g = await prisma.game.findUnique({
      where: { id: req.params.id },
      include: { players: { include: { user: { select: publicUserSelect } }, orderBy: { seat: 'asc' } }, events: { orderBy: { seq: 'asc' } } },
    });
    const hostId = (g?.configJson as { hostId?: string } | undefined)?.hostId;
    if (!g || (!g.players.some((p) => p.userId === req.userId) && hostId !== req.userId)) throw notFound('Партію не знайдено');
    return {
      id: g.id,
      gameType: g.gameType,
      gameTitle: gameTitle(g.gameType),
      startedAt: g.startedAt.toISOString(),
      endedAt: g.endedAt?.toISOString() ?? null,
      winner: g.winner,
      players: g.players.map((p) => ({
        user: toPublicUser(p.user),
        seat: p.seat,
        role: p.role,
        team: p.team,
        isAlive: p.isAlive,
        diedAtPhase: p.diedAtPhase,
        won: p.won,
      })),
      events: g.events.map((e) => ({ seq: e.seq, phase: e.phase, type: e.type, actorId: e.actorId, payload: e.payloadJson, ts: e.ts.toISOString() })),
    };
  });
}
