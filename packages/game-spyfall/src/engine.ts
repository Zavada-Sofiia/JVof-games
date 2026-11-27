import {
  GameError,
  extendTimer,
  isControlAction,
  isPaused,
  noTimer,
  normalizeBySchema,
  pauseTimer,
  remainingMs,
  resumeTimer,
  shuffle,
  startTimer,
  tallyVotes,
  type ChatAccess,
  type ControlAction,
  type EngineContext,
  type GameEngine,
  type GameEventRecord,
  type GameModule,
  type GameResult,
  type PhaseTimer,
  type Player,
  type SettingsField,
} from '@jvof/game-core';
import type { AudioPolicy } from '@jvof/shared';
import { LOCATIONS, locationById } from './locations';

// ---------- типи ----------

export type SpyPhase = 'ROLE_REVEAL' | 'QUESTIONS' | 'ACCUSATION' | 'FINAL_VOTE' | 'GAME_OVER';
export type SpyTeam = 'spy' | 'locals';

/** Чим закінчилась партія */
export type SpyOutcome =
  | 'spy_caught' // звинувачення: викрили шпигуна
  | 'innocent_convicted' // звинувачення: засудили мешканця
  | 'spy_guessed' // шпигун вгадав локацію
  | 'spy_missed' // шпигун помилився з локацією
  | 'final_caught' // фінальне голосування вказало на шпигуна
  | 'final_missed' // фінальне голосування помилилось або нічия
  | 'stopped';

export interface SpySettings {
  roundMinutes: number;
  /** Чи роздавати мешканцям ролі в локації */
  roles: boolean;
  voteSeconds: number;
  allowSpectators: boolean;
}

export interface SpyPlayer {
  id: string;
  nickname: string;
  seat: number;
  isSpy: boolean;
  /** Роль у локації (для шпигуна null) */
  role: string | null;
  usedAccusation: boolean;
}

export interface SpyState {
  settings: SpySettings;
  players: SpyPlayer[];
  locationId: string;
  /** Локації, з яких обирає шпигун (зараз — усі) */
  locationIds: string[];
  phase: SpyPhase;
  /** Таймер поточної фази */
  timer: PhaseTimer;
  /** Скільки лишалось у раунді, поки йде звинувачення */
  roundRemaining: number | null;
  /** Хто зараз питає і кого питали останнім */
  askerId: string;
  lastQuestion: { from: string; to: string } | null;
  questionCount: number;
  accusation: { accuserId: string; accusedId: string; votes: Record<string, boolean> } | null;
  finalVotes: Record<string, string>;
  winner: SpyTeam | null;
  outcome: SpyOutcome | null;
  /** Кого засудили / яку локацію назвав шпигун */
  outcomeTarget: string | null;
  step: number;
  events: GameEventRecord[];
}

export type SpyAction =
  | { type: 'ask'; target: string }
  | { type: 'accuse'; target: string }
  | { type: 'accuse_vote'; yes: boolean }
  | { type: 'final_vote'; target: string }
  | { type: 'guess'; locationId: string };

export interface SpyPublicState {
  phase: SpyPhase;
  phaseKey: string;
  paused: boolean;
  endsAt: number | null;
  remainingMs: number | null;
  /** Залишок раунду, поки йде звинувачення */
  roundRemainingMs: number | null;
  players: { id: string; nickname: string; seat: number; usedAccusation: boolean; isSpy: boolean | null; role: string | null }[];
  locations: { id: string; title: string; emoji: string }[];
  askerId: string;
  lastQuestion: { from: string; to: string } | null;
  questionCount: number;
  accusation: { accuserId: string; accusedId: string; votedIds: string[] } | null;
  finalVotedIds: string[];
  winner: SpyTeam | null;
  outcome: SpyOutcome | null;
  outcomeTarget: string | null;
  /** Відкривається в кінці */
  location: { id: string; title: string; emoji: string } | null;
  settings: SpySettings;
}

export interface SpyPlayerView {
  isSpy: boolean;
  location: { id: string; title: string; emoji: string } | null;
  role: string | null;
  myAccuseVote: boolean | null;
  myFinalVote: string | null;
}

// ---------- налаштування ----------

export const SPY_MIN_PLAYERS = 3;
export const SPY_MAX_PLAYERS = 12;
const REVEAL_MS = 10_000;

export const spySettingsSchema: SettingsField[] = [
  { key: 'roundMinutes', label: 'Тривалість раунду', type: 'number', default: 8, min: 3, max: 15, unit: 'хв' },
  { key: 'roles', label: 'Ролі в локації', type: 'boolean', default: false, hint: 'Кожен мешканець отримує ще й роль: «Хірург» у лікарні, «Клоун» у цирку' },
  { key: 'voteSeconds', label: 'Час на голосування', type: 'number', default: 30, min: 10, max: 90, step: 5, unit: 'с' },
  { key: 'allowSpectators', label: 'Друзі можуть дивитися як глядачі', type: 'boolean', default: true },
];

export const normalizeSpySettings = (raw: Record<string, unknown>) => normalizeBySchema(spySettingsSchema, raw) as unknown as SpySettings;

// ---------- допоміжне ----------

const pub = (l: { id: string; title: string; emoji: string }) => ({ id: l.id, title: l.title, emoji: l.emoji });
const player = (s: SpyState, id: string | null | undefined) => (id ? s.players.find((p) => p.id === id) : undefined);
const spy = (s: SpyState) => s.players.find((p) => p.isSpy)!;

function log(s: SpyState, ctx: EngineContext, type: string, actorId: string | null, payload: unknown) {
  s.events.push({ seq: s.events.length + 1, phase: s.phase.toLowerCase(), type, actorId, payload, ts: ctx.now });
}

function enter(s: SpyState, phase: SpyPhase, ctx: EngineContext, timer: PhaseTimer) {
  s.phase = phase;
  s.timer = timer;
  s.step++;
  log(s, ctx, 'phase', null, { phase });
}

function finish(s: SpyState, ctx: EngineContext, winner: SpyTeam | null, outcome: SpyOutcome, target: string | null = null) {
  s.winner = winner;
  s.outcome = outcome;
  s.outcomeTarget = target;
  s.phase = 'GAME_OVER';
  s.timer = noTimer();
  s.step++;
  log(s, ctx, 'game_over', null, { winner, outcome, target, locationId: s.locationId, spyId: spy(s).id });
}

function startQuestions(s: SpyState, ctx: EngineContext, ms: number) {
  enter(s, 'QUESTIONS', ctx, startTimer(ctx.now, ms));
}

function startFinalVote(s: SpyState, ctx: EngineContext) {
  s.finalVotes = {};
  enter(s, 'FINAL_VOTE', ctx, startTimer(ctx.now, s.settings.voteSeconds * 1000));
}

function resolveAccusation(s: SpyState, ctx: EngineContext) {
  const a = s.accusation!;
  const voters = s.players.filter((p) => p.id !== a.accusedId);
  const unanimous = voters.every((p) => a.votes[p.id] === true);
  log(s, ctx, 'accusation_result', a.accuserId, { accusedId: a.accusedId, votes: a.votes, unanimous });
  s.accusation = null;
  if (unanimous) {
    const accused = player(s, a.accusedId)!;
    if (accused.isSpy) finish(s, ctx, 'locals', 'spy_caught', accused.id);
    else finish(s, ctx, 'spy', 'innocent_convicted', accused.id);
    return;
  }
  // не одноголосно — раунд триває з того місця, де зупинився
  startQuestions(s, ctx, s.roundRemaining ?? 0);
  s.roundRemaining = null;
}

function resolveFinal(s: SpyState, ctx: EngineContext) {
  const ids = s.players.map((p) => p.id);
  const { leaders, counts } = tallyVotes(s.finalVotes, ids);
  log(s, ctx, 'final_vote_result', null, { votes: s.finalVotes, counts, leaders });
  if (leaders.length === 1 && player(s, leaders[0])!.isSpy) finish(s, ctx, 'locals', 'final_caught', leaders[0]);
  else finish(s, ctx, 'spy', 'final_missed', leaders.length === 1 ? leaders[0] : null);
}

function advance(s: SpyState, ctx: EngineContext) {
  switch (s.phase) {
    case 'ROLE_REVEAL':
      return startQuestions(s, ctx, s.settings.roundMinutes * 60_000);
    case 'QUESTIONS':
      return startFinalVote(s, ctx);
    case 'ACCUSATION':
      return resolveAccusation(s, ctx);
    case 'FINAL_VOTE':
      return resolveFinal(s, ctx);
    case 'GAME_OVER':
      return;
  }
}

// ---------- дії ----------

function handleControl(s: SpyState, a: ControlAction, ctx: EngineContext) {
  if (s.phase === 'GAME_OVER') return;
  switch (a.type) {
    case '@timeout':
      if (isPaused(s.timer) || s.timer.endsAt === null || ctx.now < s.timer.endsAt - 50) return;
      return advance(s, ctx);
    case '@next':
      return advance(s, ctx);
    case '@pause':
      s.timer = pauseTimer(s.timer, ctx.now);
      return;
    case '@resume':
      s.timer = resumeTimer(s.timer, ctx.now);
      return;
    case '@extend':
      s.timer = extendTimer(s.timer, Math.max(0, Math.min(a.ms, 300_000)));
      return;
    case '@stop':
      return finish(s, ctx, null, 'stopped');
    case '@host_left':
      return;
    case '@remove_player': {
      const p = player(s, a.playerId);
      if (!p) return;
      log(s, ctx, 'player_left', p.id, {});
      // без шпигуна грати немає сенсу; без мешканців — теж
      if (p.isSpy) return finish(s, ctx, 'locals', 'spy_caught', p.id);
      s.players = s.players.filter((x) => x.id !== p.id);
      if (s.players.length < 2) return finish(s, ctx, 'spy', 'final_missed');
      if (s.askerId === p.id) s.askerId = s.players[0].id;
      delete s.finalVotes[p.id];
      if (s.accusation) {
        if (s.accusation.accusedId === p.id) {
          s.accusation = null;
          startQuestions(s, ctx, s.roundRemaining ?? 0);
          s.roundRemaining = null;
        } else delete s.accusation.votes[p.id];
      }
      s.step++;
      return;
    }
  }
}

function handlePlayer(s: SpyState, actorId: string, raw: unknown, ctx: EngineContext) {
  const a = raw as SpyAction;
  const me = player(s, actorId);
  if (!me) throw new GameError('Ви не берете участі в цій партії');
  if (s.phase === 'GAME_OVER') throw new GameError('Гру завершено');
  if (isPaused(s.timer)) throw new GameError('Гру поставлено на паузу');

  switch (a?.type) {
    case 'ask': {
      if (s.phase !== 'QUESTIONS') throw new GameError('Зараз не час питань');
      if (s.askerId !== me.id) throw new GameError('Зараз питає інший гравець');
      const t = player(s, a.target);
      if (!t || t.id === me.id) throw new GameError('Оберіть іншого гравця');
      if (s.lastQuestion?.from === t.id && s.lastQuestion.to === me.id && s.players.length > 2) {
        throw new GameError('Не можна одразу питати того, хто щойно питав вас');
      }
      s.lastQuestion = { from: me.id, to: t.id };
      s.askerId = t.id;
      s.questionCount++;
      s.step++;
      log(s, ctx, 'ask', me.id, { target: t.id });
      return;
    }
    case 'accuse': {
      if (s.phase !== 'QUESTIONS') throw new GameError('Звинуватити можна лише під час питань');
      if (me.usedAccusation) throw new GameError('Ви вже використали своє звинувачення');
      const t = player(s, a.target);
      if (!t || t.id === me.id) throw new GameError('Оберіть іншого гравця');
      me.usedAccusation = true;
      s.roundRemaining = remainingMs(s.timer, ctx.now) ?? 0;
      s.accusation = { accuserId: me.id, accusedId: t.id, votes: { [me.id]: true } };
      log(s, ctx, 'accuse', me.id, { target: t.id });
      enter(s, 'ACCUSATION', ctx, startTimer(ctx.now, s.settings.voteSeconds * 1000));
      return;
    }
    case 'accuse_vote': {
      if (s.phase !== 'ACCUSATION' || !s.accusation) throw new GameError('Зараз немає звинувачення');
      if (s.accusation.accusedId === me.id) throw new GameError('Обвинувачений не голосує');
      s.accusation.votes[me.id] = !!a.yes;
      log(s, ctx, 'accuse_vote', me.id, { yes: !!a.yes });
      const voters = s.players.filter((p) => p.id !== s.accusation!.accusedId);
      // будь-яке «ні» або всі проголосували — одразу підсумок
      if (!a.yes || voters.every((p) => s.accusation!.votes[p.id] !== undefined)) resolveAccusation(s, ctx);
      return;
    }
    case 'final_vote': {
      if (s.phase !== 'FINAL_VOTE') throw new GameError('Зараз не фінальне голосування');
      const t = player(s, a.target);
      if (!t || t.id === me.id) throw new GameError('За себе голосувати не можна');
      s.finalVotes[me.id] = t.id;
      log(s, ctx, 'final_vote', me.id, { target: t.id });
      if (s.players.every((p) => s.finalVotes[p.id] !== undefined)) resolveFinal(s, ctx);
      return;
    }
    case 'guess': {
      if (!me.isSpy) throw new GameError('Вгадувати локацію може лише шпигун');
      if (s.phase !== 'QUESTIONS' && s.phase !== 'ROLE_REVEAL') throw new GameError('Під час голосування вгадувати не можна');
      const loc = locationById(String(a.locationId));
      if (!loc || !s.locationIds.includes(loc.id)) throw new GameError('Невідома локація');
      log(s, ctx, 'guess', me.id, { locationId: loc.id });
      if (loc.id === s.locationId) finish(s, ctx, 'spy', 'spy_guessed', loc.id);
      else finish(s, ctx, 'locals', 'spy_missed', loc.id);
      return;
    }
    default:
      throw new GameError('Невідома дія');
  }
}

// ---------- рушій ----------

export const spyfallEngine: GameEngine<SpyState, SpyPublicState, SpyPlayerView> = {
  start(players: Player[], config: unknown, ctx) {
    if (players.length < SPY_MIN_PLAYERS) throw new GameError(`Для Шпигуна потрібно щонайменше ${SPY_MIN_PLAYERS} гравці`);
    if (players.length > SPY_MAX_PLAYERS) throw new GameError(`Для Шпигуна можна не більше ${SPY_MAX_PLAYERS} гравців`);
    const settings = normalizeSpySettings((config ?? {}) as Record<string, unknown>);
    const location = LOCATIONS[Math.floor(ctx.random() * LOCATIONS.length)];
    const seated = [...players].sort((a, b) => a.seat - b.seat);
    const spyIndex = Math.floor(ctx.random() * seated.length);
    const roles = shuffle(location.roles, ctx.random);
    let r = 0;
    const s: SpyState = {
      settings,
      players: seated.map((p, i) => ({
        id: p.id,
        nickname: p.nickname,
        seat: i + 1,
        isSpy: i === spyIndex,
        role: i === spyIndex || !settings.roles ? null : roles[r++ % roles.length],
        usedAccusation: false,
      })),
      locationId: location.id,
      locationIds: LOCATIONS.map((l) => l.id),
      phase: 'ROLE_REVEAL',
      timer: noTimer(),
      roundRemaining: null,
      askerId: seated[Math.floor(ctx.random() * seated.length)].id,
      lastQuestion: null,
      questionCount: 0,
      accusation: null,
      finalVotes: {},
      winner: null,
      outcome: null,
      outcomeTarget: null,
      step: 0,
      events: [],
    };
    log(s, ctx, 'game_started', null, {
      settings,
      locationId: location.id,
      locationIds: s.locationIds,
      players: s.players.map((p) => ({ id: p.id, seat: p.seat, isSpy: p.isSpy, role: p.role })),
    });
    enter(s, 'ROLE_REVEAL', ctx, startTimer(ctx.now, REVEAL_MS));
    return s;
  },

  handleAction(state, actorId, action, ctx) {
    const s = structuredClone(state);
    if (actorId === null) {
      if (!isControlAction(action)) throw new GameError('Невідома службова дія');
      handleControl(s, action, ctx);
    } else {
      if (isControlAction(action)) throw new GameError('Ця дія доступна лише адміну');
      handlePlayer(s, actorId, action, ctx);
    }
    return s;
  },

  getPublicState(s, now) {
    const over = s.phase === 'GAME_OVER';
    const loc = locationById(s.locationId)!;
    return {
      phase: s.phase,
      phaseKey: `${s.phase}`,
      paused: isPaused(s.timer),
      endsAt: s.timer.endsAt,
      remainingMs: remainingMs(s.timer, now),
      roundRemainingMs: s.roundRemaining,
      players: s.players.map((p) => ({
        id: p.id,
        nickname: p.nickname,
        seat: p.seat,
        usedAccusation: p.usedAccusation,
        isSpy: over ? p.isSpy : null,
        role: over ? p.role : null,
      })),
      locations: s.locationIds.map((id) => pub(locationById(id)!)),
      askerId: s.askerId,
      lastQuestion: s.lastQuestion,
      questionCount: s.questionCount,
      accusation: s.accusation
        ? { accuserId: s.accusation.accuserId, accusedId: s.accusation.accusedId, votedIds: Object.keys(s.accusation.votes) }
        : null,
      finalVotedIds: s.phase === 'FINAL_VOTE' ? Object.keys(s.finalVotes) : [],
      winner: s.winner,
      outcome: s.outcome,
      outcomeTarget: s.outcomeTarget,
      location: over ? pub(loc) : null,
      settings: s.settings,
    };
  },

  getPlayerView(s, userId) {
    const me = player(s, userId);
    if (!me) return null;
    const loc = locationById(s.locationId)!;
    return {
      isSpy: me.isSpy,
      location: me.isSpy ? null : pub(loc),
      role: me.role,
      myAccuseVote: s.accusation ? (s.accusation.votes[me.id] ?? null) : null,
      myFinalVote: s.phase === 'FINAL_VOTE' ? (s.finalVotes[me.id] ?? null) : null,
    };
  },

  /** Усі говорять вільно весь час */
  getAudioPolicy(s): AudioPolicy {
    const ids = s.players.map((p) => p.id);
    const hear: Record<string, string[]> = {};
    for (const id of ids) hear[id] = ids.filter((x) => x !== id);
    return {
      speakers: ids,
      hear,
      see: { ...hear },
      observers: { hear: ids, see: ids },
      note: s.phase === 'GAME_OVER' ? 'Гру завершено' : 'Усі говорять вільно',
    };
  },

  getChatAccess(s, userId): ChatAccess {
    return player(s, userId) ? { read: ['main'], write: ['main'] } : { read: ['main'], write: [] };
  },

  getNextDeadline(s) {
    if (s.phase === 'GAME_OVER' || isPaused(s.timer)) return null;
    return s.timer.endsAt;
  },

  isOver: (s) => s.phase === 'GAME_OVER',

  getResult(s): GameResult | null {
    if (s.phase !== 'GAME_OVER') return null;
    return {
      winner: s.winner,
      players: s.players.map((p) => ({
        id: p.id,
        seat: p.seat,
        role: p.isSpy ? 'spy' : 'local',
        team: p.isSpy ? 'spy' : 'locals',
        isAlive: true,
        diedAtPhase: null,
        won: s.winner !== null && (p.isSpy ? s.winner === 'spy' : s.winner === 'locals'),
      })),
    };
  },

  getEvents: (s) => s.events,
  getPhaseKey: (s) => `${s.step}:${s.phase}`,
};

export const spyfallModule: GameModule = {
  id: 'spyfall',
  title: 'Шпигун',
  description: 'Усі знають локацію, крім шпигуна. Питайте одне одного й вичисліть, хто не в темі, — поки шпигун не здогадався, де ви.',
  minPlayers: SPY_MIN_PLAYERS,
  maxPlayers: SPY_MAX_PLAYERS,
  defaultMaxPlayers: 8,
  settingsSchema: spySettingsSchema,
  normalizeSettings: (raw) => normalizeSpySettings(raw) as unknown as Record<string, unknown>,
  hasHumanHost: () => false,
  engine: spyfallEngine,
  clientEntry: 'spyfall',
};
