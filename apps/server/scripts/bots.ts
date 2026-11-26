/**
 * Боти для тестування без друзів: заходять у кімнату за кодом і грають випадково.
 *
 *   npm run bots -- ABCD 5          # 5 ботів у кімнату ABCD
 *   npm run bots -- ABCD 5 --start  # і одразу почати гру (якщо бот стане адміном)
 *   npm run bots -- ABCD 4 --from=2 # боти з 2-го (якщо під bot1 ви зайшли самі)
 *
 * Для кімнати «лише для друзів» ботів не пустить — використовуйте приватну кімнату.
 */
import { io, type Socket } from 'socket.io-client';
import type { ClientToServerEvents, RoomStateDto, ServerToClientEvents } from '@jvof/shared';
import type { MafiaPlayerView, MafiaPublicState } from '@jvof/game-mafia';

const API = process.env.API_URL ?? 'http://localhost:3001';
const [codeArg, countArg] = process.argv.slice(2).filter((a) => !a.startsWith('--'));
const autoStart = process.argv.includes('--start');
const fast = process.argv.includes('--fast');
if (!codeArg) {
  console.error('Використання: npm run bots -- <КОД_КІМНАТИ> [кількість] [--start]');
  process.exit(1);
}
const code = codeArg.toUpperCase();
const count = Number(countArg ?? 4);
const from = Math.max(1, Number(process.argv.find((a) => a.startsWith('--from='))?.slice(7) ?? 1)) - 1;
const NAMES = ['Бот Іван', 'Бот Марічка', 'Бот Тарас', 'Бот Оксана', 'Бот Петро', 'Бот Леся', 'Бот Остап', 'Бот Зоряна', 'Бот Богдан', 'Бот Христя', 'Бот Назар', 'Бот Ярина'];

async function api(path: string, body?: unknown, token?: string): Promise<any> {
  const res = await fetch(`${API}/api${path}`, {
    method: body ? 'POST' : 'GET',
    headers: { 'content-type': 'application/json', ...(token ? { authorization: `Bearer ${token}` } : {}) },
    body: body ? JSON.stringify(body) : undefined,
  });
  const data: any = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(`${path}: ${data.message ?? res.status}`);
  return data;
}

async function login(i: number): Promise<{ token: string; id: string }> {
  for (let attempt = 0; ; attempt++) {
    try {
      return await loginOnce(i);
    } catch (e) {
      if (attempt >= 3 || !String(e).includes('Забагато')) throw e;
      console.log('⏳ Сервер обмежує частоту входів, чекаю хвилину...');
      await new Promise((r) => setTimeout(r, 61_000));
    }
  }
}

async function loginOnce(i: number): Promise<{ token: string; id: string }> {
  const email = `bot${i + 1}@bots.local`;
  const password = 'bot-password-123';
  try {
    const r = await api('/auth/login', { email, password });
    return { token: r.accessToken, id: r.user.id };
  } catch {
    const r = await api('/auth/register', { email, password, nickname: NAMES[i % NAMES.length] });
    return { token: r.accessToken, id: r.user.id };
  }
}

const pick = <T>(xs: T[]): T | undefined => xs[Math.floor(Math.random() * xs.length)];
const delay = (ms: number) => new Promise((r) => setTimeout(r, fast ? Math.min(ms, 30) : ms));

let startedOnce = false;

function runBot(name: string, token: string, id: string) {
  const s: Socket<ServerToClientEvents, ClientToServerEvents> = io(API, { auth: { token }, transports: ['websocket'] });
  let state: RoomStateDto | null = null;
  let view: MafiaPlayerView | null = null;
  let acted = '';

  const act = (action: unknown) => s.emit('game:action', { action }, (r) => !r.ok && console.log(`  ${name}: ${r.error}`));

  async function think() {
    const g = state?.game?.publicState as MafiaPublicState | undefined;
    const v = view;
    if (!g || !v || (!v.me?.alive && !(g.phase === 'EXECUTION' && g.execution?.targetId === id))) return;
    const key = `${g.phaseKey}:${g.phase}:${g.speakerId}:${g.voting?.round}`;
    if (acted === key) return;
    const others = g.players.filter((p) => p.alive && p.id !== id).map((p) => p.id);
    const mine = (g.phase === 'DAY_DISCUSSION' && g.speakerId === id) || (g.phase === 'EXECUTION' && g.execution?.targetId === id && g.execution.speech);
    if (g.phase === 'NIGHT') {
      if (!v.night) return; // приватний стан ще не прийшов
      acted = key;
      await delay(1500 + Math.random() * 3000);
      const mates = new Set(v.teammates.map((t) => t.id));
      if (v.night.canKill) act({ type: 'night', kind: 'kill', target: pick(others.filter((o) => !mates.has(o))) });
      if (v.night.check) act({ type: 'night', kind: 'check', target: pick(others) });
      if (v.night.canHeal) act({ type: 'night', kind: 'heal', target: pick(v.night.cannotHealSelf ? others : [...others, id]) });
    } else if (mine) {
      acted = key;
      await delay(2500);
      act({ type: 'end_speech' });
    } else if (g.phase === 'VOTING') {
      acted = key;
      await delay(1000 + Math.random() * 3000);
      act({ type: 'vote', target: Math.random() < 0.15 ? 'skip' : pick(g.voting!.candidates.filter((c) => c !== id)) });
    }
  }

  s.on('connect', () => {
    s.emit('room:join', { code }, (r) => {
      if (!r.ok) return console.log(`✖ ${name}: ${r.error}`);
      console.log(`✔ ${name} у кімнаті ${code}`);
      s.emit('room:ready', { ready: true });
    });
  });
  s.on('connect_error', (e) => console.log(`✖ ${name}: ${e.message}`));
  s.on('room:state', (st) => {
    state = st;
    if (autoStart && !startedOnce && st.adminId === id && st.status === 'lobby' && st.members.filter((m) => m.role === 'player' && m.connected).length >= count) {
      startedOnce = true;
      setTimeout(() => s.emit('admin:start', (r) => console.log(r.ok ? `▶ ${name} почав гру` : `✖ старт: ${r.error}`)), 500);
    }
    const g = st.game?.publicState as MafiaPublicState | undefined;
    if (g?.phase === 'GAME_OVER' && st.adminId === id) console.log(`🏁 Кінець гри: ${g.aborted ? 'зупинено' : g.winner === 'mafia' ? 'перемогла мафія' : 'перемогли мирні'}`);
    void think();
  });
  s.on('player:view', (v) => {
    view = v as MafiaPlayerView;
    void think();
  });
  s.on('room:kicked', () => {
    console.log(`👋 ${name} вигнали`);
    s.close();
  });
  return s;
}

const bots: { token: string; id: string }[] = [];
for (let i = from; i < from + count; i++) bots.push(await login(i));
bots.forEach((b, i) => runBot(NAMES[(i + from) % NAMES.length], b.token, b.id));
console.log(`Боти запущені (${count}). Ctrl+C — вийти.`);
process.on('SIGINT', () => process.exit(0));
