// «Будівельні блоки», спільні для багатьох ігор: таймери, голосування, черга ходу, тасування.

// ---------- Фази й таймери ----------

export interface PhaseTimer {
  /** Коли фаза закінчується (мс), null — без обмеження часу */
  endsAt: number | null;
  /** Скільки лишалось, коли поставили паузу */
  pausedRemaining: number | null;
}

export const noTimer = (): PhaseTimer => ({ endsAt: null, pausedRemaining: null });

export function startTimer(now: number, ms: number | null): PhaseTimer {
  return { endsAt: ms === null ? null : now + ms, pausedRemaining: null };
}

export function pauseTimer(t: PhaseTimer, now: number): PhaseTimer {
  if (t.pausedRemaining !== null || t.endsAt === null) return { ...t, pausedRemaining: t.pausedRemaining ?? -1 };
  return { endsAt: null, pausedRemaining: Math.max(0, t.endsAt - now) };
}

export function resumeTimer(t: PhaseTimer, now: number): PhaseTimer {
  if (t.pausedRemaining === null) return t;
  if (t.pausedRemaining < 0) return { endsAt: null, pausedRemaining: null };
  return { endsAt: now + t.pausedRemaining, pausedRemaining: null };
}

export function extendTimer(t: PhaseTimer, ms: number): PhaseTimer {
  if (t.pausedRemaining !== null && t.pausedRemaining >= 0) return { ...t, pausedRemaining: t.pausedRemaining + ms };
  if (t.endsAt !== null) return { ...t, endsAt: t.endsAt + ms };
  return t;
}

export const isPaused = (t: PhaseTimer) => t.pausedRemaining !== null;

/** Залишок часу для показу клієнту */
export function remainingMs(t: PhaseTimer, now: number): number | null {
  if (t.pausedRemaining !== null) return t.pausedRemaining < 0 ? null : t.pausedRemaining;
  if (t.endsAt === null) return null;
  return Math.max(0, t.endsAt - now);
}

// ---------- Голосування ----------

export const SKIP = 'skip';

export interface TallyResult {
  counts: Record<string, number>;
  /** Лідери з максимальною (ненульовою) кількістю голосів */
  leaders: string[];
  skips: number;
}

/** votes: виборець -> кандидат або 'skip'. Голоси за некандидатів ігноруються. */
export function tallyVotes(votes: Record<string, string>, candidates: string[]): TallyResult {
  const counts: Record<string, number> = {};
  for (const c of candidates) counts[c] = 0;
  let skips = 0;
  for (const target of Object.values(votes)) {
    if (target === SKIP) skips++;
    else if (target in counts) counts[target]++;
  }
  const max = Math.max(0, ...Object.values(counts));
  const leaders = max === 0 ? [] : candidates.filter((c) => counts[c] === max);
  return { counts, leaders, skips };
}

// ---------- Черга ходу ----------

/** Черга по колу, починаючи з позиції `offset` (циклічно). */
export function rotateOrder<T>(items: T[], offset: number): T[] {
  if (items.length === 0) return [];
  const k = ((offset % items.length) + items.length) % items.length;
  return [...items.slice(k), ...items.slice(0, k)];
}

// ---------- Таємні ролі ----------

export function shuffle<T>(items: T[], random: () => number): T[] {
  const a = [...items];
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(random() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}

/** Детермінований ГПВЧ для тестів і відтворення партій */
export function seededRandom(seed: number): () => number {
  let s = seed >>> 0;
  return () => {
    s = (s + 0x6d2b79f5) >>> 0;
    let t = s;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
