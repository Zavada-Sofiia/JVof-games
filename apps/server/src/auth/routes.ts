import { hash, verify } from '@node-rs/argon2';
import type { FastifyInstance } from 'fastify';
import {
  FRIEND_CODE_LENGTH,
  forgotPasswordSchema,
  loginSchema,
  registerSchema,
  resetPasswordSchema,
  verifyEmailSchema,
  type AuthResponse,
} from '@jvof/shared';
import { Prisma, prisma } from '../db';
import { env } from '../env';
import { randomCode, randomToken, sha256 } from '../lib/crypto';
import { badRequest, conflict, parse, unauthorized } from '../lib/errors';
import { sendMail } from '../lib/mailer';
import { toMe } from '../users/dto';
import {
  clearRefreshCookie,
  issueRefreshToken,
  requireAuth,
  revokeRefreshToken,
  rotateRefreshToken,
  signAccessToken,
} from './tokens';

// Argon2id з помірними параметрами (OWASP: m=19 MiB, t=2, p=1)
const ARGON = { memoryCost: 19456, timeCost: 2, parallelism: 1 };
export const hashPassword = (p: string) => hash(p, ARGON);
export const verifyPassword = (h: string, p: string) => verify(h, p).catch(() => false);
// Хеш-приманка: перевіряємо й тоді, коли користувача немає, щоб час відповіді не видавав, чи існує email
const DUMMY_HASH = hashPassword('dummy-password-for-timing');

const VERIFY_TTL_MS = 7 * 24 * 60 * 60 * 1000;
const RESET_TTL_MS = 60 * 60 * 1000;

export async function generateUniqueFriendCode(): Promise<string> {
  for (let i = 0; i < 10; i++) {
    const code = randomCode(FRIEND_CODE_LENGTH);
    if (!(await prisma.user.findUnique({ where: { friendCode: code }, select: { id: true } }))) return code;
  }
  throw new Error('Не вдалося згенерувати код друга');
}

async function sendVerification(userId: string, email: string) {
  const token = randomToken();
  await prisma.emailToken.create({
    data: { userId, kind: 'verify', tokenHash: sha256(token), expiresAt: new Date(Date.now() + VERIFY_TTL_MS) },
  });
  await sendMail(email, 'Підтвердіть пошту — JVof games', 'Щоб підтвердити пошту, перейдіть за посиланням:', `${env.webOrigin}/verify?token=${token}`);
}

const limit = (max: number) => ({ config: { rateLimit: { max, timeWindow: '1 minute' } } });

export async function authRoutes(app: FastifyInstance) {
  app.post('/auth/register', limit(5), async (req, reply): Promise<AuthResponse> => {
    const input = parse(registerSchema, req.body);
    if (await prisma.user.findUnique({ where: { email: input.email }, select: { id: true } })) {
      throw conflict('Акаунт із таким email уже існує', 'email_taken');
    }
    const user = await prisma.user
      .create({
        data: {
          email: input.email,
          nickname: input.nickname,
          passwordHash: await hashPassword(input.password),
          friendCode: await generateUniqueFriendCode(),
        },
      })
      .catch((e: unknown) => {
        if (e instanceof Prisma.PrismaClientKnownRequestError && e.code === 'P2002') throw conflict('Акаунт із таким email уже існує', 'email_taken');
        throw e;
      });
    sendVerification(user.id, user.email).catch((e) => req.log.error(e));
    await issueRefreshToken(reply, user.id);
    return { accessToken: await signAccessToken(user.id), user: toMe(user) };
  });

  app.post('/auth/login', limit(10), async (req, reply): Promise<AuthResponse> => {
    const input = parse(loginSchema, req.body);
    const user = await prisma.user.findUnique({ where: { email: input.email } });
    const ok = await verifyPassword(user?.passwordHash ?? (await DUMMY_HASH), input.password);
    if (!user || !ok) throw unauthorized('Невірний email або пароль');
    await issueRefreshToken(reply, user.id);
    return { accessToken: await signAccessToken(user.id), user: toMe(user) };
  });

  app.post('/auth/refresh', limit(60), async (req, reply): Promise<AuthResponse> => {
    const userId = await rotateRefreshToken(req, reply);
    const user = await prisma.user.findUnique({ where: { id: userId } });
    if (!user) throw unauthorized();
    return { accessToken: await signAccessToken(user.id), user: toMe(user) };
  });

  app.post('/auth/logout', async (req, reply) => {
    await revokeRefreshToken(req);
    clearRefreshCookie(reply);
    return { ok: true };
  });

  app.post('/auth/password/forgot', limit(3), async (req) => {
    const { email } = parse(forgotPasswordSchema, req.body);
    const user = await prisma.user.findUnique({ where: { email }, select: { id: true, email: true } });
    if (user) {
      const token = randomToken();
      await prisma.emailToken.create({
        data: { userId: user.id, kind: 'reset', tokenHash: sha256(token), expiresAt: new Date(Date.now() + RESET_TTL_MS) },
      });
      await sendMail(
        user.email,
        'Відновлення пароля — JVof games',
        'Щоб задати новий пароль, перейдіть за посиланням (діє 1 годину). Якщо це були не ви, просто проігноруйте лист.',
        `${env.webOrigin}/reset?token=${token}`,
      );
    }
    // Відповідь однакова, щоб не можна було перевіряти, чи зареєстрований email
    return { ok: true };
  });

  app.post('/auth/password/reset', limit(10), async (req) => {
    const { token, password } = parse(resetPasswordSchema, req.body);
    const row = await prisma.emailToken.findUnique({ where: { tokenHash: sha256(token) } });
    if (!row || row.kind !== 'reset' || row.usedAt || row.expiresAt < new Date()) {
      throw badRequest('Посилання недійсне або застаріло. Запросіть нове.', 'invalid_token');
    }
    await prisma.$transaction([
      prisma.user.update({ where: { id: row.userId }, data: { passwordHash: await hashPassword(password) } }),
      prisma.emailToken.update({ where: { id: row.id }, data: { usedAt: new Date() } }),
      prisma.refreshToken.updateMany({ where: { userId: row.userId, revokedAt: null }, data: { revokedAt: new Date() } }),
    ]);
    return { ok: true };
  });

  app.post('/auth/verify', limit(10), async (req) => {
    const { token } = parse(verifyEmailSchema, req.body);
    const row = await prisma.emailToken.findUnique({ where: { tokenHash: sha256(token) } });
    if (!row || row.kind !== 'verify' || row.usedAt || row.expiresAt < new Date()) {
      throw badRequest('Посилання недійсне або застаріло', 'invalid_token');
    }
    await prisma.$transaction([
      prisma.user.update({ where: { id: row.userId }, data: { emailVerified: true } }),
      prisma.emailToken.update({ where: { id: row.id }, data: { usedAt: new Date() } }),
    ]);
    return { ok: true };
  });

  app.post('/auth/verify/resend', { preHandler: requireAuth, ...limit(2) }, async (req) => {
    const user = await prisma.user.findUniqueOrThrow({ where: { id: req.userId } });
    if (user.emailVerified) return { ok: true };
    await sendVerification(user.id, user.email);
    return { ok: true };
  });
}
