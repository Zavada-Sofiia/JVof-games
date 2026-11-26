import { SignJWT, jwtVerify } from 'jose';
import type { FastifyReply, FastifyRequest } from 'fastify';
import { prisma } from '../db';
import { env } from '../env';
import { randomToken, sha256 } from '../lib/crypto';
import { unauthorized } from '../lib/errors';

const secret = new TextEncoder().encode(env.jwtSecret);
const ACCESS_TTL = '15m';
const REFRESH_TTL_MS = 30 * 24 * 60 * 60 * 1000;
export const REFRESH_COOKIE = 'jvof_rt';

export async function signAccessToken(userId: string): Promise<string> {
  return new SignJWT({}).setProtectedHeader({ alg: 'HS256' }).setSubject(userId).setIssuedAt().setExpirationTime(ACCESS_TTL).sign(secret);
}

export async function verifyAccessToken(token: string): Promise<string> {
  try {
    const { payload } = await jwtVerify(token, secret, { algorithms: ['HS256'] });
    if (!payload.sub) throw new Error('no sub');
    return payload.sub;
  } catch {
    throw unauthorized('Сесія завершилась, увійдіть знову');
  }
}

function cookieOptions() {
  return {
    httpOnly: true,
    secure: env.isProd || env.crossSiteCookies,
    sameSite: env.crossSiteCookies ? ('none' as const) : ('lax' as const),
    path: '/api/auth',
  };
}

/** Видає новий refresh-токен (у БД лише хеш) і кладе його в httpOnly-cookie */
export async function issueRefreshToken(reply: FastifyReply, userId: string): Promise<void> {
  const token = randomToken();
  const expiresAt = new Date(Date.now() + REFRESH_TTL_MS);
  await prisma.refreshToken.create({ data: { userId, tokenHash: sha256(token), expiresAt } });
  reply.setCookie(REFRESH_COOKIE, token, { ...cookieOptions(), expires: expiresAt });
}

export function clearRefreshCookie(reply: FastifyReply) {
  reply.clearCookie(REFRESH_COOKIE, cookieOptions());
}

/**
 * Ротація: старий токен відкликається, видається новий.
 * Якщо хтось пред'явив уже відкликаний токен — його, ймовірно, вкрали: відкликаємо всі сесії користувача.
 */
export async function rotateRefreshToken(req: FastifyRequest, reply: FastifyReply): Promise<string> {
  const token = req.cookies[REFRESH_COOKIE];
  if (!token) throw unauthorized();
  const row = await prisma.refreshToken.findUnique({ where: { tokenHash: sha256(token) } });
  if (!row) throw unauthorized();
  if (row.revokedAt) {
    await prisma.refreshToken.updateMany({ where: { userId: row.userId, revokedAt: null }, data: { revokedAt: new Date() } });
    clearRefreshCookie(reply);
    throw unauthorized();
  }
  if (row.expiresAt < new Date()) throw unauthorized();
  await prisma.refreshToken.update({ where: { id: row.id }, data: { revokedAt: new Date() } });
  await issueRefreshToken(reply, row.userId);
  return row.userId;
}

export async function revokeRefreshToken(req: FastifyRequest): Promise<void> {
  const token = req.cookies[REFRESH_COOKIE];
  if (token) await prisma.refreshToken.updateMany({ where: { tokenHash: sha256(token), revokedAt: null }, data: { revokedAt: new Date() } });
}

declare module 'fastify' {
  interface FastifyRequest {
    userId: string;
  }
}

/** preHandler: перевіряє Bearer access-токен */
export async function requireAuth(req: FastifyRequest): Promise<void> {
  const h = req.headers.authorization;
  if (!h?.startsWith('Bearer ')) throw unauthorized();
  req.userId = await verifyAccessToken(h.slice(7));
}
