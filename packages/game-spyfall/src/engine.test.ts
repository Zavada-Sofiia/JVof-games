import { describe, expect, it } from 'vitest';
import { GameError, seededRandom, type EngineContext } from '@jvof/game-core';
import { LOCATIONS, spyfallEngine as E, type SpyState } from './index';

let clock = 1_000_000;
const ctx = (): EngineContext => ({ now: clock, random: seededRandom(7) });
const ids = ['a', 'b', 'c', 'd', 'e'];

function setup(n = 5): SpyState {
  clock = 1_000_000;
  const s = E.start(ids.slice(0, n).map((id, i) => ({ id, nickname: id, seat: i + 1 })), { roundMinutes: 5 }, { ...ctx(), hostId: null });
  // фіксуємо: шпигун — 'a', ходить першим 'b'
  s.players.forEach((p) => {
    p.isSpy = p.id === 'a';
    p.role = p.isSpy ? null : 'Роль';
  });
  s.askerId = 'b';
  return s;
}
const act = (s: SpyState, who: string, a: unknown) => E.handleAction(s, who, a, ctx());
function timeout(s: SpyState) {
  clock = E.getNextDeadline(s)!;
  return E.handleAction(s, null, { type: '@timeout' }, ctx());
}
const toQuestions = (s: SpyState) => timeout(s);

describe('Шпигун', () => {
  it('роздає ролі: один шпигун без локації, решта знають локацію', () => {
    const s = E.start(ids.map((id, i) => ({ id, nickname: id, seat: i + 1 })), {}, { now: 0, random: seededRandom(3), hostId: null });
    expect(s.players.filter((p) => p.isSpy)).toHaveLength(1);
    const spyId = s.players.find((p) => p.isSpy)!.id;
    const civ = s.players.find((p) => !p.isSpy)!.id;
    expect(E.getPlayerView(s, spyId)).toMatchObject({ isSpy: true, location: null, role: null });
    expect(E.getPlayerView(s, civ)!.location!.id).toBe(s.locationId);
    // публічний стан не видає ні шпигуна, ні локації
    const pub = E.getPublicState(s, 0);
    expect(pub.location).toBeNull();
    expect(pub.players.every((p) => p.isSpy === null)).toBe(true);
    expect(pub.locations).toHaveLength(LOCATIONS.length);
  });

  it('не можна почати вдвох', () => {
    expect(() => setup(2)).toThrow(GameError);
  });

  it('черга питань: питає лише той, чия черга, і не можна одразу повертати питання', () => {
    let s = toQuestions(setup());
    expect(() => act(s, 'c', { type: 'ask', target: 'd' })).toThrow(/інший/);
    s = act(s, 'b', { type: 'ask', target: 'c' });
    expect(s.askerId).toBe('c');
    expect(() => act(s, 'c', { type: 'ask', target: 'b' })).toThrow(/щойно/);
    s = act(s, 'c', { type: 'ask', target: 'd' });
    expect(s.askerId).toBe('d');
  });

  it('одноголосне звинувачення шпигуна — перемога мешканців', () => {
    let s = toQuestions(setup());
    s = act(s, 'b', { type: 'accuse', target: 'a' });
    expect(s.phase).toBe('ACCUSATION');
    for (const v of ['c', 'd', 'e']) s = act(s, v, { type: 'accuse_vote', yes: true });
    expect(s.phase).toBe('GAME_OVER');
    expect(s.winner).toBe('locals');
    expect(s.outcome).toBe('spy_caught');
  });

  it('засудили невинного — перемога шпигуна', () => {
    let s = toQuestions(setup());
    s = act(s, 'a', { type: 'accuse', target: 'b' }); // шпигун підставляє мешканця
    for (const v of ['c', 'd', 'e']) s = act(s, v, { type: 'accuse_vote', yes: true });
    expect(s.winner).toBe('spy');
    expect(s.outcome).toBe('innocent_convicted');
  });

  it('одне «ні» — раунд триває з тим самим залишком часу, звинувачення витрачене', () => {
    let s = toQuestions(setup());
    clock += 60_000;
    const left = s.timer.endsAt! - clock;
    s = act(s, 'b', { type: 'accuse', target: 'c' });
    clock += 20_000;
    s = act(s, 'd', { type: 'accuse_vote', yes: false });
    expect(s.phase).toBe('QUESTIONS');
    expect(s.timer.endsAt! - clock).toBe(left);
    expect(() => act(s, 'b', { type: 'accuse', target: 'd' })).toThrow(/вже/);
  });

  it('шпигун вгадав локацію — перемога; помилився — програш', () => {
    let s = toQuestions(setup());
    const right = act(s, 'a', { type: 'guess', locationId: s.locationId });
    expect(right.winner).toBe('spy');
    const wrongId = LOCATIONS.find((l) => l.id !== s.locationId)!.id;
    const wrong = act(s, 'a', { type: 'guess', locationId: wrongId });
    expect(wrong.winner).toBe('locals');
    expect(() => act(s, 'b', { type: 'guess', locationId: s.locationId })).toThrow(/лише шпигун/);
  });

  it('час вийшов: фінальне голосування; лідер-шпигун — перемога мешканців, нічия — шпигуна', () => {
    let s = timeout(toQuestions(setup()));
    expect(s.phase).toBe('FINAL_VOTE');
    for (const v of ['b', 'c', 'd', 'e']) s = act(s, v, { type: 'final_vote', target: 'a' });
    s = act(s, 'a', { type: 'final_vote', target: 'b' });
    expect(s.outcome).toBe('final_caught');

    let t = timeout(toQuestions(setup()));
    t = act(t, 'a', { type: 'final_vote', target: 'b' });
    t = act(t, 'b', { type: 'final_vote', target: 'c' });
    t = timeout(t); // решта не встигла: 1:1 нічия
    expect(t.winner).toBe('spy');
    expect(t.outcome).toBe('final_missed');
  });

  it('у кінці відкриваються локація й шпигун', () => {
    let s = toQuestions(setup());
    s = act(s, 'a', { type: 'guess', locationId: s.locationId });
    const pub = E.getPublicState(s, clock);
    expect(pub.location!.id).toBe(s.locationId);
    expect(pub.players.find((p) => p.id === 'a')!.isSpy).toBe(true);
    expect(E.getResult(s)!.players.find((p) => p.id === 'a')).toMatchObject({ role: 'spy', won: true });
  });

  it('усі чують усіх', () => {
    const s = toQuestions(setup());
    expect(E.getAudioPolicy(s).hear.b).toEqual(['a', 'c', 'd', 'e']);
  });
});
