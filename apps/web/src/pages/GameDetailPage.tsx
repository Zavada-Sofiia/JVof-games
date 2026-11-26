import { useEffect, useState } from 'react';
import { Link, useParams } from 'react-router';
import type { GameDetailDto } from '@jvof/shared';
import { ROLE_INFO, TEAM_TITLE, type ChronicleEntry, type Role, type Team } from '@jvof/game-mafia';
import { Avatar, Spinner, timeAgo } from '../components/ui';
import { ROLE_EMOJI, chronicleText } from '../games/mafia/client';
import { api } from '../lib/api';

/** Розбір партії: хто ким був, хроніка ночей і голосувань (будується з журналу game_events) */
export default function GameDetailPage() {
  const { id } = useParams();
  const [game, setGame] = useState<GameDetailDto | null>(null);
  const [error, setError] = useState('');
  useEffect(() => {
    api<GameDetailDto>(`/games/${id}`)
      .then(setGame)
      .catch((e: Error) => setError(e.message));
  }, [id]);

  if (error)
    return (
      <div className="page medium">
        <p className="error-text">{error}</p>
        <Link to="/profile">До профілю</Link>
      </div>
    );
  if (!game) return <Spinner full />;

  const nick = (uid: string | null | undefined) => game.players.find((p) => p.user.id === uid)?.user.nickname ?? '—';
  const chronicle: ChronicleEntry[] = [];
  for (const e of game.events) {
    const p = e.payload as Record<string, unknown>;
    const round = Number(e.phase.split('-')[1]) || 0;
    if (e.type === 'night_result') chronicle.push({ kind: 'night', round, killedId: (p.killedId as string) ?? null });
    if (e.type === 'vote_result') chronicle.push({ kind: 'vote', round, voteRound: p.voteRound as 1 | 2, votes: p.votes as Record<string, string>, leaders: p.leaders as string[] });
    if (e.type === 'execution') chronicle.push({ kind: 'execution', round, targetId: (p.targetId as string) ?? null, outcome: p.outcome as 'executed' | 'tie' | 'nobody' });
    if (e.type === 'player_left' && e.actorId) chronicle.push({ kind: 'left', round, playerId: e.actorId });
  }
  const nightDetails = game.events.filter((e) => e.type === 'night_result').map((e) => ({ phase: e.phase, ...(e.payload as { targetId: string | null; healId: string | null; saved: boolean }) }));

  return (
    <div className="page medium col" style={{ gap: '1.2rem' }}>
      <div className="card col">
        <Link to="/profile">← Історія партій</Link>
        <h1>
          {game.gameTitle} · {timeAgo(game.startedAt)}
        </h1>
        <div className={`banner ${game.winner ?? ''}`}>{game.winner ? `Перемога: ${TEAM_TITLE[game.winner as Team] ?? game.winner}` : 'Партію зупинено'}</div>
        <table className="table">
          <thead>
            <tr>
              <th>#</th>
              <th>Гравець</th>
              <th>Роль</th>
              <th>Підсумок</th>
            </tr>
          </thead>
          <tbody>
            {game.players.map((p) => (
              <tr key={p.user.id}>
                <td>{p.seat}</td>
                <td>
                  <div className="row">
                    <Avatar user={p.user} size={24} /> {p.user.nickname}
                  </div>
                </td>
                <td>
                  {ROLE_EMOJI[p.role as Role]} {ROLE_INFO[p.role as Role]?.title ?? p.role}
                </td>
                <td>
                  {p.won ? <span className="badge success">переміг</span> : <span className="badge">програв</span>} <span className="faint">{p.isAlive ? 'вижив' : p.diedAtPhase === 'left' ? 'вийшов' : 'вибув'}</span>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <div className="card col">
        <h2>Хроніка</h2>
        {chronicle.map((e, i) => (
          <div key={i}>{chronicleText(e, nick)}</div>
        ))}
        {nightDetails.length > 0 && (
          <>
            <h3 style={{ marginTop: '1rem' }}>Що відбувалося вночі</h3>
            {nightDetails.map((n) => (
              <div key={n.phase} className="faint">
                {n.phase.replace('night-', 'Ніч ')}: мафія обрала {nick(n.targetId)}, лікар рятував {nick(n.healId)}
                {n.saved ? ' — врятував!' : ''}
              </div>
            ))}
          </>
        )}
      </div>
    </div>
  );
}
