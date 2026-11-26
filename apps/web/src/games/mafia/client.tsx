import { useState } from 'react';
import {
  PHASE_TITLE,
  ROLE_INFO,
  ROLE_ORDER,
  TEAM_TITLE,
  type ChronicleEntry,
  type MafiaPlayerView,
  type MafiaPublicState,
  type Role,
} from '@jvof/game-mafia';
import { sounds } from '../../lib/sounds';
import { useCountdown } from '../../lib/useCountdown';
import { toastError } from '../../store/ui';
import type { ClientGame, GameProps } from '../types';

export const ROLE_EMOJI: Record<Role, string> = { civilian: '🙂', sheriff: '⭐', doctor: '💉', mafia: '🔫', don: '🎩' };

const pub = (p: GameProps) => p.publicState as MafiaPublicState;
const viewOf = (p: GameProps) => p.view as MafiaPlayerView | null;

// ---------- верхня панель: фаза й таймер ----------

function Bar(p: GameProps) {
  const g = pub(p);
  const left = useCountdown(g.endsAt, g.remainingMs, g.paused, p.serverNow);
  const night = g.phase === 'NIGHT';
  const title =
    g.phase === 'NIGHT' ? `${night ? '🌙' : ''} Ніч ${g.round}` : g.phase === 'GAME_OVER' ? '🏁 Кінець гри' : g.phase === 'ROLE_ASSIGN' ? '🎭 Роздача ролей' : `☀️ День ${g.round} · ${PHASE_TITLE[g.phase]}`;
  let sub = p.room.policy.note;
  if (g.phase === 'DAY_DISCUSSION' && g.speakerId) sub = g.speakerTimeUp ? `Час ${p.nick(g.speakerId)} вийшов` : `Говорить ${p.nick(g.speakerId)}`;
  if (g.phase === 'EXECUTION' && g.execution?.speech) sub = `Остання промова: ${p.nick(g.execution.targetId)}`;
  return (
    <div className={`phase-bar ${night ? 'night' : ''}`}>
      <div className="grow">
        <div className="phase-title">{title}</div>
        <div className="faint">{sub}</div>
      </div>
      {g.paused && <span className="badge warn">⏸ пауза</span>}
      <span className="badge">{g.hostMode === 'human' ? `Ведучий: ${p.nick(g.hostId)}` : 'Авто-ведучий'}</span>
      {left !== null && <span className={`timer ${left <= 5 ? 'low' : ''}`}>{formatTime(left)}</span>}
    </div>
  );
}

const formatTime = (s: number) => `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`;

// ---------- бокова панель гри ----------

function RoleCard({ role, alive, teammates, nick }: { role: Role; alive: boolean; teammates: { id: string; role: Role }[]; nick: GameProps['nick'] }) {
  const info = ROLE_INFO[role];
  return (
    <div className={`role-card ${info.team}`}>
      <div className="role-emoji">{ROLE_EMOJI[role]}</div>
      <div className="grow">
        <div className="faint">Ваша роль{!alive && ' · ви вибули'}</div>
        <div style={{ fontWeight: 800, fontSize: '1.15rem' }}>{info.title}</div>
        <div className="faint">{info.description}</div>
        {teammates.length > 0 && (
          <div style={{ marginTop: '0.3rem', fontSize: '0.9rem' }}>
            Ваша команда: {teammates.map((t) => `${nick(t.id)} (${ROLE_INFO[t.role].title})`).join(', ')}
          </div>
        )}
      </div>
    </div>
  );
}

function Targets({ ids, selected, onPick, nick, seat, disabled }: { ids: string[]; selected: string | null; onPick: (id: string) => void; nick: GameProps['nick']; seat: (id: string) => number; disabled?: boolean }) {
  return (
    <div className="targets">
      {ids.map((id) => (
        <button key={id} className={`btn sm ${selected === id ? 'selected' : ''}`} disabled={disabled} onClick={() => onPick(id)}>
          <b>{seat(id)}</b> {nick(id)}
        </button>
      ))}
    </div>
  );
}

function NightActions(p: GameProps) {
  const g = pub(p);
  const v = viewOf(p);
  const [busy, setBusy] = useState(false);
  if (!v?.night) return null;
  const n = v.night;
  const alive = g.players.filter((x) => x.alive);
  const seat = (id: string) => g.players.find((x) => x.id === id)?.seat ?? 0;
  const mates = new Set([p.meId, ...v.teammates.map((t) => t.id)]);
  const send = async (kind: 'kill' | 'check' | 'heal', target: string) => {
    setBusy(true);
    try {
      await p.act({ type: 'night', kind, target });
    } catch (e) {
      toastError(e);
    } finally {
      setBusy(false);
    }
  };
  const lastCheck = v.checks.filter((c) => c.round === g.round).at(-1);

  return (
    <div className="col">
      {n.canKill && (
        <div className="card tight col">
          <h3>🔫 Кого вбити цієї ночі?</h3>
          {v.me?.role === 'don' ? <div className="faint">Остаточне рішення за вами як за доном.</div> : <div className="faint">Остаточно обирає дон (якщо він живий).</div>}
          <Targets ids={alive.filter((x) => !mates.has(x.id)).map((x) => x.id)} selected={n.myKill} onPick={(id) => send('kill', id)} nick={p.nick} seat={seat} disabled={busy} />
          {Object.keys(n.teamVotes).length > 0 && (
            <div className="faint">
              Вибір команди: {Object.entries(n.teamVotes).map(([who, t]) => `${p.nick(who)} → ${p.nick(t)}`).join('; ')}
            </div>
          )}
        </div>
      )}
      {n.check && (
        <div className="card tight col">
          <h3>{n.check === 'sheriff' ? '⭐ Кого перевірити?' : '🎩 Шукаємо шерифа: кого перевірити?'}</h3>
          {n.myCheck ? (
            lastCheck && (
              <div className={`banner ${lastCheck.result === (n.check === 'sheriff') ? 'mafia' : 'civilians'}`}>
                {p.nick(lastCheck.targetId)}{' '}
                {n.check === 'sheriff' ? (lastCheck.result ? '— мафія!' : '— не мафія') : lastCheck.result ? '— шериф!' : '— не шериф'}
              </div>
            )
          ) : (
            <Targets ids={alive.filter((x) => x.id !== p.meId).map((x) => x.id)} selected={null} onPick={(id) => send('check', id)} nick={p.nick} seat={seat} disabled={busy} />
          )}
        </div>
      )}
      {n.canHeal && (
        <div className="card tight col">
          <h3>💉 Кого врятувати?</h3>
          {n.cannotHealSelf && <div className="faint">Себе цієї ночі лікувати не можна.</div>}
          <Targets
            ids={alive.filter((x) => !(n.cannotHealSelf && x.id === p.meId)).map((x) => x.id)}
            selected={n.myHeal}
            onPick={(id) => send('heal', id)}
            nick={p.nick}
            seat={seat}
            disabled={busy}
          />
        </div>
      )}
      {!n.canKill && !n.check && !n.canHeal && (
        <div className="banner">{g.round === 1 && !g.settings.firstNightKill ? '🌙 Знайомча ніч. Мафія знайомиться, місто спить.' : '🌙 Місто спить. Чекайте ранку.'}</div>
      )}
    </div>
  );
}

function Voting(p: GameProps) {
  const g = pub(p);
  const v = viewOf(p);
  const [busy, setBusy] = useState(false);
  if (!g.voting) return null;
  const seat = (id: string) => g.players.find((x) => x.id === id)?.seat ?? 0;
  const canVote = !!v?.me?.alive;
  const vote = async (target: string) => {
    setBusy(true);
    try {
      await p.act({ type: 'vote', target });
    } catch (e) {
      toastError(e);
    } finally {
      setBusy(false);
    }
  };
  return (
    <div className="card tight col">
      <h3>{g.voting.round === 2 ? '⚖️ Переголосування між лідерами' : '🗳 Кого стратити?'}</h3>
      {canVote ? (
        <>
          <Targets ids={g.voting.candidates.filter((c) => c !== p.meId)} selected={v?.myVote ?? null} onPick={vote} nick={p.nick} seat={seat} disabled={busy} />
          <button className={`btn sm ${v?.myVote === 'skip' ? 'selected' : ''}`} disabled={busy} onClick={() => vote('skip')}>
            Утриматися
          </button>
        </>
      ) : (
        <div className="faint">Ви не голосуєте.</div>
      )}
      <div className="faint">
        Проголосували: {g.voting.votedIds.length} з {g.players.filter((x) => x.alive).length}
      </div>
    </div>
  );
}

function Chronicle({ entries, nick }: { entries: ChronicleEntry[]; nick: GameProps['nick'] }) {
  if (!entries.length) return null;
  return (
    <details className="card tight" open={false}>
      <summary style={{ cursor: 'pointer', fontWeight: 700 }}>Хроніка партії</summary>
      <div className="col" style={{ marginTop: '0.6rem', gap: '0.35rem', fontSize: '0.9rem' }}>
        {entries.map((e, i) => (
          <div key={i}>{chronicleText(e, nick)}</div>
        ))}
      </div>
    </details>
  );
}

export function chronicleText(e: ChronicleEntry, nick: (id: string | null | undefined) => string): string {
  switch (e.kind) {
    case 'night':
      return `🌙 Ніч ${e.round}: ${e.killedId ? `загинув(ла) ${nick(e.killedId)}` : 'ніхто не загинув'}`;
    case 'vote': {
      const votes = Object.entries(e.votes)
        .map(([who, t]) => `${nick(who)} → ${t === 'skip' ? 'утримався' : nick(t)}`)
        .join(', ');
      return `🗳 День ${e.round}${e.voteRound === 2 ? ' (переголосування)' : ''}: ${votes || 'ніхто не голосував'}`;
    }
    case 'execution':
      return `⚖️ День ${e.round}: ${e.outcome === 'executed' ? `страчено ${nick(e.targetId)}` : e.outcome === 'tie' ? 'знову нічия — ніхто не страчений' : 'ніхто не страчений'}`;
    case 'left':
      return `🚪 ${nick(e.playerId)} покинув(ла) гру`;
  }
}

function Summary(p: GameProps) {
  const g = pub(p);
  const v = viewOf(p);
  const roles = v?.roles ?? Object.fromEntries(g.players.map((x) => [x.id, x.role]));
  return (
    <div className="col">
      <div className={`banner ${g.winner ?? ''}`}>
        {g.aborted ? 'Партію зупинено' : g.winner === 'mafia' ? '🔫 Перемогла мафія!' : '🎉 Перемогли мирні!'}
      </div>
      <table className="table">
        <tbody>
          {g.players.map((x) => {
            const r = roles[x.id] as Role | null;
            return (
              <tr key={x.id} style={{ opacity: x.alive ? 1 : 0.6 }}>
                <td>{x.seat}</td>
                <td>{p.nick(x.id)}</td>
                <td>{r ? `${ROLE_EMOJI[r]} ${ROLE_INFO[r].title}` : '—'}</td>
                <td className="faint">{x.alive ? 'живий' : 'вибув'}</td>
              </tr>
            );
          })}
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

function HostPanel(p: GameProps) {
  const g = pub(p);
  const v = viewOf(p);
  if (v?.kind !== 'host' || g.phase === 'GAME_OVER') return null;
  const night = v.hostNight;
  const has = (r: Role) => g.roleCounts[r] > 0;
  return (
    <div className="card tight col">
      <h3>🎙 Панель ведучого</h3>
      <button className="btn primary" onClick={() => p.control('next').catch(toastError)}>
        {g.phase === 'DAY_DISCUSSION' ? 'Наступний промовець ▶' : 'Наступна фаза ▶'}
      </button>
      <table className="table">
        <tbody>
          {g.players.map((x) => {
            const r = v.roles?.[x.id];
            return (
              <tr key={x.id} style={{ opacity: x.alive ? 1 : 0.5 }}>
                <td>{x.seat}</td>
                <td>{p.nick(x.id)}</td>
                <td>{r ? `${ROLE_EMOJI[r]} ${ROLE_INFO[r].title}` : ''}</td>
              </tr>
            );
          })}
        </tbody>
      </table>
      {night && (
        <div className="faint col" style={{ gap: '0.2rem' }}>
          <div>Мафія: {Object.entries(night.mafiaVotes).map(([a, t]) => `${p.nick(a)} → ${p.nick(t)}`).join('; ') || '—'}</div>
          {has('sheriff') && <div>Шериф перевіряє: {night.sheriffCheck ? p.nick(night.sheriffCheck) : '—'}</div>}
          {has('don') && <div>Дон перевіряє: {night.donCheck ? p.nick(night.donCheck) : '—'}</div>}
          {has('doctor') && <div>Лікар рятує: {night.doctorHeal ? p.nick(night.doctorHeal) : '—'}</div>}
        </div>
      )}
    </div>
  );
}

function Panel(p: GameProps) {
  const g = pub(p);
  const v = viewOf(p);
  const [ending, setEnding] = useState(false);
  const isSpeaker = (g.phase === 'DAY_DISCUSSION' && g.speakerId === p.meId) || (g.phase === 'EXECUTION' && g.execution?.speech && g.execution.targetId === p.meId);
  const endSpeech = async () => {
    setEnding(true);
    try {
      await p.act({ type: 'end_speech' });
    } catch (e) {
      toastError(e);
    } finally {
      setEnding(false);
    }
  };

  return (
    <div className="col">
      {v?.me && <RoleCard role={v.me.role} alive={v.me.alive} teammates={v.teammates} nick={p.nick} />}
      {!v?.me && v?.kind !== 'host' && g.phase !== 'GAME_OVER' && <div className="banner">👀 Ви дивитесь як глядач</div>}
      <HostPanel {...p} />

      {g.phase === 'ROLE_ASSIGN' && <div className="banner">Запам'ятайте свою роль. Скоро настане ніч.</div>}
      {g.phase === 'NIGHT' && <NightActions {...p} />}
      {g.phase === 'DAY_ANNOUNCE' && g.lastNight && (
        <div className="banner">{g.lastNight.killedId ? `☠️ Цієї ночі загинув(ла) ${p.nick(g.lastNight.killedId)}` : '🌅 Цієї ночі ніхто не загинув'}</div>
      )}
      {g.phase === 'DAY_DISCUSSION' && (
        <div className="card tight col">
          <h3>Черга промов</h3>
          <ol style={{ margin: 0, paddingLeft: '1.3rem' }}>
            {g.order.map((id, i) => (
              <li key={id} style={{ fontWeight: i === g.orderIndex ? 800 : 400, opacity: i < g.orderIndex ? 0.5 : 1 }}>
                {p.nick(id)} {i === g.orderIndex && '🎤'}
              </li>
            ))}
          </ol>
        </div>
      )}
      {g.phase === 'VOTING' && <Voting {...p} />}
      {g.phase === 'EXECUTION' && g.execution && (
        <div className="banner">
          {g.execution.outcome === 'executed' ? `⚖️ Місто стратило ${p.nick(g.execution.targetId)}` : g.execution.outcome === 'tie' ? '⚖️ Знову нічия — ніхто не страчений' : '⚖️ Сьогодні ніхто не страчений'}
        </div>
      )}
      {isSpeaker && (
        <button className="btn primary lg" onClick={endSpeech} disabled={ending}>
          Завершити промову
        </button>
      )}
      {g.phase === 'GAME_OVER' && <Summary {...p} />}

      {v?.checks && v.checks.length > 0 && v.me && (
        <div className="card tight col">
          <h3>Мої перевірки</h3>
          {v.checks.map((c, i) => (
            <div key={i} className="faint">
              Ніч {c.round}: {p.nick(c.targetId)} — {c.by === 'sheriff' ? (c.result ? 'мафія' : 'не мафія') : c.result ? 'шериф' : 'не шериф'}
            </div>
          ))}
        </div>
      )}

      <div className="faint">
        Склад:{' '}
        {ROLE_ORDER.filter((r) => g.roleCounts[r] > 0)
          .map((r) => `${ROLE_EMOJI[r]} ${ROLE_INFO[r].title} ×${g.roleCounts[r]}`)
          .join(' · ')}
      </div>
      <Chronicle entries={g.chronicle} nick={p.nick} />
    </div>
  );
}

// ---------- плитки та звуки ----------

export const mafiaClient: ClientGame = {
  Bar,
  Panel,
  tile(ps, view, userId) {
    const g = ps as MafiaPublicState;
    const v = view as MafiaPlayerView | null;
    const pl = g.players.find((x) => x.id === userId);
    if (!pl) return userId === g.hostId ? { badge: '🎙 ведучий' } : { badge: 'глядач' };
    const known: Role | null = pl.role ?? v?.roles?.[userId] ?? v?.teammates.find((t) => t.id === userId)?.role ?? (v?.me?.id === userId ? v.me.role : null);
    return {
      seat: pl.seat,
      dead: !pl.alive,
      turn: g.speakerId === userId,
      role: known ? `${ROLE_EMOJI[known]} ${ROLE_INFO[known].title}` : undefined,
    };
  },
  order(ps, members) {
    const g = ps as MafiaPublicState;
    const seated = [...g.players].sort((a, b) => a.seat - b.seat).map((x) => x.id);
    const rest = members.map((m) => m.id).filter((id) => !seated.includes(id));
    return [...seated, ...rest];
  },
  onChange(prev, next, view, meId) {
    const a = prev as MafiaPublicState | null;
    const b = next as MafiaPublicState;
    if (!a || a.phaseKey !== b.phaseKey || a.phase !== b.phase) {
      if (b.phase === 'NIGHT') sounds.night();
      else if (b.phase === 'DAY_ANNOUNCE') sounds.day();
      else if (b.phase === 'VOTING') sounds.vote();
      else if (b.phase === 'GAME_OVER') sounds.gameOver();
    }
    if (b.speakerId === meId && a?.speakerId !== meId) sounds.yourTurn();
    void view;
  },
};

export { TEAM_TITLE };
