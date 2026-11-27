import 'dotenv/config';

function required(name: string, fallback?: string): string {
  const v = process.env[name] ?? fallback;
  if (!v) throw new Error(`Не задано змінну оточення ${name} (див. apps/server/.env.example)`);
  return v;
}

const isProd = process.env.NODE_ENV === 'production';

export const env = {
  isProd,
  port: Number(process.env.PORT ?? 3001),
  host: process.env.HOST ?? (isProd ? '0.0.0.0' : '127.0.0.1'),
  databaseUrl: required('DATABASE_URL'),
  // На Render адресу сервісу видно в RENDER_EXTERNAL_URL, тож WEB_ORIGIN там можна не задавати
  webOrigin: (process.env.WEB_ORIGIN || process.env.RENDER_EXTERNAL_URL || 'http://localhost:5173').replace(/\/$/, ''),
  jwtSecret: required('JWT_SECRET', isProd ? undefined : 'dev-only-secret-change-me-please-0123456789'),
  /** true, якщо фронтенд і API на різних доменах (тоді cookie SameSite=None; Secure) */
  crossSiteCookies: process.env.COOKIE_CROSS_SITE === 'true',
  resendApiKey: process.env.RESEND_API_KEY || null,
  mailFrom: process.env.MAIL_FROM || 'JVof games <noreply@example.com>',
  /** Cloudflare TURN (безкоштовно 1000 ГБ/міс): Key ID і API-токен з дашборда Cloudflare → Realtime → TURN */
  cfTurn: {
    keyId: process.env.CF_TURN_KEY_ID || null,
    token: process.env.CF_TURN_API_TOKEN || null,
  },
  turn: {
    urls: (process.env.TURN_URLS ?? '').split(',').map((s) => s.trim()).filter(Boolean),
    username: process.env.TURN_USERNAME || undefined,
    credential: process.env.TURN_CREDENTIAL || undefined,
  },
  /** Де лежить зібраний фронтенд (якщо сервер має віддавати його сам) */
  webDist: process.env.WEB_DIST ?? new URL('../../web/dist', import.meta.url).pathname,
};
