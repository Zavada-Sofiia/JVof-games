import { describe, expect, it } from 'vitest';
import { GameError, seededRandom, type EngineContext } from '@jvof/game-core';
import { policyHears, policySees } from '@jvof/shared';
import { computeRoleCounts, defaultRoleCounts, mafiaEngine as E, normalizeMafiaSettings, type MafiaState, type Role } from './index';

const ids = ['p1', 'p2', 'p3', 'p4', 'p5', 'p6', 'p7', 'p8'];
// Фіксований розклад ролей для тестів: p1 дон, p2 мафія, p3 шериф, p4 лікар, решта мирні
const ROLES: Role[] = ['don', 'mafia', 'sheriff', 'doctor', 'civilian', 'civilian', 'civilian', 'civilian'];

let clock = 1_000_000;
const ctx = (): EngineContext => ({ now: clock, random: seededRandom(42) });

function setup(settings: Record<string, unknown> = {}, n = 8, hostId: string | null = null): MafiaState {
  clock = 1_000_000;
  const players = ids.slice(0, n).map((id, i) => ({ id, nickname: id.toUpperCase(), seat: i + 1 }));
  const s = E.start(players, settings, { ...ctx(), hostId });
  s.players.forEach((p, i) => (p.role = ROLES[i] ?? 'civilian'));
  return s;
}

/** Промотати час до дедлайну й надіслати таймаут */
function timeout(s: MafiaState): MafiaState {
  const d = E.getNextDeadline(s);
  if (d === null) throw new Error('no deadline');
  clock = d;
  return E.handleAction(s, null, { type: '@timeout' }, ctx());
}

const act = (s: MafiaState, who: string, action: unknown) => E.handleAction(s, who, action, ctx());
const pub = (s: MafiaState) => E.getPublicState(s, clock);
const voteAll = (s: MafiaState, target: (voter: string) => string) => {
  for (const p of s.players.filter((x) => x.alive)) if (s.phase === 'VOTING') s = act(s, p.id, { type: 'vote', target: target(p.id) });
  return s;
};
/** Пропустити обговорення: усі по черзі завершують промови */
function skipDiscussion(s: MafiaState): MafiaState {
  while (s.phase === 'DAY_DISCUSSION') s = act(s, pub(s).speakerId!, { type: 'end_speech' });
  return s;
}

describe('склад ролей', () => {
  it('для 8 гравців: 4 мирних, шериф, лікар, мафія, дон', () => {
    expect(defaultRoleCounts(8)).toEqual({ civilian: 4, sheriff: 1, doctor: 1, prostitute: 0, mafia: 1, don: 1 });
  });
  it('для 5 гравців одна мафія', () => {
    expect(defaultRoleCounts(5)).toEqual({ civilian: 2, sheriff: 1, doctor: 1, prostitute: 0, mafia: 1, don: 0 });
  });
  it('роздає рівно стільки ролей, скільки гравців, і кожному свою', () => {
    const players = ids.map((id, i) => ({ id, nickname: id, seat: i + 1 }));
    const s = E.start(players, {}, { now: 0, random: seededRandom(7), hostId: null });
    const counts: Record<string, number> = {};
    s.players.forEach((p) => (counts[p.role] = (counts[p.role] ?? 0) + 1));
    expect(counts).toEqual({ civilian: 4, sheriff: 1, doctor: 1, mafia: 1, don: 1 });
  });
  it('не дає почати з трьома гравцями', () => {
    expect(() => setup({}, 3)).toThrow(GameError);
  });
});

describe('перебіг партії', () => {
  it('перша ніч знайомча: мафія не може вбити, ніхто не гине', () => {
    let s = timeout(setup()); // ROLE_ASSIGN -> NIGHT
    expect(s.phase).toBe('NIGHT');
    expect(() => act(s, 'p1', { type: 'night', kind: 'kill', target: 'p5' })).toThrow(/знайомча/);
    s = act(s, 'p3', { type: 'night', kind: 'check', target: 'p2' }); // шериф перевіряє
    expect(s.phase).toBe('NIGHT'); // знайомча ніч не закінчується достроково
    s = timeout(s);
    expect(s.phase).toBe('DAY_ANNOUNCE');
    expect(pub(s).lastNight).toEqual({ round: 1, killedId: null });
    expect(s.players.every((p) => p.alive)).toBe(true);
    const sheriffView = E.getPlayerView(s, 'p3')!;
    expect(sheriffView.checks).toEqual([expect.objectContaining({ targetId: 'p2', result: true })]);
  });

  it('повна партія: мирні виганяють обох мафіозі й перемагають', () => {
    let s = timeout(timeout(setup())); // -> NIGHT -> DAY_ANNOUNCE (ніч 1)
    s = timeout(s); // -> DAY_DISCUSSION
    expect(s.phase).toBe('DAY_DISCUSSION');
    s = skipDiscussion(s);
    expect(s.phase).toBe('VOTING');
    s = voteAll(s, (v) => (v === 'p1' ? 'p5' : 'p1')); // усі проти дона
    expect(s.phase).toBe('EXECUTION');
    expect(pub(s).execution).toMatchObject({ targetId: 'p1', outcome: 'executed', speech: true });
    expect(pub(s).speakerId).toBe('p1'); // остання промова
    s = act(s, 'p1', { type: 'end_speech' });
    expect(s.phase).toBe('NIGHT');
    expect(s.round).toBe(2);

    // Ніч 2: мафія (дона вже немає) обирає p5, лікар рятує p5
    s = act(s, 'p2', { type: 'night', kind: 'kill', target: 'p5' });
    s = act(s, 'p3', { type: 'night', kind: 'check', target: 'p6' });
    s = act(s, 'p4', { type: 'night', kind: 'heal', target: 'p5' });
    expect(s.phase).toBe('DAY_ANNOUNCE'); // усі зробили вибір — ніч закінчилась одразу
    expect(pub(s).lastNight).toEqual({ round: 2, killedId: null });

    s = skipDiscussion(timeout(s));
    s = voteAll(s, (v) => (v === 'p2' ? 'p3' : 'p2'));
    s = act(s, 'p2', { type: 'end_speech' });
    expect(s.phase).toBe('GAME_OVER');
    expect(s.winner).toBe('civilians');
    const result = E.getResult(s)!;
    expect(result.players.find((p) => p.id === 'p5')!.won).toBe(true);
    expect(result.players.find((p) => p.id === 'p1')!.won).toBe(false);
    expect(pub(s).players.every((p) => p.role !== null)).toBe(true); // ролі відкриваються в кінці
  });

  it('мафія перемагає, коли її стільки ж, скільки мирних', () => {
    let s = setup({ firstNightKill: true }, 4);
    // 4 гравці: p1 дон(мафія), p2 мафія... для 4 гравців підміняємо склад: одна мафія
    s.players.forEach((p, i) => (p.role = (['mafia', 'sheriff', 'civilian', 'civilian'] as Role[])[i]));
    s = timeout(s); // NIGHT
    s = act(s, 'p1', { type: 'night', kind: 'kill', target: 'p3' });
    s = act(s, 'p2', { type: 'night', kind: 'check', target: 'p4' });
    expect(s.phase).toBe('DAY_ANNOUNCE');
    s = skipDiscussion(timeout(s));
    s = voteAll(s, (v) => (v === 'p2' ? 'p4' : 'p2')); // мирні помилково женуть шерифа
    expect(pub(s).execution?.targetId).toBe('p2');
    s = timeout(s);
    expect(s.phase).toBe('GAME_OVER');
    expect(s.winner).toBe('mafia');
  });

  it('дон остаточно обирає жертву, навіть якщо мафія проголосувала інакше', () => {
    let s = setup({ firstNightKill: true });
    s = timeout(s);
    s = act(s, 'p2', { type: 'night', kind: 'kill', target: 'p6' });
    s = act(s, 'p1', { type: 'night', kind: 'kill', target: 'p7' });
    s = timeout(s);
    expect(pub(s).lastNight?.killedId).toBe('p7');
  });

  it('мафія не може обрати когось зі своїх', () => {
    const s = timeout(setup({ firstNightKill: true }));
    expect(() => act(s, 'p1', { type: 'night', kind: 'kill', target: 'p2' })).toThrow(GameError);
  });

  it('лікар може лікувати себе, але не дві ночі поспіль', () => {
    let s = timeout(setup({ firstNightKill: true }));
    s = act(s, 'p4', { type: 'night', kind: 'heal', target: 'p4' });
    s = act(s, 'p1', { type: 'night', kind: 'kill', target: 'p4' });
    s = act(s, 'p3', { type: 'night', kind: 'check', target: 'p8' });
    s = act(s, 'p1', { type: 'night', kind: 'check', target: 'p8' });
    expect(s.phase).toBe('DAY_ANNOUNCE');
    expect(pub(s).lastNight?.killedId).toBeNull(); // врятував себе
    s = skipDiscussion(timeout(s));
    s = voteAll(s, () => 'skip');
    expect(pub(s).execution?.outcome).toBe('nobody');
    s = timeout(s);
    expect(s.phase).toBe('NIGHT');
    expect(E.getPlayerView(s, 'p4')!.night!.cannotHealSelf).toBe(true);
    expect(() => act(s, 'p4', { type: 'night', kind: 'heal', target: 'p4' })).toThrow(/поспіль/);
    s = act(s, 'p4', { type: 'night', kind: 'heal', target: 'p5' });
  });

  it('нічия -> переголосування -> знову нічия: ніхто не страчений', () => {
    let s = skipDiscussion(timeout(timeout(timeout(setup()))));
    // p5..p8 проти p1, p1..p4 проти p5 => 4:4
    s = voteAll(s, (v) => (['p5', 'p6', 'p7', 'p8'].includes(v) ? 'p1' : 'p5'));
    expect(s.phase).toBe('VOTING');
    expect(pub(s).voting).toMatchObject({ round: 2, candidates: ['p1', 'p5'] });
    expect(() => act(s, 'p2', { type: 'vote', target: 'p3' })).toThrow(GameError); // не кандидат
    s = voteAll(s, (v) => (['p5', 'p6', 'p7', 'p8'].includes(v) ? 'p1' : 'p5'));
    expect(s.phase).toBe('EXECUTION');
    expect(pub(s).execution).toMatchObject({ targetId: null, outcome: 'tie' });
    expect(s.players.every((p) => p.alive)).toBe(true);
  });

  it('не можна голосувати за себе й діяти після смерті', () => {
    let s = skipDiscussion(timeout(timeout(timeout(setup()))));
    expect(() => act(s, 'p1', { type: 'vote', target: 'p1' })).toThrow(/себе/);
    s = voteAll(s, (v) => (v === 'p8' ? 'p7' : 'p8'));
    expect(() => act(s, 'p8', { type: 'end_speech' })).not.toThrow();
    s = timeout(s);
    expect(() => act(s, 'p8', { type: 'night', kind: 'kill', target: 'p5' })).toThrow(/Вибулі/);
  });

  it('гравець, який вийшов, вибуває; якщо мафії більше немає — мирні перемагають', () => {
    let s = setup({}, 5);
    s.players.forEach((p, i) => (p.role = (['mafia', 'sheriff', 'doctor', 'civilian', 'civilian'] as Role[])[i]));
    s = timeout(s);
    s = E.handleAction(s, null, { type: '@remove_player', playerId: 'p1' }, ctx());
    expect(s.phase).toBe('GAME_OVER');
    expect(s.winner).toBe('civilians');
  });
});

describe('таймери та ведучий', () => {
  it('пауза зупиняє таймер, продовження відновлює залишок', () => {
    let s = timeout(setup());
    const left = s.timer.endsAt! - clock;
    clock += 10_000;
    s = E.handleAction(s, null, { type: '@pause' }, ctx());
    expect(pub(s).paused).toBe(true);
    expect(E.getNextDeadline(s)).toBeNull();
    expect(() => act(s, 'p3', { type: 'night', kind: 'check', target: 'p1' })).toThrow(/паузу/);
    clock += 60_000;
    s = E.handleAction(s, null, { type: '@resume' }, ctx());
    expect(s.timer.endsAt! - clock).toBe(left - 10_000);
  });

  it('застарілий таймаут ігнорується', () => {
    const s = timeout(setup());
    clock = s.timer.endsAt! - 5_000;
    expect(E.handleAction(s, null, { type: '@timeout' }, ctx()).phase).toBe('NIGHT');
  });

  it('ведучий-людина: таймер промови лише вимикає мікрофон, фазу перемикає ведучий', () => {
    let s = setup({ hostMode: 'human' }, 8, 'host');
    expect(s.hostMode).toBe('human');
    s = E.handleAction(s, null, { type: '@next' }, ctx()); // -> NIGHT
    s = E.handleAction(s, null, { type: '@next' }, ctx()); // -> DAY_ANNOUNCE
    s = E.handleAction(s, null, { type: '@next' }, ctx()); // -> DAY_DISCUSSION
    const speaker = pub(s).speakerId!;
    expect(E.getAudioPolicy(s).speakers).toEqual([speaker, 'host']);
    s = timeout(s);
    expect(s.phase).toBe('DAY_DISCUSSION');
    expect(pub(s).speakerId).toBe(speaker);
    expect(pub(s).speakerTimeUp).toBe(true);
    expect(E.getAudioPolicy(s).speakers).toEqual(['host']);
    s = E.handleAction(s, null, { type: '@next' }, ctx());
    expect(pub(s).speakerId).not.toBe(speaker);
  });

  it('ведучий бачить усі ролі, гравці — лише свою', () => {
    const s = setup({ hostMode: 'human' }, 8, 'host');
    expect(Object.keys(E.getPlayerView(s, 'host')!.roles!)).toHaveLength(8);
    const civ = E.getPlayerView(s, 'p5')!;
    expect(civ.roles).toBeNull();
    expect(civ.teammates).toEqual([]);
    const don = E.getPlayerView(s, 'p1')!;
    expect(don.teammates).toEqual([{ id: 'p2', role: 'mafia' }]);
    // публічний стан не містить ролей
    expect(JSON.stringify(pub(s))).not.toMatch(/"role":"(don|mafia|sheriff|doctor)"/);
  });

  it('якщо ведучий пішов, гра переходить на авто-ведучого', () => {
    let s = setup({ hostMode: 'human' }, 8, 'host');
    s = E.handleAction(s, null, { type: '@host_left' }, ctx());
    expect(s.hostMode).toBe('auto');
    expect(s.hostId).toBeNull();
  });
});

describe('політика звуку', () => {
  it('ніч: мафія чує лише одна одну, решта не чує нічого, камери вимкнені', () => {
    const s = timeout(setup());
    const pol = E.getAudioPolicy(s);
    expect(policyHears(pol, 'p1', 'p2')).toBe(true);
    expect(policyHears(pol, 'p5', 'p1')).toBe(false);
    expect(policyHears(pol, 'p3', 'p2')).toBe(false);
    expect(policySees(pol, 'p1', 'p2')).toBe(false);
    expect(policyHears(pol, 'spectator', 'p1')).toBe(false);
  });

  it('обговорення: усі чують тільки промовця, бачать усіх', () => {
    const s = timeout(timeout(timeout(setup())));
    const speaker = pub(s).speakerId!;
    const pol = E.getAudioPolicy(s);
    const other = ids.find((x) => x !== speaker)!;
    expect(pol.speakers).toEqual([speaker]);
    expect(policyHears(pol, other, speaker)).toBe(true);
    expect(policyHears(pol, speaker, other)).toBe(false);
    expect(policySees(pol, other, speaker)).toBe(true);
    expect(policyHears(pol, 'spectator', speaker)).toBe(true);
  });

  it('голосування: усі мікрофони вимкнені', () => {
    const s = skipDiscussion(timeout(timeout(timeout(setup()))));
    expect(E.getAudioPolicy(s).speakers).toEqual([]);
  });

  it('чат мафії доступний для запису лише мафії вночі; вибулі пишуть у чат привидів', () => {
    let s = timeout(setup());
    expect(E.getChatAccess(s, 'p1').write).toEqual(['mafia']);
    expect(E.getChatAccess(s, 'p5').read).not.toContain('mafia');
    s = skipDiscussion(timeout(timeout(s)));
    s = voteAll(s, (v) => (v === 'p8' ? 'p7' : 'p8'));
    expect(E.getChatAccess(s, 'p8')).toEqual({ read: ['main', 'ghosts'], write: ['ghosts'] });
  });
});

describe('Повія', () => {
  // p1 дон, p2 мафія, p3 шериф, p4 лікар, p5 повія, решта мирні
  const withProstitute = (settings: Record<string, unknown> = {}) => {
    const s = setup({ prostitute: true, firstNightKill: true, ...settings });
    s.players[4].role = 'prostitute';
    return s;
  };

  it('вмикається галочкою і з’являється від 6 гравців замість мирного', () => {
    const on = normalizeMafiaSettings({ prostitute: true });
    expect(computeRoleCounts(8, on)).toMatchObject({ prostitute: 1, civilian: 3 });
    expect(computeRoleCounts(5, on).prostitute).toBe(0);
    expect(computeRoleCounts(8, normalizeMafiaSettings({})).prostitute).toBe(0);
  });

  it('блокує нічну дію: шериф, до якого прийшла повія, нічого не дізнається', () => {
    let s = timeout(withProstitute());
    s = act(s, 'p3', { type: 'night', kind: 'check', target: 'p1' });
    expect(E.getPlayerView(s, 'p3')!.checks).toEqual([]); // результат лише вранці
    s = act(s, 'p5', { type: 'night', kind: 'visit', target: 'p3' });
    s = timeout(s);
    expect(E.getPlayerView(s, 'p3')!.checks).toEqual([expect.objectContaining({ targetId: 'p1', result: null })]);
  });

  it('не впливає на перевірку дона: дон дізнається, чи гравець шериф', () => {
    let s = timeout(withProstitute());
    s = act(s, 'p1', { type: 'night', kind: 'check', target: 'p3' });
    s = act(s, 'p5', { type: 'night', kind: 'visit', target: 'p1' });
    s = timeout(s);
    expect(E.getPlayerView(s, 'p1')!.checks).toEqual([expect.objectContaining({ by: 'don', targetId: 'p3', result: true })]);
  });

  it('блокує голос мафіозі: якщо повія в дона, рахується вибір решти мафії', () => {
    let s = timeout(withProstitute());
    s = act(s, 'p1', { type: 'night', kind: 'kill', target: 'p6' });
    s = act(s, 'p2', { type: 'night', kind: 'kill', target: 'p7' });
    s = act(s, 'p5', { type: 'night', kind: 'visit', target: 'p1' });
    s = timeout(s);
    expect(pub(s).lastNight?.killedId).toBe('p7');
  });

  it('блокує лікаря: його лікування не спрацьовує', () => {
    let s = timeout(withProstitute());
    s = act(s, 'p1', { type: 'night', kind: 'kill', target: 'p6' });
    s = act(s, 'p4', { type: 'night', kind: 'heal', target: 'p6' });
    s = act(s, 'p5', { type: 'night', kind: 'visit', target: 'p4' });
    s = timeout(s);
    expect(pub(s).lastNight?.killedId).toBe('p6');
  });

  it('не захищає від нічного вбивства', () => {
    let s = timeout(withProstitute());
    s = act(s, 'p1', { type: 'night', kind: 'kill', target: 'p6' });
    s = act(s, 'p5', { type: 'night', kind: 'visit', target: 'p6' });
    s = timeout(s);
    expect(pub(s).lastNight?.killedId).toBe('p6');
    expect(pub(s).alibiId).toBeNull(); // мертвому алібі ні до чого
  });

  it('вдень у відвіданого алібі: за нього не можна голосувати', () => {
    let s = timeout(withProstitute());
    s = act(s, 'p5', { type: 'night', kind: 'visit', target: 'p2' });
    s = timeout(s); // ранок
    expect(pub(s).alibiId).toBe('p2');
    s = skipDiscussion(timeout(s));
    expect(s.phase).toBe('VOTING');
    expect(pub(s).voting!.candidates).not.toContain('p2');
    expect(() => act(s, 'p6', { type: 'vote', target: 'p2' })).toThrow(GameError);
    expect(() => act(s, 'p2', { type: 'vote', target: 'p6' })).not.toThrow(); // сам голосувати може
  });

  it('не може йти до того самого гравця дві ночі поспіль і до себе', () => {
    let s = timeout(withProstitute());
    expect(() => act(s, 'p5', { type: 'night', kind: 'visit', target: 'p5' })).toThrow(/себе/);
    s = act(s, 'p5', { type: 'night', kind: 'visit', target: 'p6' });
    s = timeout(s);
    s = skipDiscussion(timeout(s));
    s = voteAll(s, () => 'skip');
    s = timeout(s); // ніч 2
    expect(s.phase).toBe('NIGHT');
    expect(E.getPlayerView(s, 'p5')!.night!.cannotVisitId).toBe('p6');
    expect(() => act(s, 'p5', { type: 'night', kind: 'visit', target: 'p6' })).toThrow(/поспіль/);
    expect(() => act(s, 'p5', { type: 'night', kind: 'visit', target: 'p7' })).not.toThrow();
  });

  it('ніч не закінчується достроково, поки повія не зробила вибір', () => {
    let s = timeout(withProstitute());
    s = act(s, 'p1', { type: 'night', kind: 'kill', target: 'p6' });
    s = act(s, 'p3', { type: 'night', kind: 'check', target: 'p8' });
    s = act(s, 'p1', { type: 'night', kind: 'check', target: 'p8' });
    s = act(s, 'p4', { type: 'night', kind: 'heal', target: 'p7' });
    expect(s.phase).toBe('NIGHT');
    s = act(s, 'p5', { type: 'night', kind: 'visit', target: 'p8' });
    expect(s.phase).toBe('DAY_ANNOUNCE');
  });
});
