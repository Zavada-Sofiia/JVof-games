import { useEffect, useState, type FormEvent } from 'react';
import { Link, useNavigate } from 'react-router';
import { normalizeCode, type GameSummaryDto, type PublicRoomDto, type RoomVisibility } from '@jvof/shared';
import { FriendsPanel } from '../components/FriendsPanel';
import { SettingsForm } from '../components/SettingsForm';
import { Avatar, timeAgo } from '../components/ui';
import { gameModules } from '../games/registry';
import { api } from '../lib/api';
import { useAuth } from '../store/auth';
import { toastError } from '../store/ui';

const VISIBILITY: { value: RoomVisibility; label: string; hint: string }[] = [
  { value: 'private', label: 'Приватна', hint: 'лише за кодом чи посиланням' },
  { value: 'friends', label: 'Для друзів', hint: 'лише ваші друзі та запрошені' },
  { value: 'public', label: 'Публічна', hint: 'видно в списку відкритих кімнат' },
];

function CreateRoom() {
  const navigate = useNavigate();
  const [gameId, setGameId] = useState(gameModules[0].id);
  const module = gameModules.find((m) => m.id === gameId)!;
  const [maxPlayers, setMaxPlayers] = useState(module.defaultMaxPlayers);
  const [visibility, setVisibility] = useState<RoomVisibility>('friends');
  const [settings, setSettings] = useState<Record<string, unknown>>(() => module.normalizeSettings({}));
  const [more, setMore] = useState(false);
  const [busy, setBusy] = useState(false);

  const create = async () => {
    setBusy(true);
    try {
      const { code } = await api<{ code: string }>('/rooms', { body: { gameType: gameId, visibility, maxPlayers, settings } });
      navigate(`/room/${code}`);
    } catch (e) {
      toastError(e);
      setBusy(false);
    }
  };

  return (
    <div className="card col">
      <h2>Нова кімната</h2>
      <label className="field">
        Гра
        <select
          className="input"
          value={gameId}
          onChange={(e) => {
            const m = gameModules.find((x) => x.id === e.target.value)!;
            setGameId(m.id);
            setMaxPlayers(m.defaultMaxPlayers);
            setSettings(m.normalizeSettings({}));
          }}
        >
          {gameModules.map((m) => (
            <option key={m.id} value={m.id}>
              {m.title}
            </option>
          ))}
        </select>
      </label>
      <p className="faint" style={{ margin: 0 }}>
        {module.description}
      </p>
      <label className="field">
        <span>
          Гравців: <b style={{ color: 'var(--text)' }}>до {maxPlayers}</b>
        </span>
        <input type="range" min={module.minPlayers} max={module.maxPlayers} value={maxPlayers} onChange={(e) => setMaxPlayers(Number(e.target.value))} style={{ accentColor: 'var(--accent)' }} />
      </label>
      <label className="field">
        Хто може зайти
        <select className="input" value={visibility} onChange={(e) => setVisibility(e.target.value as RoomVisibility)}>
          {VISIBILITY.map((v) => (
            <option key={v.value} value={v.value}>
              {v.label} — {v.hint}
            </option>
          ))}
        </select>
      </label>
      <SettingsForm schema={module.settingsSchema} value={settings} onChange={(p) => setSettings(module.normalizeSettings({ ...settings, ...p }))} only={more ? undefined : ['hostMode']} />
      <button className="btn ghost sm" style={{ alignSelf: 'flex-start' }} onClick={() => setMore(!more)}>
        {more ? '▴ Менше налаштувань' : '▾ Усі налаштування правил'}
      </button>
      <button className="btn primary lg" disabled={busy} onClick={create}>
        Створити кімнату
      </button>
    </div>
  );
}

function JoinByCode() {
  const navigate = useNavigate();
  const [code, setCode] = useState('');
  const submit = (e: FormEvent) => {
    e.preventDefault();
    const c = normalizeCode(code);
    if (c.length >= 4) navigate(`/room/${c}`);
  };
  return (
    <form className="card col" onSubmit={submit}>
      <h2>Зайти за кодом</h2>
      <div className="row">
        <input className="input mono" placeholder="ABCD" maxLength={6} value={code} onChange={(e) => setCode(e.target.value.toUpperCase())} aria-label="Код кімнати" />
        <button className="btn primary" disabled={normalizeCode(code).length < 4}>
          Зайти
        </button>
      </div>
    </form>
  );
}

function PublicRooms() {
  const [rooms, setRooms] = useState<PublicRoomDto[] | null>(null);
  useEffect(() => {
    const load = () => api<PublicRoomDto[]>('/rooms/public').then(setRooms).catch(() => setRooms([]));
    load();
    const t = setInterval(load, 15000);
    return () => clearInterval(t);
  }, []);
  if (!rooms?.length) return null;
  return (
    <div className="card col">
      <h2>Відкриті кімнати</h2>
      <div className="list">
        {rooms.map((r) => (
          <Link key={r.code} to={`/room/${r.code}`} className="list-item" style={{ color: 'var(--text)', textDecoration: 'none' }}>
            <Avatar user={r.owner} size={30} />
            <div className="grow">
              <div className="name">
                {r.gameTitle} · {r.owner.nickname}
              </div>
              <div className="faint">
                {r.playerCount}/{r.maxPlayers} гравців · {r.status === 'playing' ? 'йде гра' : 'збираються'}
              </div>
            </div>
            <span className="badge mono">{r.code}</span>
          </Link>
        ))}
      </div>
    </div>
  );
}

const ROLE_TITLES: Record<string, string> = { civilian: 'Мирний', sheriff: 'Шериф', doctor: 'Лікар', mafia: 'Мафія', don: 'Дон' };

function RecentGames() {
  const [games, setGames] = useState<GameSummaryDto[] | null>(null);
  useEffect(() => {
    api<GameSummaryDto[]>('/me/games').then(setGames).catch(() => setGames([]));
  }, []);
  if (!games?.length) return null;
  return (
    <div className="card col">
      <div className="row">
        <h2 className="grow">Останні партії</h2>
        <Link to="/profile">Уся історія</Link>
      </div>
      <div className="list">
        {games.slice(0, 5).map((g) => (
          <Link key={g.id} to={`/games/${g.id}`} className="list-item" style={{ color: 'var(--text)', textDecoration: 'none' }}>
            <span className="grow">
              {g.gameTitle} · {ROLE_TITLES[g.myRole] ?? g.myRole}
              <span className="faint"> · {timeAgo(g.startedAt)}</span>
            </span>
            {g.winner === null ? <span className="badge">зупинено</span> : g.won ? <span className="badge success">перемога</span> : <span className="badge danger">поразка</span>}
          </Link>
        ))}
      </div>
    </div>
  );
}

function VerifyBanner() {
  const user = useAuth((s) => s.user);
  const [sent, setSent] = useState(false);
  if (!user || user.emailVerified) return null;
  return (
    <div className="card tight row wrap" style={{ marginBottom: '1rem', borderColor: 'var(--warn)' }}>
      <span className="grow">Підтвердіть пошту {user.email} — так ви зможете відновити пароль.</span>
      <button
        className="btn sm"
        disabled={sent}
        onClick={() =>
          api('/auth/verify/resend', { body: {} })
            .then(() => setSent(true))
            .catch(toastError)
        }
      >
        {sent ? 'Лист надіслано' : 'Надіслати лист ще раз'}
      </button>
    </div>
  );
}

export function HomePage() {
  return (
    <div className="page">
      <VerifyBanner />
      <div className="home-grid">
        <div className="col" style={{ gap: '1.2rem' }}>
          <CreateRoom />
          <JoinByCode />
          <PublicRooms />
          <RecentGames />
        </div>
        <div className="card">
          <FriendsPanel />
        </div>
      </div>
    </div>
  );
}
