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

const ROLE_TITLES: Record<string, string> = { civilian: 'Мирний', sheriff: 'Шериф', doctor: 'Лікар', mafia: 'Мафія', don: 'Дон' };

/** Ігри платформи. Ті, що «скоро», — з плану розвитку (розділ 13.3 архітектури). */
export const GAMES = [
  { id: 'mafia', path: '/mafia', icon: '🎭', title: 'Мафія', text: 'Мирні шукають мафію, мафія вночі обирає жертву. Гра сама вмикає й вимикає мікрофони.', pills: ['4–16 гравців', 'відео й голос', 'авто-ведучий'] },
  { id: 'spyfall', icon: '🕵️', title: 'Шпигун', text: 'Усі знають локацію, крім шпигуна. Питання по колу.', soon: true },
  { id: 'alias', icon: '🐊', title: 'Крокодил', text: 'Поясни слово, не називаючи його. На час і на очки.', soon: true },
  { id: 'codenames', icon: '🧩', title: 'Кодові імена', text: 'Дві команди, поле зі словами й капітани.', soon: true },
];

// ---------- спільні блоки (використовуються й на сторінці гри) ----------

export function CreateRoom({ gameId }: { gameId: string }) {
  const navigate = useNavigate();
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
        <span>
          Гравців: <b style={{ color: 'var(--text)' }}>до {maxPlayers}</b>
        </span>
        <input type="range" min={module.minPlayers} max={module.maxPlayers} value={maxPlayers} onChange={(e) => setMaxPlayers(Number(e.target.value))} />
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

export function JoinByCode({ compact }: { compact?: boolean }) {
  const navigate = useNavigate();
  const [code, setCode] = useState('');
  const submit = (e: FormEvent) => {
    e.preventDefault();
    const c = normalizeCode(code);
    if (c.length >= 4) navigate(`/room/${c}`);
  };
  const form = (
    <form className="row" onSubmit={submit}>
      <input className="input mono" placeholder="Код кімнати, напр. ABCD" maxLength={6} value={code} onChange={(e) => setCode(e.target.value.toUpperCase())} aria-label="Код кімнати" />
      <button className="btn primary" disabled={normalizeCode(code).length < 4}>
        Зайти
      </button>
    </form>
  );
  if (compact) return form;
  return (
    <div className="card col">
      <h2>Зайти за кодом</h2>
      {form}
    </div>
  );
}

export function PublicRooms({ gameTitle }: { gameTitle?: string }) {
  const [rooms, setRooms] = useState<PublicRoomDto[] | null>(null);
  useEffect(() => {
    const load = () => api<PublicRoomDto[]>('/rooms/public').then(setRooms).catch(() => setRooms([]));
    void load();
    const t = setInterval(load, 15000);
    return () => clearInterval(t);
  }, []);
  const list = rooms?.filter((r) => !gameTitle || r.gameTitle === gameTitle) ?? [];
  return (
    <div className="card col">
      <h2>Відкриті кімнати</h2>
      {rooms && list.length === 0 && <p className="faint" style={{ margin: 0 }}>Зараз відкритих кімнат немає. Створіть свою!</p>}
      <div className="list">
        {list.map((r) => (
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
            <span className="badge accent mono">{r.code}</span>
          </Link>
        ))}
      </div>
    </div>
  );
}

export function RecentGames({ gameType, title = 'Останні партії' }: { gameType?: string; title?: string }) {
  const [games, setGames] = useState<GameSummaryDto[] | null>(null);
  useEffect(() => {
    api<GameSummaryDto[]>('/me/games').then(setGames).catch(() => setGames([]));
  }, []);
  const list = games?.filter((g) => !gameType || g.gameType === gameType) ?? [];
  if (!games) return null;
  return (
    <div className="card col">
      <div className="row">
        <h2 className="grow" style={{ margin: 0 }}>
          {title}
        </h2>
        <Link to="/profile">Уся історія</Link>
      </div>
      {list.length === 0 && <p className="faint" style={{ margin: 0 }}>Ще не зіграно жодної партії.</p>}
      <div className="list">
        {list.slice(0, 5).map((g) => (
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

// ---------- головна ----------

export function HomePage() {
  const user = useAuth((s) => s.user)!;
  return (
    <div className="page col" style={{ gap: '1.4rem' }}>
      <section className="hero">
        <span className="hero-emoji" aria-hidden>
          🎲
        </span>
        <h1>
          Привіт, <span className="grad-text">{user.nickname}</span>!
        </h1>
        <p>Збирай друзів, заходьте в одну кімнату — бачте й чуйте одне одного, а гра сама подбає, хто коли говорить.</p>
        <div className="row wrap" style={{ marginTop: '1.1rem', gap: '0.8rem' }}>
          <Link to="/mafia" className="btn primary lg">
            🎭 Грати в Мафію
          </Link>
          <div style={{ minWidth: 260, flex: '0 1 340px' }}>
            <JoinByCode compact />
          </div>
        </div>
      </section>

      <div className="home-grid">
        <div className="col" style={{ gap: '1.4rem' }}>
          <div>
            <div className="section-title">Ігри</div>
            <div className="games-grid">
              {GAMES.map((g) =>
                g.soon ? (
                  <div key={g.id} className="game-card soon">
                    <div className="game-icon">{g.icon}</div>
                    <h3>{g.title}</h3>
                    <div className="faint">{g.text}</div>
                    <span className="spacer" />
                    <span className="badge" style={{ alignSelf: 'flex-start' }}>
                      скоро
                    </span>
                  </div>
                ) : (
                  <Link key={g.id} to={g.path!} className="game-card featured">
                    <div className="game-icon">{g.icon}</div>
                    <h3>{g.title}</h3>
                    <div className="muted" style={{ fontSize: '0.92rem' }}>
                      {g.text}
                    </div>
                    <span className="spacer" />
                    <div className="row wrap" style={{ gap: '0.35rem' }}>
                      {g.pills?.map((p) => (
                        <span key={p} className="stat-pill">
                          {p}
                        </span>
                      ))}
                    </div>
                  </Link>
                ),
              )}
            </div>
          </div>
          <RecentGames />
        </div>
        <div className="card">
          <FriendsPanel />
        </div>
      </div>
    </div>
  );
}
