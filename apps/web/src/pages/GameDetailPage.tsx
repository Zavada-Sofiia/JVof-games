import { useEffect, useState } from 'react';
import { Link, useParams } from 'react-router';
import type { GameDetailDto } from '@jvof/shared';
import { ROLE_INFO, TEAM_TITLE, type ChronicleEntry, type Role, type Team } from '@jvof/game-mafia';
import { Avatar, Spinner, timeAgo } from '../components/ui';
import { ROLE_EMOJI, chronicleText } from '../games/mafia/client';
import { OUTCOME_TEXT } from '../games/spyfall/client';
import { locationById, type SpyOutcome } from '@jvof/game-spyfall';
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
    if (e.type === 'night_result') {
      const alibi = (p.visitId as string | null) ?? null;
      chronicle.push({ kind: 'night', round, killedId: (p.killedId as string) ?? null, alibiId: alibi && alibi !== p.killedId ? alibi : null });
    }
    if (e.type === 'vote_result') chronicle.push({ kind: 'vote', round, voteRound: p.voteRound as 1 | 2, votes: p.votes as Record<string, string>, leaders: p.leaders as string[] });
    if (e.type === 'execution') chronicle.push({ kind: 'execution', round, targetId: (p.targetId as string) ?? null, outcome: p.outcome as 'executed' | 'tie' | 'nobody' });
    if (e.type === 'player_left' && e.actorId) chronicle.push({ kind: 'left', round, playerId: e.actorId });
  }
  // ---- Шпигун: локація, ролі в локації, хроніка питань і звинувачень ----
  const spy = game.gameType === 'spyfall';
  const started = game.events.find((e) => e.type === 'game_started')?.payload as
    | { locationId?: string; players?: { id: string; role: string | null }[] }
    | undefined;
  const over = game.events.find((e) => e.type === 'game_over')?.payload as { outcome?: SpyOutcome; target?: string | null } | undefined;
  const spyLocation = spy ? locationById(started?.locationId ?? '') : undefined;
  const spyName = nick(game.players.find((p) => p.role === 'spy')?.user.id);
  const spyLog = spy
    ? game.events.flatMap((e) => {
        const p = e.payload as Record<string, unknown>;
        if (e.type === 'accuse') return [`☝️ ${nick(e.actorId)} звинуватив(ла) ${nick(p.target as string)}`];
        if (e.type === 'accusation_result') return [p.unanimous ? '⚖️ Одноголосно — так' : '⚖️ Не одноголосно, гра триває'];
        if (e.type === 'guess') return [`📍 Шпигун назвав локацію «${locationById(p.locationId as string)?.title ?? '?'}»`];
        if (e.type === 'final_vote_result') {
          const votes = Object.entries(p.votes as Record<string, string>).map(([a, b]) => `${nick(a)} → ${nick(b)}`);
          return [`🗳 Фінальне голосування: ${votes.join(', ') || 'ніхто не проголосував'}`];
        }
        return [];
      })
    : [];
  const questions = spy ? game.events.filter((e) => e.type === 'ask').length : 0;
  const roleLabel = (p: GameDetailDto['players'][number]) => {
    if (p.role === 'spy') return '🕵️ Шпигун';
    if (p.role === 'local') return `🏠 ${started?.players?.find((x) => x.id === p.user.id)?.role ?? 'Мешканець'}`;
    return `${ROLE_EMOJI[p.role as Role] ?? ''} ${ROLE_INFO[p.role as Role]?.title ?? p.role}`;
  };
  const winnerTitle = (w: string) => (w === 'spy' ? 'шпигун' : w === 'locals' ? 'мешканці' : (TEAM_TITLE[w as Team] ?? w));

  const nightDetails = game.events
    .filter((e) => e.type === 'night_result')
    .map((e) => ({ phase: e.phase, ...(e.payload as { targetId: string | null; healId: string | null; saved: boolean; visitId?: string | null }) }));

  return (
    <div className="page medium col" style={{ gap: '1.2rem' }}>
      <div className="card col">
        <Link to="/profile">← Історія партій</Link>
        <h1>
          {game.gameTitle} · {timeAgo(game.startedAt)}
        </h1>
        <div className={`banner ${game.winner === 'spy' ? 'mafia' : game.winner === 'locals' ? 'civilians' : (game.winner ?? '')}`}>
          {game.winner ? `Перемога: ${winnerTitle(game.winner)}` : 'Партію зупинено'}
        </div>
        {spyLocation && (
          <div className="muted">
            Локація: {spyLocation.emoji} <b>{spyLocation.title}</b>
            {over?.outcome && ` · ${OUTCOME_TEXT[over.outcome](spyName, locationById(over.target ?? '')?.title ?? '')}`}
          </div>
        )}
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
                <td>{roleLabel(p)}</td>
                <td>
                  {p.won ? <span className="badge success">переміг</span> : <span className="badge">програв</span>}{' '}
                  {!spy && <span className="faint">{p.isAlive ? 'вижив' : p.diedAtPhase === 'left' ? 'вийшов' : 'вибув'}</span>}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <div className="card col">
        <h2>Хроніка</h2>
        {spy && <div className="faint">Питань поставлено: {questions}</div>}
        {spyLog.map((t, i) => (
          <div key={`s${i}`}>{t}</div>
        ))}
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
                {n.visitId ? `, повія ходила до ${nick(n.visitId)}` : ''}
              </div>
            ))}
          </>
        )}
      </div>
    </div>
  );
}
