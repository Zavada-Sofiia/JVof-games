import {
  GameError,
  SKIP,
  extendTimer,
  isControlAction,
  isPaused,
  noTimer,
  pauseTimer,
  remainingMs,
  resumeTimer,
  rotateOrder,
  shuffle,
  startTimer,
  tallyVotes,
  type ChatAccess,
  type ControlAction,
  type EngineContext,
  type GameEngine,
  type GameResult,
  type Player,
} from '@jvof/game-core';
import { getMafiaAudioPolicy } from './policy';
import { computeRoleCounts, normalizeMafiaSettings } from './settings';
import {
  ROLE_INFO,
  ROLE_ORDER,
  type MafiaAction,
  type MafiaPlayer,
  type MafiaPlayerView,
  type MafiaPublicState,
  type MafiaState,
  type NightState,
  type Phase,
  type Role,
  type Team,
} from './types';

const ROLE_ASSIGN_MS = 12_000;
const ANNOUNCE_MS = 7_000;
const EXECUTION_NO_SPEECH_MS = 6_000;

const sec = (s: number) => s * 1000;
export const teamOf = (r: Role): Team => ROLE_INFO[r].team;
const isMafia = (p: MafiaPlayer) => teamOf(p.role) === 'mafia';
const emptyNight = (): NightState => ({ mafiaVotes: {}, sheriffCheck: null, donCheck: null, doctorHeal: null, visit: null });

// ---------- допоміжне ----------

function player(s: MafiaState, id: string | null | undefined): MafiaPlayer | undefined {
  return id ? s.players.find((p) => p.id === id) : undefined;
}
const alive = (s: MafiaState) => s.players.filter((p) => p.alive);
const aliveWithRole = (s: MafiaState, role: Role) => s.players.find((p) => p.alive && p.role === role);

function log(s: MafiaState, ctx: EngineContext, type: string, actorId: string | null, payload: unknown) {
  s.events.push({ seq: s.events.length + 1, phase: phaseKey(s), type, actorId, payload, ts: ctx.now });
}

function phaseKey(s: MafiaState): string {
  switch (s.phase) {
    case 'NIGHT':
      return `night-${s.round}`;
    case 'ROLE_ASSIGN':
      return 'roles';
    case 'GAME_OVER':
      return 'over';
    default:
      return `day-${s.round}`;
  }
}

const killAllowed = (s: MafiaState) => s.round > 1 || s.settings.firstNightKill;

export function computeWinner(s: MafiaState): Team | null {
  const living = alive(s);
  const mafia = living.filter(isMafia).length;
  const civ = living.length - mafia;
  if (mafia === 0) return 'civilians';
  if (mafia >= civ) return 'mafia';
  return null;
}

// ---------- переходи між фазами ----------

function enter(s: MafiaState, phase: Phase, ctx: EngineContext, ms: number | null) {
  s.phase = phase;
  s.timer = startTimer(ctx.now, ms);
  s.step++;
  log(s, ctx, 'phase', null, { phase, round: s.round });
}

function enterNight(s: MafiaState, ctx: EngineContext) {
  s.night = emptyNight();
  enter(s, 'NIGHT', ctx, sec(s.settings.nightSeconds));
}

function enterDiscussion(s: MafiaState, ctx: EngineContext) {
  const living = alive(s).sort((a, b) => a.seat - b.seat);
  s.discussion = { order: rotateOrder(living, s.round - 1).map((p) => p.id), index: 0, timeUp: false };
  enter(s, 'DAY_DISCUSSION', ctx, sec(s.settings.speechSeconds));
}

function enterVoting(s: MafiaState, ctx: EngineContext, round: 1 | 2, candidates: string[]) {
  s.voting = { round, candidates, votes: {} };
  enter(s, 'VOTING', ctx, sec(s.settings.votingSeconds));
}

function finish(s: MafiaState, ctx: EngineContext, winner: Team | null) {
  s.winner = winner;
  s.phase = 'GAME_OVER';
  s.timer = noTimer();
  s.step++;
  log(s, ctx, 'game_over', null, { winner, aborted: s.aborted });
}

function kill(s: MafiaState, id: string) {
  const p = player(s, id);
  if (p && p.alive) {
    p.alive = false;
    p.diedAt = phaseKey(s);
  }
}

/** У кого алібі на поточний день (Повія була в нього минулої ночі) */
function alibiToday(s: MafiaState): string | null {
  return s.alibi && s.alibi.round === s.round && player(s, s.alibi.playerId)?.alive ? s.alibi.playerId : null;
}

function resolveNight(s: MafiaState, ctx: EngineContext): string | null {
  // Повія: до кого пішла, той цієї ночі не діє
  const prostitute = aliveWithRole(s, 'prostitute');
  const visit = prostitute ? s.night.visit : null;
  const blocked = (id: string | undefined) => !!id && id === visit;

  let target: string | null = null;
  if (killAllowed(s)) {
    const votes = Object.fromEntries(Object.entries(s.night.mafiaVotes).filter(([voter]) => !blocked(voter)));
    const don = aliveWithRole(s, 'don');
    if (don && votes[don.id]) target = votes[don.id];
    else {
      const living = alive(s).map((p) => p.id);
      const { leaders } = tallyVotes(votes, living);
      if (leaders.length > 0) target = leaders[Math.floor(ctx.random() * leaders.length)];
    }
  }
  const doctor = aliveWithRole(s, 'doctor');
  const heal = doctor && !blocked(doctor.id) ? s.night.doctorHeal : null;
  if (doctor && heal === doctor.id) s.lastSelfHealRound = s.round;

  // Перевірки шерифа й дона розкриваються вранці (бо їх могла заблокувати Повія)
  const sheriff = aliveWithRole(s, 'sheriff');
  if (sheriff && s.night.sheriffCheck) {
    const t = player(s, s.night.sheriffCheck)!;
    s.checks.push({ by: 'sheriff', actorId: sheriff.id, round: s.round, targetId: t.id, result: blocked(sheriff.id) ? null : isMafia(t) });
  }
  const don = aliveWithRole(s, 'don');
  if (don && s.night.donCheck) {
    const t = player(s, s.night.donCheck)!;
    s.checks.push({ by: 'don', actorId: don.id, round: s.round, targetId: t.id, result: blocked(don.id) ? null : t.role === 'sheriff' });
  }

  const saved = target !== null && target === heal;
  const killed = target !== null && !saved ? target : null;
  if (killed) kill(s, killed);

  s.lastVisitTarget = visit;
  s.alibi = visit ? { round: s.round, playerId: visit } : null;
  const alibiId = visit && player(s, visit)?.alive ? visit : null;

  log(s, ctx, 'night_result', null, { targetId: target, healId: heal, killedId: killed, saved, visitId: visit });
  s.lastNight = { round: s.round, killedId: killed };
  s.chronicle.push({ kind: 'night', round: s.round, killedId: killed, alibiId });
  return killed;
}

function resolveVoting(s: MafiaState, ctx: EngineContext) {
  const { leaders, counts, skips } = tallyVotes(s.voting.votes, s.voting.candidates);
  log(s, ctx, 'vote_result', null, { voteRound: s.voting.round, votes: s.voting.votes, counts, skips, leaders });
  s.chronicle.push({ kind: 'vote', round: s.round, voteRound: s.voting.round, votes: { ...s.voting.votes }, leaders });

  if (leaders.length > 1 && s.voting.round === 1) {
    enterVoting(s, ctx, 2, leaders);
    return;
  }
  let outcome: 'executed' | 'tie' | 'nobody' = 'nobody';
  let targetId: string | null = null;
  if (leaders.length === 1) {
    outcome = 'executed';
    targetId = leaders[0];
    kill(s, targetId);
  } else if (leaders.length > 1) outcome = 'tie';
  const speech = outcome === 'executed' && s.settings.lastSpeech;
  s.execution = { targetId, outcome, speech };
  s.chronicle.push({ kind: 'execution', round: s.round, targetId, outcome });
  log(s, ctx, 'execution', null, { targetId, outcome });
  enter(s, 'EXECUTION', ctx, speech ? sec(s.settings.lastSpeechSeconds) : EXECUTION_NO_SPEECH_MS);
}

/** Перейти до наступного кроку гри (таймер вийшов або ведучий натиснув «далі»). */
function advance(s: MafiaState, ctx: EngineContext) {
  switch (s.phase) {
    case 'ROLE_ASSIGN':
      enterNight(s, ctx);
      return;
    case 'NIGHT':
      resolveNight(s, ctx);
      enter(s, 'DAY_ANNOUNCE', ctx, ANNOUNCE_MS);
      return;
    case 'DAY_ANNOUNCE': {
      const w = computeWinner(s);
      if (w) finish(s, ctx, w);
      else enterDiscussion(s, ctx);
      return;
    }
    case 'DAY_DISCUSSION':
      nextSpeaker(s, ctx);
      return;
    case 'VOTING':
      resolveVoting(s, ctx);
      return;
    case 'EXECUTION': {
      const w = computeWinner(s);
      if (w) finish(s, ctx, w);
      else {
        s.round++;
        enterNight(s, ctx);
      }
      return;
    }
    case 'GAME_OVER':
      return;
  }
}

function nextSpeaker(s: MafiaState, ctx: EngineContext) {
  const d = s.discussion;
  let i = d.index + 1;
  while (i < d.order.length && !player(s, d.order[i])?.alive) i++;
  if (i >= d.order.length) {
    const alibi = alibiToday(s);
    enterVoting(
      s,
      ctx,
      1,
      alive(s)
        .map((p) => p.id)
        .filter((id) => id !== alibi),
    );
    return;
  }
  s.discussion = { ...d, index: i, timeUp: false };
  s.timer = startTimer(ctx.now, sec(s.settings.speechSeconds));
  s.step++;
}

function nightComplete(s: MafiaState): boolean {
  if (!killAllowed(s)) return false; // знайомча ніч триває до кінця таймера
  const don = aliveWithRole(s, 'don');
  const mafia = alive(s).filter(isMafia);
  const killDone = don ? !!s.night.mafiaVotes[don.id] : mafia.every((m) => s.night.mafiaVotes[m.id]);
  const sheriffDone = !aliveWithRole(s, 'sheriff') || s.night.sheriffCheck !== null;
  const donDone = !don || s.night.donCheck !== null;
  const doctorDone = !aliveWithRole(s, 'doctor') || s.night.doctorHeal !== null;
  const visitDone = !aliveWithRole(s, 'prostitute') || s.night.visit !== null;
  return killDone && sheriffDone && donDone && doctorDone && visitDone;
}

const votingComplete = (s: MafiaState) => alive(s).every((p) => s.voting.votes[p.id] !== undefined);

// ---------- службові дії ----------

function handleControl(s: MafiaState, a: ControlAction, ctx: EngineContext) {
  if (s.phase === 'GAME_OVER') return;
  switch (a.type) {
    case '@timeout': {
      if (isPaused(s.timer) || s.timer.endsAt === null || ctx.now < s.timer.endsAt - 50) return;
      if (s.hostMode === 'auto') return advance(s, ctx);
      // Ведучий-людина: фази перемикає ведучий, а таймер лише вимикає мікрофон тому, чий час вийшов.
      s.timer = { endsAt: null, pausedRemaining: null };
      if (s.phase === 'DAY_DISCUSSION') s.discussion.timeUp = true;
      if (s.phase === 'EXECUTION' && s.execution) s.execution.speech = false;
      s.step++;
      return;
    }
    case '@next':
      return advance(s, ctx);
    case '@pause':
      s.timer = pauseTimer(s.timer, ctx.now);
      log(s, ctx, 'pause', null, {});
      return;
    case '@resume':
      s.timer = resumeTimer(s.timer, ctx.now);
      log(s, ctx, 'resume', null, {});
      return;
    case '@extend':
      s.timer = extendTimer(s.timer, Math.max(0, Math.min(a.ms, 300_000)));
      if (s.phase === 'DAY_DISCUSSION') s.discussion.timeUp = false;
      return;
    case '@stop':
      s.aborted = true;
      finish(s, ctx, null);
      return;
    case '@host_left':
      s.hostMode = 'auto';
      s.hostId = null;
      if (s.timer.endsAt === null && !isPaused(s.timer)) s.timer = startTimer(ctx.now, 10_000);
      log(s, ctx, 'host_left', null, {});
      return;
    case '@remove_player': {
      const p = player(s, a.playerId);
      if (!p || !p.alive) return;
      p.alive = false;
      p.diedAt = 'left';
      s.chronicle.push({ kind: 'left', round: s.round, playerId: p.id });
      log(s, ctx, 'player_left', p.id, {});
      delete s.voting.votes[p.id];
      delete s.night.mafiaVotes[p.id];
      const w = computeWinner(s);
      if (w) return finish(s, ctx, w);
      if (s.phase === 'DAY_DISCUSSION' && s.discussion.order[s.discussion.index] === p.id) nextSpeaker(s, ctx);
      else if (s.phase === 'VOTING') {
        s.voting.candidates = s.voting.candidates.filter((c) => c !== p.id);
        for (const [voter, target] of Object.entries(s.voting.votes)) if (target === p.id) delete s.voting.votes[voter];
        if (s.voting.candidates.length === 0) resolveVoting(s, ctx);
      }
      s.step++;
      return;
    }
  }
}

// ---------- дії гравців ----------

function handlePlayer(s: MafiaState, actorId: string, raw: unknown, ctx: EngineContext) {
  const a = raw as MafiaAction;
  const me = player(s, actorId);
  if (!me) throw new GameError('Ви не берете участі в цій партії');
  if (s.phase === 'GAME_OVER') throw new GameError('Гру завершено');
  if (isPaused(s.timer)) throw new GameError('Гру поставлено на паузу');
  // страчений формально вже вибув, але свою останню промову може завершити сам
  const lastWord = a?.type === 'end_speech' && s.phase === 'EXECUTION' && s.execution?.targetId === actorId;
  if (!me.alive && !lastWord) throw new GameError('Вибулі гравці не можуть діяти');

  switch (a?.type) {
    case 'end_speech': {
      if (s.phase === 'DAY_DISCUSSION' && s.discussion.order[s.discussion.index] === actorId) {
        log(s, ctx, 'end_speech', actorId, {});
        return nextSpeaker(s, ctx);
      }
      if (lastWord) return advance(s, ctx);
      throw new GameError('Зараз не ваша черга говорити');
    }
    case 'night':
      return handleNight(s, me, a, ctx);
    case 'vote': {
      if (s.phase !== 'VOTING') throw new GameError('Зараз не голосування');
      const target = String(a.target);
      if (target !== SKIP) {
        if (!s.voting.candidates.includes(target)) throw new GameError('За цього гравця зараз голосувати не можна');
        if (target === actorId) throw new GameError('Не можна голосувати за себе');
      }
      s.voting.votes[actorId] = target;
      log(s, ctx, 'vote', actorId, { target, voteRound: s.voting.round });
      if (s.hostMode === 'auto' && votingComplete(s)) advance(s, ctx);
      return;
    }
    default:
      throw new GameError('Невідома дія');
  }
}

function handleNight(s: MafiaState, me: MafiaPlayer, a: Extract<MafiaAction, { type: 'night' }>, ctx: EngineContext) {
  if (s.phase !== 'NIGHT') throw new GameError('Зараз не ніч');
  const target = player(s, a.target);
  if (!target || !target.alive) throw new GameError('Цей гравець уже вибув');

  if (a.kind === 'kill') {
    if (!isMafia(me)) throw new GameError('Вбивати може лише мафія');
    if (!killAllowed(s)) throw new GameError('Перша ніч знайомча: мафія нікого не вбиває');
    if (isMafia(target)) throw new GameError('Не можна обрати когось зі своєї команди');
    s.night.mafiaVotes[me.id] = target.id;
  } else if (a.kind === 'check') {
    if (me.role === 'sheriff') {
      if (s.night.sheriffCheck) throw new GameError('Цієї ночі ви вже перевіряли');
      if (target.id === me.id) throw new GameError('Перевіряти себе немає сенсу');
      s.night.sheriffCheck = target.id;
    } else if (me.role === 'don') {
      if (s.night.donCheck) throw new GameError('Цієї ночі ви вже перевіряли');
      if (target.id === me.id) throw new GameError('Перевіряти себе немає сенсу');
      s.night.donCheck = target.id;
    } else throw new GameError('Перевіряти можуть лише шериф і дон');
  } else if (a.kind === 'heal') {
    if (me.role !== 'doctor') throw new GameError('Лікувати може лише лікар');
    if (!killAllowed(s)) throw new GameError('Першої ночі ніхто не нападає, лікувати нема кого');
    if (target.id === me.id) {
      if (!s.settings.doctorSelfHeal) throw new GameError('За правилами цієї гри лікар не лікує себе');
      if (s.lastSelfHealRound === s.round - 1) throw new GameError('Не можна лікувати себе дві ночі поспіль');
    }
    s.night.doctorHeal = target.id;
  } else if (a.kind === 'visit') {
    if (me.role !== 'prostitute') throw new GameError('Ходити в гості може лише Повія');
    if (target.id === me.id) throw new GameError('До себе в гості не ходять');
    if (target.id === s.lastVisitTarget) throw new GameError('Не можна йти до того самого гравця дві ночі поспіль');
    s.night.visit = target.id;
  } else throw new GameError('Невідома нічна дія');

  log(s, ctx, 'night_action', me.id, { kind: a.kind, target: target.id });
  if (s.hostMode === 'auto' && nightComplete(s)) advance(s, ctx);
}

// ---------- рушій ----------

export const mafiaEngine: GameEngine<MafiaState, MafiaPublicState, MafiaPlayerView> = {
  start(players: Player[], config: unknown, ctx) {
    const settings = normalizeMafiaSettings((config ?? {}) as Record<string, unknown>);
    const roleCounts = computeRoleCounts(players.length, settings);
    const roles = shuffle(
      ROLE_ORDER.flatMap((r) => Array<Role>(roleCounts[r]).fill(r)),
      ctx.random,
    );
    const seated = [...players].sort((a, b) => a.seat - b.seat);
    const s: MafiaState = {
      settings,
      hostId: settings.hostMode === 'human' ? ctx.hostId : null,
      hostMode: settings.hostMode === 'human' && ctx.hostId ? 'human' : 'auto',
      players: seated.map((p, i) => ({ id: p.id, nickname: p.nickname, seat: i + 1, role: roles[i], alive: true, diedAt: null })),
      roleCounts,
      phase: 'ROLE_ASSIGN',
      round: 1,
      timer: noTimer(),
      night: emptyNight(),
      lastSelfHealRound: null,
      lastVisitTarget: null,
      alibi: null,
      lastNight: null,
      discussion: { order: [], index: 0, timeUp: false },
      voting: { round: 1, candidates: [], votes: {} },
      execution: null,
      checks: [],
      chronicle: [],
      winner: null,
      aborted: false,
      step: 0,
      events: [],
    };
    log(s, ctx, 'game_started', null, {
      settings,
      hostId: s.hostId,
      players: s.players.map((p) => ({ id: p.id, seat: p.seat, role: p.role })),
    });
    enter(s, 'ROLE_ASSIGN', ctx, ROLE_ASSIGN_MS);
    return s;
  },

  handleAction(state, actorId, action, ctx) {
    const s = structuredClone(state);
    if (actorId === null) {
      if (!isControlAction(action)) throw new GameError('Невідома службова дія');
      handleControl(s, action, ctx);
    } else {
      if (isControlAction(action)) throw new GameError('Ця дія доступна лише ведучому');
      handlePlayer(s, actorId, action, ctx);
    }
    return s;
  },

  getPublicState(s, now) {
    const over = s.phase === 'GAME_OVER';
    const speakerId =
      s.phase === 'DAY_DISCUSSION'
        ? (s.discussion.order[s.discussion.index] ?? null)
        : s.phase === 'EXECUTION' && s.execution?.speech
          ? s.execution.targetId
          : null;
    return {
      phase: s.phase,
      phaseKey: phaseKey(s),
      round: s.round,
      hostMode: s.hostMode,
      hostId: s.hostId,
      paused: isPaused(s.timer),
      endsAt: s.timer.endsAt,
      remainingMs: remainingMs(s.timer, now),
      players: s.players.map((p) => ({ id: p.id, nickname: p.nickname, seat: p.seat, alive: p.alive, role: over ? p.role : null })),
      roleCounts: s.roleCounts,
      speakerId,
      speakerTimeUp: s.phase === 'DAY_DISCUSSION' && s.discussion.timeUp,
      order: s.phase === 'DAY_DISCUSSION' ? s.discussion.order : [],
      orderIndex: s.discussion.index,
      voting:
        s.phase === 'VOTING'
          ? { round: s.voting.round, candidates: s.voting.candidates, votedIds: Object.keys(s.voting.votes) }
          : null,
      lastNight: s.lastNight,
      alibiId: s.phase !== 'NIGHT' && s.phase !== 'GAME_OVER' ? alibiToday(s) : null,
      execution: s.phase === 'EXECUTION' || over ? s.execution : null,
      winner: s.winner,
      aborted: s.aborted,
      chronicle: s.chronicle,
      settings: s.settings,
    };
  },

  getPlayerView(s, userId) {
    const over = s.phase === 'GAME_OVER';
    const allRoles = () => Object.fromEntries(s.players.map((p) => [p.id, p.role])) as Record<string, Role>;
    if (s.hostId && userId === s.hostId) {
      return {
        kind: 'host',
        me: null,
        teammates: [],
        checks: s.checks,
        night: null,
        myVote: null,
        roles: allRoles(),
        hostNight: s.phase === 'NIGHT' ? s.night : null,
      };
    }
    const me = player(s, userId);
    if (!me) return over ? { kind: 'player', me: null, teammates: [], checks: [], night: null, myVote: null, roles: allRoles(), hostNight: null } : null;
    const mafia = isMafia(me);
    const night =
      s.phase === 'NIGHT' && me.alive
        ? {
            canKill: mafia && killAllowed(s),
            check: me.role === 'sheriff' ? ('sheriff' as const) : me.role === 'don' ? ('don' as const) : null,
            canHeal: me.role === 'doctor' && killAllowed(s),
            cannotHealSelf: me.role === 'doctor' && (!s.settings.doctorSelfHeal || s.lastSelfHealRound === s.round - 1),
            myKill: s.night.mafiaVotes[me.id] ?? null,
            myCheck: me.role === 'sheriff' ? s.night.sheriffCheck : me.role === 'don' ? s.night.donCheck : null,
            myHeal: me.role === 'doctor' ? s.night.doctorHeal : null,
            canVisit: me.role === 'prostitute',
            myVisit: me.role === 'prostitute' ? s.night.visit : null,
            cannotVisitId: me.role === 'prostitute' ? s.lastVisitTarget : null,
            teamVotes: mafia ? s.night.mafiaVotes : {},
          }
        : null;
    return {
      kind: 'player',
      me: { id: me.id, role: me.role, team: teamOf(me.role), alive: me.alive },
      teammates: mafia ? s.players.filter((p) => isMafia(p) && p.id !== me.id).map((p) => ({ id: p.id, role: p.role })) : [],
      checks: s.checks.filter((c) => c.actorId === me.id),
      night,
      myVote: s.phase === 'VOTING' ? (s.voting.votes[me.id] ?? null) : null,
      roles: over ? allRoles() : null,
      hostNight: null,
    };
  },

  getAudioPolicy: getMafiaAudioPolicy,

  getChatAccess(s, userId): ChatAccess {
    const over = s.phase === 'GAME_OVER';
    if (over) return { read: ['main', 'mafia', 'ghosts'], write: ['main'] };
    if (s.hostId && userId === s.hostId) return { read: ['main', 'mafia', 'ghosts'], write: ['main'] };
    const me = player(s, userId);
    if (!me) return { read: ['main'], write: [] };
    if (!me.alive) return { read: ['main', 'ghosts'], write: ['ghosts'] };
    const read = ['main'];
    const write = s.phase === 'NIGHT' ? [] : ['main'];
    if (isMafia(me)) {
      read.push('mafia');
      if (s.phase === 'NIGHT') write.push('mafia');
    }
    return { read, write };
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
        role: p.role,
        team: teamOf(p.role),
        isAlive: p.alive,
        diedAtPhase: p.diedAt,
        won: s.winner !== null && teamOf(p.role) === s.winner,
      })),
    };
  },

  getEvents: (s) => s.events,

  getPhaseKey: (s) => `${s.step}:${s.phase}`,
};
