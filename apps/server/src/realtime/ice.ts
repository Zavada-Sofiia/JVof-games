import type { IceConfigDto } from '@jvof/shared';
import { env } from '../env';

type IceServers = IceConfigDto['iceServers'];

const STUN: IceServers = [{ urls: ['stun:stun.cloudflare.com:3478', 'stun:stun.l.google.com:19302'] }];
const TTL_S = 24 * 60 * 60;
let cache: { servers: IceServers; expires: number } | null = null;

/** Порт 53 браузери блокують — такі TURN-адреси лише гальмують з'єднання */
const usable = (url: string) => !/:53(\?|$)/.test(url);

async function cloudflareTurn(): Promise<IceServers | null> {
  const { keyId, token } = env.cfTurn;
  if (!keyId || !token) return null;
  if (cache && cache.expires > Date.now()) return cache.servers;
  const res = await fetch(`https://rtc.live.cloudflare.com/v1/turn/keys/${encodeURIComponent(keyId)}/credentials/generate-ice-servers`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ ttl: TTL_S }),
    signal: AbortSignal.timeout(8000),
  });
  if (!res.ok) throw new Error(`Cloudflare TURN ${res.status}: ${await res.text().catch(() => '')}`);
  const data = (await res.json()) as { iceServers?: unknown };
  const raw = Array.isArray(data.iceServers) ? data.iceServers : data.iceServers ? [data.iceServers] : [];
  const servers = (raw as { urls: string | string[]; username?: string; credential?: string }[]).map((s) => ({
    ...s,
    urls: (Array.isArray(s.urls) ? s.urls : [s.urls]).filter(usable),
  }));
  // доступи живуть добу, оновлюємо раз на 12 годин
  cache = { servers, expires: Date.now() + (TTL_S / 2) * 1000 };
  return servers;
}

/**
 * STUN допомагає гравцям знайти одне одного, а TURN пересилає відео, коли пряме
 * з'єднання неможливе (мобільний інтернет, суворий NAT, корпоративний Wi-Fi).
 */
export async function getIceServers(): Promise<IceServers> {
  try {
    const cf = await cloudflareTurn();
    if (cf?.length) return cf;
  } catch (e) {
    console.error('Не вдалося отримати TURN від Cloudflare', e);
  }
  const servers = [...STUN];
  if (env.turn.urls.length) servers.push({ urls: env.turn.urls, username: env.turn.username, credential: env.turn.credential });
  return servers;
}

export const hasTurn = () => !!(env.cfTurn.keyId && env.cfTurn.token) || env.turn.urls.length > 0;
