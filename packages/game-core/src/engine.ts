import type { AudioPolicy } from '@jvof/shared';

export interface EngineContext {
  /** Поточний час сервера, мс */
  now: number;
  /** Джерело випадковості (у тестах підміняється детермінованим) */
  random: () => number;
}

export interface Player {
  id: string;
  nickname: string;
  seat: number;
}

/**
 * Службові дії, які надсилає не гравець, а сервер (таймер) або адмін.
 * Права адміна перевіряє сервер кімнати ще до виклику рушія.
 */
export type ControlAction =
  | { type: '@timeout' }
  | { type: '@next' }
  | { type: '@pause' }
  | { type: '@resume' }
  | { type: '@extend'; ms: number }
  | { type: '@stop' }
  | { type: '@remove_player'; playerId: string }
  | { type: '@host_left' };

export function isControlAction(a: unknown): a is ControlAction {
  return typeof a === 'object' && a !== null && typeof (a as { type?: unknown }).type === 'string' && (a as { type: string }).type.startsWith('@');
}

/** Запис журналу подій партії (game_events) */
export interface GameEventRecord {
  seq: number;
  phase: string;
  type: string;
  actorId: string | null;
  payload: unknown;
  ts: number;
}

export interface GameResult {
  /** Ідентифікатор команди-переможця, або null якщо партію зупинено */
  winner: string | null;
  players: {
    id: string;
    seat: number;
    role: string;
    team: string;
    isAlive: boolean;
    diedAtPhase: string | null;
    won: boolean;
  }[];
}

export interface ChatAccess {
  read: string[];
  write: string[];
}

export class GameError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'GameError';
  }
}

/**
 * Інтерфейс ігрового рушія. Усі функції чисті: отримують стан і повертають новий.
 * Мережі, бази й таймерів тут немає, тож рушій можна протестувати без браузера.
 */
export interface GameEngine<State = unknown, PublicState = unknown, View = unknown> {
  start(players: Player[], config: unknown, ctx: EngineContext & { hostId: string | null }): State;
  /** actorId = null для службових дій (ControlAction). Кидає GameError, якщо дія недоступна. */
  handleAction(state: State, actorId: string | null, action: unknown, ctx: EngineContext): State;
  getPublicState(state: State, now: number): PublicState;
  getPlayerView(state: State, userId: string): View | null;
  getAudioPolicy(state: State): AudioPolicy;
  getChatAccess(state: State, userId: string): ChatAccess;
  /** Коли серверу надіслати '@timeout' (мс), або null */
  getNextDeadline(state: State): number | null;
  isOver(state: State): boolean;
  getResult(state: State): GameResult | null;
  getEvents(state: State): GameEventRecord[];
  /** Ключ «моменту гри»: коли він змінюється, клієнт програє звук зміни фази */
  getPhaseKey(state: State): string;
}

// ---------- Опис налаштувань (форма при створенні кімнати) ----------

export type SettingsField =
  | { key: string; label: string; type: 'boolean'; default: boolean; hint?: string }
  | { key: string; label: string; type: 'number'; default: number; min: number; max: number; step?: number; unit?: string; hint?: string }
  | { key: string; label: string; type: 'select'; default: string; options: { value: string; label: string }[]; hint?: string };

export interface GameModule {
  id: string;
  title: string;
  description: string;
  minPlayers: number;
  maxPlayers: number;
  defaultMaxPlayers: number;
  settingsSchema: SettingsField[];
  /** Привести довільні налаштування до коректних (невідомі ключі відкидаються) */
  normalizeSettings(raw: Record<string, unknown>): Record<string, unknown>;
  /** Чи веде гру людина-ведучий (тоді адмін не грає, а веде) */
  hasHumanHost(settings: Record<string, unknown>): boolean;
  engine: GameEngine<any, any, any>;
  /** Який екран гри відкривати на клієнті */
  clientEntry: string;
}

/** Застосувати значення за замовчуванням і межі зі схеми налаштувань. */
export function normalizeBySchema(schema: SettingsField[], raw: Record<string, unknown>): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const f of schema) {
    const v = raw[f.key];
    if (f.type === 'boolean') out[f.key] = typeof v === 'boolean' ? v : f.default;
    else if (f.type === 'number') {
      const n = typeof v === 'number' && Number.isFinite(v) ? v : f.default;
      out[f.key] = Math.min(f.max, Math.max(f.min, Math.round(n)));
    } else out[f.key] = typeof v === 'string' && f.options.some((o) => o.value === v) ? v : f.default;
  }
  return out;
}
