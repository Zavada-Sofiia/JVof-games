import { useState } from 'react';
import { type SpyOutcome, type SpyPhase, type SpyPlayerView, type SpyPublicState } from '@jvof/game-spyfall';
import { Modal } from '../../components/ui';
import { sounds } from '../../lib/sounds';
import { useCountdown } from '../../lib/useCountdown';
import { toastError } from '../../store/ui';
import type { ClientGame, GameProps } from '../types';

const pub = (p: GameProps) => p.publicState as SpyPublicState;
const viewOf = (p: GameProps) => p.view as SpyPlayerView | null;
const fmt = (s: number) => `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`;

const PHASE_TITLE: Record<SpyPhase, string> = {
  ROLE_REVEAL: '🕵️ Хто де?',
  QUESTIONS: '❓ Питання',
  ACCUSATION: '☝️ Звинувачення',
  FINAL_VOTE: '🗳 Фінальне голосування',
  GAME_OVER: '🏁 Кінець гри',
};

export const OUTCOME_TEXT: Record<SpyOutcome, (spyName: string, guessedLocation: string) => string> = {
  spy_caught: (spy) => `Шпигуна ${spy} викрили одноголосно!`,
  innocent_convicted: () => 'Засудили невинного — шпигун вислизнув',
  spy_guessed: (_spy, l) => `Шпигун вгадав локацію: ${l}`,
  spy_missed: () => 'Шпигун розкрився, але не вгадав локацію',
  final_caught: () => 'Фінальне голосування вказало на шпигуна!',
  final_missed: () => 'Фінальне голосування помилилось — шпигун переміг',
  stopped: () => 'Партію зупинено',
};

function Bar(p: GameProps) {
  const g = pub(p);
  const left = useCountdown(g.endsAt, g.remainingMs, g.paused, p.serverNow);
  let sub = 'Усі говорять вільно';
  if (g.phase === 'QUESTIONS') sub = `Питає ${p.nick(g.askerId)}`;
  if (g.phase === 'ACCUSATION' && g.accusation) sub = `${p.nick(g.accusation.accuserId)} звинувачує ${p.nick(g.accusation.accusedId)}`;
  if (g.phase === 'ROLE_REVEAL') sub = 'Подивіться свою картку';
  return (
    <div className="phase-bar">
      <div className="grow">
        <div className="phase-title">{PHASE_TITLE[g.phase]}</div>
        <div className="faint">{sub}</div>
      </div>
      {g.paused && <span className="badge warn">⏸ пауза</span>}
      {g.phase === 'ACCUSATION' && g.roundRemainingMs !== null && <span className="badge">раунд: {fmt(Math.ceil(g.roundRemainingMs / 1000))}</span>}
      {left !== null && <span className={`timer ${left <= 10 ? 'low' : ''}`}>{fmt(left)}</span>}
    </div>
  );
}

function MyCard({ v }: { v: SpyPlayerView }) {
  return v.isSpy ? (
    <div className="role-card mafia">
      <div className="role-emoji">🕵️</div>
      <div className="grow">
        <div className="faint">Ваша роль</div>
        <div style={{ fontWeight: 800, fontSize: '1.15rem' }}>Ви — шпигун</div>
        <div className="faint">Ви не знаєте, де всі. Слухайте, не видайте себе й спробуйте вгадати локацію.</div>
      </div>
    </div>
  ) : (
    <div className="role-card civilians">
      <div className="role-emoji">{v.location!.emoji}</div>
      <div className="grow">
        <div className="faint">Локація</div>
        <div style={{ fontWeight: 800, fontSize: '1.15rem' }}>{v.location!.title}</div>
        <div className="faint">{v.role ? `Ваша роль: ${v.role}. ` : ''}Шукайте того, хто не в темі.</div>
      </div>
    </div>
  );
}

function Panel(p: GameProps) {
  const g = pub(p);
  const v = viewOf(p);
  const [busy, setBusy] = useState(false);
  const [accuse, setAccuse] = useState(false);
  const [guess, setGuess] = useState<{ id: string; title: string } | null>(null);
  const me = g.players.find((x) => x.id === p.meId);
  const others = g.players.filter((x) => x.id !== p.meId);
  const run = async (action: unknown) => {
    setBusy(true);
    try {
      await p.act(action);
    } catch (e) {
      toastError(e);
    } finally {
      setBusy(false);
    }
  };

  if (g.phase === 'GAME_OVER') return <Summary {...p} />;

  return (
    <div className="col">
      {v ? <MyCard v={v} /> : <div className="banner">👀 Ви дивитесь як глядач</div>}

      {g.phase === 'QUESTIONS' && (
        <div className="card tight col">
          <h3>❓ Черга питань</h3>
          {g.lastQuestion && (
            <div className="faint">
              Останнє: {p.nick(g.lastQuestion.from)} → {p.nick(g.lastQuestion.to)}
            </div>
          )}
          {g.askerId === p.meId ? (
            <>
              <div>Ваша черга питати. Кому ставите питання?</div>
              <div className="targets">
                {others
                  .filter((x) => !(g.lastQuestion?.from === x.id && g.lastQuestion.to === p.meId && g.players.length > 2))
                  .map((x) => (
                    <button key={x.id} className="btn sm" disabled={busy} onClick={() => run({ type: 'ask', target: x.id })}>
                      <b>{x.seat}</b> {x.nickname}
                    </button>
                  ))}
              </div>
            </>
          ) : (
            <div className="banner">Питає {p.nick(g.askerId)}</div>
          )}
          <div className="faint">Питань поставлено: {g.questionCount}</div>
        </div>
      )}

      {g.phase === 'QUESTIONS' && me && (
        <button className="btn danger" disabled={me.usedAccusation} onClick={() => setAccuse(true)}>
          {me.usedAccusation ? 'Звинувачення вже використано' : '☝️ Звинуватити гравця'}
        </button>
      )}

      {g.phase === 'ACCUSATION' && g.accusation && (
        <div className="card tight col">
          <h3>
            ☝️ {p.nick(g.accusation.accuserId)} звинувачує {p.nick(g.accusation.accusedId)}
          </h3>
          <div className="faint">Потрібна одностайність: якщо хоч хтось проти — гра триває.</div>
          {me && g.accusation.accusedId !== p.meId ? (
            v?.myAccuseVote !== null && v?.myAccuseVote !== undefined ? (
              <div className="banner">Ваш голос: {v.myAccuseVote ? 'так' : 'ні'}</div>
            ) : (
              <div className="row">
                <button className="btn primary grow" disabled={busy} onClick={() => run({ type: 'accuse_vote', yes: true })}>
                  Так, це шпигун
                </button>
                <button className="btn grow" disabled={busy} onClick={() => run({ type: 'accuse_vote', yes: false })}>
                  Ні
                </button>
              </div>
            )
          ) : (
            g.accusation.accusedId === p.meId && <div className="banner mafia">Вас звинуватили! Переконайте інших.</div>
          )}
          <div className="faint">
            Проголосували: {g.accusation.votedIds.length} з {g.players.length - 1}
          </div>
        </div>
      )}

      {g.phase === 'FINAL_VOTE' && (
        <div className="card tight col">
          <h3>🗳 Хто шпигун?</h3>
          <div className="faint">Час вийшов. Якщо більшість вкаже на шпигуна — мешканці перемагають.</div>
          {me && (
            <div className="targets">
              {others.map((x) => (
                <button key={x.id} className={`btn sm ${v?.myFinalVote === x.id ? 'selected' : ''}`} disabled={busy} onClick={() => run({ type: 'final_vote', target: x.id })}>
                  <b>{x.seat}</b> {x.nickname}
                </button>
              ))}
            </div>
          )}
          <div className="faint">
            Проголосували: {g.finalVotedIds.length} з {g.players.length}
          </div>
        </div>
      )}

      <LocationBoard
        gameId={p.room.game?.id ?? 'none'}
        locations={g.locations}
        mine={v?.location?.id ?? null}
        isSpy={!!v?.isSpy}
        canGuess={!!v?.isSpy && (g.phase === 'QUESTIONS' || g.phase === 'ROLE_REVEAL')}
        onGuess={setGuess}
      />

      {accuse && (
        <Modal title="Кого звинуватити?" onClose={() => setAccuse(false)}>
          <p className="muted">Звинуватити можна лише раз за гру. Таймер раунду стане на паузу, поки всі голосують.</p>
          <div className="targets">
            {others.map((x) => (
              <button
                key={x.id}
                className="btn sm"
                onClick={() => {
                  setAccuse(false);
                  void run({ type: 'accuse', target: x.id });
                }}
              >
                <b>{x.seat}</b> {x.nickname}
              </button>
            ))}
          </div>
        </Modal>
      )}
      {guess && (
        <Modal title={`Назвати «${guess.title}»?`} onClose={() => setGuess(null)}>
          <p>Ви розкриєтесь як шпигун. Вгадаєте — перемога, ні — програш. Це остаточно.</p>
          <div className="row">
            <span className="spacer" />
            <button className="btn" onClick={() => setGuess(null)}>
              Скасувати
            </button>
            <button
              className="btn primary"
              onClick={() => {
                const id = guess.id;
                setGuess(null);
                void run({ type: 'guess', locationId: id });
              }}
            >
              Розкритися
            </button>
          </div>
        </Modal>
      )}
    </div>
  );
}

type Loc = { id: string; title: string; emoji: string };

/** Закреслення шпигуна живуть лише в його браузері (окремо для кожної партії) */
function useCrossed(gameId: string) {
  const key = `jvof-spy-crossed:${gameId}`;
  const [crossed, setCrossed] = useState<Set<string>>(() => {
    try {
      // закреслення старих партій більше не потрібні
      for (const k of Object.keys(localStorage)) if (k.startsWith('jvof-spy-crossed:') && k !== key) localStorage.removeItem(k);
      return new Set(JSON.parse(localStorage.getItem(key) ?? '[]') as string[]);
    } catch {
      return new Set();
    }
  });
  const save = (next: Set<string>) => {
    setCrossed(next);
    try {
      localStorage.setItem(key, JSON.stringify([...next]));
    } catch {
      /* немає місця — не страшно */
    }
  };
  return {
    crossed,
    toggle: (id: string) => {
      const next = new Set(crossed);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      save(next);
    },
    clear: () => save(new Set()),
  };
}

/** Усі локації: пошук; шпигун закреслює зайві й може назвати свою */
function LocationBoard({
  gameId,
  locations,
  mine,
  isSpy,
  canGuess,
  onGuess,
}: {
  gameId: string;
  locations: Loc[];
  mine: string | null;
  isSpy: boolean;
  canGuess: boolean;
  onGuess: (l: Loc) => void;
}) {
  const [query, setQuery] = useState('');
  const [mode, setMode] = useState<'cross' | 'guess'>('cross');
  const { crossed, toggle, clear } = useCrossed(gameId);
  const q = query.trim().toLowerCase();
  const shown = q ? locations.filter((l) => l.title.toLowerCase().includes(q)) : locations;
  const guessing = canGuess && mode === 'guess';

  return (
    <div className="card tight col">
      <div className="row">
        <h3 className="grow" style={{ margin: 0 }}>
          📍 Локації ({locations.length})
        </h3>
        {isSpy && crossed.size > 0 && (
          <span className="faint">
            закреслено {crossed.size} ·{' '}
            <button className="btn ghost sm" style={{ padding: '0 0.3rem' }} onClick={clear}>
              очистити
            </button>
          </span>
        )}
      </div>
      {isSpy && (
        <div className="tabs">
          <button className={`tab ${mode === 'cross' ? 'active' : ''}`} onClick={() => setMode('cross')}>
            ✏️ Закреслювати
          </button>
          <button className={`tab ${mode === 'guess' ? 'active' : ''}`} disabled={!canGuess} onClick={() => setMode('guess')} title={canGuess ? '' : 'Під час голосування вгадувати не можна'}>
            🎯 Назвати локацію
          </button>
        </div>
      )}
      {isSpy && (
        <div className="faint">
          {guessing ? 'Натисніть локацію, щоб розкритися й назвати її. Вгадаєте — перемога, ні — програш.' : 'Натискайте локації, які точно не підходять, — вони закресляться. Це бачите лише ви.'}
        </div>
      )}
      <input className="input" placeholder="Пошук локації…" value={query} onChange={(e) => setQuery(e.target.value)} aria-label="Пошук локації" />
      <div className="targets loc-board">
        {shown.map((l) => {
          const isCrossed = isSpy && crossed.has(l.id);
          return (
            <button
              key={l.id}
              className={`btn sm loc ${l.id === mine ? 'selected' : ''} ${isCrossed ? 'crossed' : ''} ${guessing ? 'guessing' : ''}`}
              disabled={!isSpy && l.id !== mine}
              onClick={() => (guessing ? onGuess(l) : isSpy ? toggle(l.id) : undefined)}
              title={isSpy ? (guessing ? `Назвати «${l.title}»` : isCrossed ? 'Повернути' : 'Закреслити') : undefined}
              aria-label={`${l.title}${isCrossed ? ' (закреслено)' : ''}`}
              aria-pressed={isSpy && !guessing ? isCrossed : undefined}
            >
              {l.emoji} {l.title}
            </button>
          );
        })}
        {shown.length === 0 && <div className="faint">Нічого не знайдено</div>}
      </div>
    </div>
  );
}

function Summary(p: GameProps) {
  const g = pub(p);
  const spyP = g.players.find((x) => x.isSpy);
  const locTitle = g.locations.find((l) => l.id === g.outcomeTarget)?.title ?? '';
  return (
    <div className="col">
      <div className={`banner ${g.winner === 'spy' ? 'mafia' : g.winner === 'locals' ? 'civilians' : ''}`}>
        {g.winner === 'spy' ? '🕵️ Переміг шпигун!' : g.winner === 'locals' ? '🎉 Перемогли мешканці!' : 'Партію зупинено'}
      </div>
      {g.outcome && <div className="muted">{OUTCOME_TEXT[g.outcome](spyP?.nickname ?? '', locTitle)}</div>}
      {g.location && (
        <div className="role-card civilians">
          <div className="role-emoji">{g.location.emoji}</div>
          <div>
            <div className="faint">Локація була</div>
            <div style={{ fontWeight: 800, fontSize: '1.15rem' }}>{g.location.title}</div>
          </div>
        </div>
      )}
      <table className="table">
        <tbody>
          {g.players.map((x) => (
            <tr key={x.id}>
              <td>{x.seat}</td>
              <td>{x.nickname}</td>
              <td>{x.isSpy ? '🕵️ Шпигун' : (x.role ?? 'Мешканець')}</td>
            </tr>
          ))}
        </tbody>
      </table>
      {p.isAdmin && (
        <button className="btn primary" onClick={() => p.control('rematch').catch(toastError)}>
          Реванш
        </button>
      )}
    </div>
  );
}

export const spyfallClient: ClientGame = {
  Bar,
  Panel,
  tile(ps, view, userId) {
    const g = ps as SpyPublicState;
    const pl = g.players.find((x) => x.id === userId);
    if (!pl) return { badge: 'глядач' };
    const v = view as SpyPlayerView | null;
    void v;
    return {
      seat: pl.seat,
      turn: g.phase === 'QUESTIONS' && g.askerId === userId,
      role: g.phase === 'GAME_OVER' ? (pl.isSpy ? '🕵️ Шпигун' : (pl.role ?? 'Мешканець')) : undefined,
      badge: g.accusation?.accusedId === userId ? '☝️ під підозрою' : undefined,
    };
  },
  order(ps, members) {
    const g = ps as SpyPublicState;
    const seated = [...g.players].sort((a, b) => a.seat - b.seat).map((x) => x.id);
    return [...seated, ...members.map((m) => m.id).filter((id) => !seated.includes(id))];
  },
  onChange(prev, next, _view, meId) {
    const a = prev as SpyPublicState | null;
    const b = next as SpyPublicState;
    if (!a || a.phase !== b.phase) {
      if (b.phase === 'QUESTIONS') sounds.day();
      else if (b.phase === 'ACCUSATION' || b.phase === 'FINAL_VOTE') sounds.vote();
      else if (b.phase === 'GAME_OVER') sounds.gameOver();
    }
    if (b.phase === 'QUESTIONS' && b.askerId === meId && a?.askerId !== meId) sounds.yourTurn();
  },
};
