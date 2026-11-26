import type { FastifyError, FastifyInstance } from 'fastify';
import { ZodError, type ZodType } from 'zod';

export class HttpError extends Error {
  constructor(
    public status: number,
    public code: string,
    message: string,
  ) {
    super(message);
  }
}

export const badRequest = (msg: string, code = 'bad_request') => new HttpError(400, code, msg);
export const unauthorized = (msg = 'Потрібно увійти') => new HttpError(401, 'unauthorized', msg);
export const forbidden = (msg = 'Немає доступу') => new HttpError(403, 'forbidden', msg);
export const notFound = (msg = 'Не знайдено') => new HttpError(404, 'not_found', msg);
export const conflict = (msg: string, code = 'conflict') => new HttpError(409, code, msg);

export function parse<T>(schema: ZodType<T>, data: unknown): T {
  const r = schema.safeParse(data);
  if (!r.success) throw badRequest(r.error.issues[0]?.message ?? 'Некоректні дані', 'validation');
  return r.data;
}

export function registerErrorHandler(app: FastifyInstance) {
  app.setErrorHandler((err: FastifyError | HttpError | ZodError, req, reply) => {
    if (err instanceof HttpError) return reply.status(err.status).send({ error: err.code, message: err.message });
    // Некоректний UUID у шляху або запис зник між перевіркою й оновленням — це 404, а не збій сервера
    const prismaCode = (err as { code?: unknown }).code;
    if (prismaCode === 'P2007' || prismaCode === 'P2023' || prismaCode === 'P2025') {
      return reply.status(404).send({ error: 'not_found', message: 'Не знайдено' });
    }
    if (err instanceof ZodError) return reply.status(400).send({ error: 'validation', message: err.issues[0]?.message });
    const status = (err as FastifyError).statusCode ?? 500;
    if (status === 429) return reply.status(429).send({ error: 'rate_limited', message: 'Забагато спроб. Спробуйте за хвилину.' });
    if (status < 500) return reply.status(status).send({ error: 'bad_request', message: err.message });
    req.log.error(err);
    return reply.status(500).send({ error: 'internal', message: 'Щось пішло не так на сервері' });
  });
}
