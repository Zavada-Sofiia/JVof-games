import { getIO } from './realtime/hub';

/**
 * Безкоштовний Render присипляє сервіс після ~15 хв без вхідних запитів.
 * Щоб увечері (коли грають) сайт відповідав одразу, сервер сам пінгує свою публічну адресу:
 *  - щодня у вікні KEEP_AWAKE_HOURS за Києвом (за замовчуванням 16–1, тобто 16:00–01:00);
 *  - у будь-який час, поки хтось підключений (щоб не обірвати партію).
 * Поза вікном і без гравців сервер спокійно засинає й не витрачає безкоштовні години.
 * Розбудити його о 16:00 допомагає .github/workflows/keepalive.yml.
 */
const INTERVAL_MS = 10 * 60_000;
const TZ = 'Europe/Kyiv';

function parseWindow(raw: string | undefined): [number, number] {
  const m = (raw ?? '16-1').match(/^(\d{1,2})-(\d{1,2})$/);
  return m ? [Number(m[1]) % 24, Number(m[2]) % 24] : [16, 1];
}

export function inWindow(hour: number, [from, to]: [number, number]): boolean {
  return from <= to ? hour >= from && hour < to : hour >= from || hour < to;
}

function kyivHour(): number {
  return Number(new Intl.DateTimeFormat('en-GB', { hour: 'numeric', hourCycle: 'h23', timeZone: TZ }).format(new Date()));
}

export function startKeepAlive() {
  const url = process.env.RENDER_EXTERNAL_URL;
  if (!url || process.env.KEEP_AWAKE_HOURS === 'off') return;
  const window = parseWindow(process.env.KEEP_AWAKE_HOURS);
  setInterval(() => {
    const someoneHere = getIO().engine.clientsCount > 0;
    if (!inWindow(kyivHour(), window) && !someoneHere) return;
    fetch(`${url}/api/health`, { signal: AbortSignal.timeout(15_000) }).catch(() => {});
  }, INTERVAL_MS).unref();
}
