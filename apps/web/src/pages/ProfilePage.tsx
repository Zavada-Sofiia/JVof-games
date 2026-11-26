import { useEffect, useRef, useState, type FormEvent } from 'react';
import { Link, useNavigate } from 'react-router';
import { AVATAR_COLORS, formatFriendCode, type BlockDto, type GameSummaryDto, type MeDto, type StatsDto } from '@jvof/shared';
import { ROLE_INFO, type Role } from '@jvof/game-mafia';
import { Avatar, Modal, copyText, timeAgo } from '../components/ui';
import { api } from '../lib/api';
import { useAuth } from '../store/auth';
import { toast, toastError } from '../store/ui';

const roleTitle = (r: string) => ROLE_INFO[r as Role]?.title ?? r;

/** Зменшує фото до 128×128 і повертає data:URL (щоб не зберігати великі файли) */
async function resizeImage(file: File): Promise<string> {
  const bmp = await createImageBitmap(file);
  const size = 128;
  const canvas = document.createElement('canvas');
  canvas.width = canvas.height = size;
  const ctx = canvas.getContext('2d')!;
  const s = Math.min(bmp.width, bmp.height);
  ctx.drawImage(bmp, (bmp.width - s) / 2, (bmp.height - s) / 2, s, s, 0, 0, size, size);
  const webp = canvas.toDataURL('image/webp', 0.85);
  return webp.startsWith('data:image/webp') ? webp : canvas.toDataURL('image/jpeg', 0.85);
}

function ProfileCard() {
  const user = useAuth((s) => s.user)!;
  const setUser = useAuth((s) => s.setUser);
  const [nickname, setNickname] = useState(user.nickname);
  const fileRef = useRef<HTMLInputElement>(null);

  const patch = async (body: Record<string, unknown>, msg = 'Збережено') => {
    try {
      setUser(await api<MeDto>('/me', { method: 'PATCH', body }));
      toast(msg, 'success');
    } catch (e) {
      toastError(e);
    }
  };

  const onFile = async (f: File | undefined) => {
    if (!f) return;
    try {
      await patch({ avatarImage: await resizeImage(f) }, 'Аватар оновлено');
    } catch {
      toast('Не вдалося обробити зображення', 'error');
    }
  };

  return (
    <div className="card col">
      <h2>Профіль</h2>
      <div className="row wrap" style={{ gap: '1rem' }}>
        <Avatar user={user} size={80} />
        <div className="col" style={{ gap: '0.4rem' }}>
          <div className="row wrap" style={{ gap: '0.35rem' }}>
            {AVATAR_COLORS.map((c) => (
              <button
                key={c}
                aria-label={`Колір ${c}`}
                onClick={() => patch({ avatarColor: c })}
                style={{ width: 26, height: 26, borderRadius: '50%', background: c, border: c === user.avatarColor ? '3px solid var(--text)' : '2px solid transparent', cursor: 'pointer' }}
              />
            ))}
          </div>
          <div className="row">
            <button className="btn sm" onClick={() => fileRef.current?.click()}>
              Завантажити фото
            </button>
            {user.avatarUrl && (
              <button className="btn sm ghost" onClick={() => patch({ avatarImage: null }, 'Фото прибрано')}>
                Прибрати фото
              </button>
            )}
            <input ref={fileRef} type="file" accept="image/*" hidden onChange={(e) => onFile(e.target.files?.[0])} />
          </div>
        </div>
      </div>
      <form
        className="row"
        onSubmit={(e) => {
          e.preventDefault();
          void patch({ nickname });
        }}
      >
        <label className="field grow">
          Нікнейм
          <input className="input" value={nickname} minLength={2} maxLength={24} onChange={(e) => setNickname(e.target.value)} disabled={!!user.nicknameChangeAvailableAt} />
        </label>
        <button className="btn" style={{ alignSelf: 'flex-end' }} disabled={nickname.trim() === user.nickname || !!user.nicknameChangeAvailableAt}>
          Зберегти
        </button>
      </form>
      <div className="faint">
        {user.nicknameChangeAvailableAt
          ? `Нікнейм можна змінювати раз на 14 днів. Наступна зміна: ${new Date(user.nicknameChangeAvailableAt).toLocaleDateString('uk-UA')}`
          : 'Нікнейм можна змінювати раз на 14 днів.'}
      </div>
      <div>
        <div className="faint">Email</div>
        <div className="row">
          {user.email} {user.emailVerified ? <span className="badge success">підтверджено</span> : <span className="badge warn">не підтверджено</span>}
        </div>
      </div>
      <FriendCode user={user} />
    </div>
  );
}

function FriendCode({ user }: { user: MeDto }) {
  const setUser = useAuth((s) => s.setUser);
  const [confirm, setConfirm] = useState(false);
  return (
    <div>
      <div className="faint">Код друга</div>
      <div className="row wrap">
        <span className="friend-code mono">{formatFriendCode(user.friendCode)}</span>
        <button className="btn sm" onClick={() => copyText(formatFriendCode(user.friendCode), 'Код скопійовано')}>
          Копіювати
        </button>
        <button className="btn sm ghost" onClick={() => setConfirm(true)}>
          Згенерувати новий
        </button>
      </div>
      {confirm && (
        <Modal title="Новий код друга" onClose={() => setConfirm(false)}>
          <p>Старий код перестане діяти. Ваші друзі нікуди не зникнуть.</p>
          <div className="row">
            <span className="spacer" />
            <button className="btn" onClick={() => setConfirm(false)}>
              Скасувати
            </button>
            <button
              className="btn primary"
              onClick={async () => {
                try {
                  setUser(await api<MeDto>('/me/friend-code/regenerate', { body: {} }));
                  toast('Новий код готовий', 'success');
                } catch (e) {
                  toastError(e);
                }
                setConfirm(false);
              }}
            >
              Згенерувати
            </button>
          </div>
        </Modal>
      )}
    </div>
  );
}

function PasswordCard() {
  const [currentPassword, setCurrent] = useState('');
  const [newPassword, setNew] = useState('');
  const submit = async (e: FormEvent) => {
    e.preventDefault();
    try {
      await api('/me/password', { body: { currentPassword, newPassword } });
      toast('Пароль змінено', 'success');
      setCurrent('');
      setNew('');
    } catch (err) {
      toastError(err);
    }
  };
  return (
    <form className="card col" onSubmit={submit}>
      <h2>Зміна пароля</h2>
      <input className="input" type="password" placeholder="Поточний пароль" autoComplete="current-password" value={currentPassword} onChange={(e) => setCurrent(e.target.value)} required />
      <input className="input" type="password" placeholder="Новий пароль (від 8 символів)" autoComplete="new-password" minLength={8} value={newPassword} onChange={(e) => setNew(e.target.value)} required />
      <button className="btn" style={{ alignSelf: 'flex-start' }}>
        Змінити пароль
      </button>
    </form>
  );
}

function StatsCard() {
  const [stats, setStats] = useState<StatsDto | null>(null);
  const [games, setGames] = useState<GameSummaryDto[]>([]);
  useEffect(() => {
    api<StatsDto>('/me/stats').then(setStats).catch(() => {});
    api<GameSummaryDto[]>('/me/games').then(setGames).catch(() => {});
  }, []);
  const pct = (w: number, g: number) => (g ? `${Math.round((w / g) * 100)}%` : '—');
  return (
    <div className="card col">
      <h2>Статистика</h2>
      {stats && stats.total > 0 ? (
        <>
          <div className="row wrap" style={{ gap: '1.5rem' }}>
            <div>
              <div className="faint">Ігор</div>
              <div style={{ fontSize: '1.6rem', fontWeight: 800 }}>{stats.total}</div>
            </div>
            <div>
              <div className="faint">Перемог</div>
              <div style={{ fontSize: '1.6rem', fontWeight: 800 }}>
                {stats.wins} <span className="faint">({pct(stats.wins, stats.total)})</span>
              </div>
            </div>
          </div>
          <table className="table">
            <thead>
              <tr>
                <th>Роль</th>
                <th>Ігор</th>
                <th>Перемог</th>
              </tr>
            </thead>
            <tbody>
              {stats.byRole.map((r) => (
                <tr key={r.role}>
                  <td>{roleTitle(r.role)}</td>
                  <td>{r.games}</td>
                  <td>{pct(r.wins, r.games)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </>
      ) : (
        <p className="faint">Ще немає завершених партій.</p>
      )}
      {games.length > 0 && (
        <>
          <h3>Історія партій</h3>
          <table className="table">
            <thead>
              <tr>
                <th>Дата</th>
                <th>Гра</th>
                <th>Роль</th>
                <th>Результат</th>
              </tr>
            </thead>
            <tbody>
              {games.map((g) => (
                <tr key={g.id}>
                  <td>
                    <Link to={`/games/${g.id}`}>{timeAgo(g.startedAt)}</Link>
                  </td>
                  <td>{g.gameTitle}</td>
                  <td>{roleTitle(g.myRole)}</td>
                  <td>{g.winner === null ? <span className="badge">зупинено</span> : g.won ? <span className="badge success">перемога</span> : <span className="badge danger">поразка</span>}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </>
      )}
    </div>
  );
}

function BlocksCard() {
  const [blocks, setBlocks] = useState<BlockDto[] | null>(null);
  const load = () => api<BlockDto[]>('/blocks').then(setBlocks).catch(() => {});
  useEffect(() => {
    void load();
  }, []);
  if (!blocks?.length) return null;
  return (
    <div className="card col">
      <h2>Заблоковані</h2>
      <div className="list">
        {blocks.map((b) => (
          <div key={b.user.id} className="list-item">
            <Avatar user={b.user} size={28} />
            <span className="name grow">{b.user.nickname}</span>
            <button
              className="btn sm"
              onClick={() =>
                api(`/blocks/${b.user.id}`, { method: 'DELETE' })
                  .then(load)
                  .catch(toastError)
              }
            >
              Розблокувати
            </button>
          </div>
        ))}
      </div>
    </div>
  );
}

function DangerCard() {
  const navigate = useNavigate();
  const logout = useAuth((s) => s.logout);
  const [open, setOpen] = useState(false);
  const [password, setPassword] = useState('');
  return (
    <div className="card col">
      <div className="row wrap">
        <button
          className="btn"
          onClick={async () => {
            await logout();
            navigate('/login');
          }}
        >
          Вийти з акаунта
        </button>
        <span className="spacer" />
        <button className="btn danger" onClick={() => setOpen(true)}>
          Видалити акаунт
        </button>
      </div>
      {open && (
        <Modal title="Видалити акаунт?" onClose={() => setOpen(false)}>
          <form
            className="col"
            onSubmit={async (e) => {
              e.preventDefault();
              try {
                await api('/me', { method: 'DELETE', body: { password } });
                toast('Акаунт видалено', 'success');
                await logout();
                navigate('/login');
              } catch (err) {
                toastError(err);
              }
            }}
          >
            <p>Буде видалено ваш профіль, друзів та історію ігор. Цю дію не можна скасувати.</p>
            <input className="input" type="password" placeholder="Пароль для підтвердження" value={password} onChange={(e) => setPassword(e.target.value)} required />
            <div className="row">
              <span className="spacer" />
              <button type="button" className="btn" onClick={() => setOpen(false)}>
                Скасувати
              </button>
              <button className="btn danger">Видалити назавжди</button>
            </div>
          </form>
        </Modal>
      )}
    </div>
  );
}

export default function ProfilePage() {
  return (
    <div className="page medium col" style={{ gap: '1.2rem' }}>
      <ProfileCard />
      <StatsCard />
      <PasswordCard />
      <BlocksCard />
      <DangerCard />
    </div>
  );
}
