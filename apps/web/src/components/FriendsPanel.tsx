import { useEffect, useState, type FormEvent } from 'react';
import { useNavigate } from 'react-router';
import { formatFriendCode, type FriendDto } from '@jvof/shared';
import { api } from '../lib/api';
import { useAuth } from '../store/auth';
import { useFriends } from '../store/friends';
import { toast, toastError } from '../store/ui';
import { Avatar, copyText } from './ui';

const STATUS_TEXT: Record<FriendDto['status'], string> = {
  online: 'онлайн',
  in_room: 'у кімнаті',
  in_game: 'у грі',
  offline: 'не в мережі',
};

/** Список друзів. Якщо передано roomCode — біля кожного друга кнопка «Запросити». */
export function FriendsPanel({ roomCode, compact }: { roomCode?: string; compact?: boolean }) {
  const me = useAuth((s) => s.user);
  const { friends, requests, loaded, load } = useFriends();
  const navigate = useNavigate();
  const [code, setCode] = useState('');
  const [busy, setBusy] = useState(false);
  const [invited, setInvited] = useState<Set<string>>(new Set());

  useEffect(() => {
    load().catch(toastError);
  }, [load]);

  const add = async (e: FormEvent) => {
    e.preventDefault();
    setBusy(true);
    try {
      const r = await api<{ status: string }>('/friends/requests', { body: { code } });
      toast(r.status === 'accepted' ? 'Тепер ви друзі!' : 'Запит надіслано', 'success');
      setCode('');
      await load();
    } catch (err) {
      toastError(err);
    } finally {
      setBusy(false);
    }
  };

  const act = async (path: string, method = 'POST', msg?: string) => {
    try {
      await api(path, { method, body: method === 'POST' ? {} : undefined });
      if (msg) toast(msg, 'success');
      await load();
    } catch (err) {
      toastError(err);
    }
  };

  const invite = async (f: FriendDto) => {
    try {
      await api(`/rooms/${roomCode}/invite`, { body: { friendId: f.id } });
      setInvited(new Set(invited).add(f.id));
      toast(`Запрошення надіслано: ${f.nickname}`, 'success');
    } catch (err) {
      toastError(err);
    }
  };

  const incoming = requests.filter((r) => r.direction === 'incoming');
  const outgoing = requests.filter((r) => r.direction === 'outgoing');

  return (
    <div className="col" style={{ gap: '1rem' }}>
      {!compact && me && (
        <div>
          <div className="faint">Ваш код друга</div>
          <div className="row">
            <span className="friend-code mono">{formatFriendCode(me.friendCode)}</span>
            <button className="btn sm" onClick={() => copyText(formatFriendCode(me.friendCode), 'Код скопійовано')}>
              Копіювати
            </button>
          </div>
          <div className="faint">Надішліть його другу в месенджер, щоб він вас додав.</div>
        </div>
      )}

      <form className="row" onSubmit={add}>
        <input
          className="input mono"
          placeholder="Код друга, напр. K7M2-9QXP"
          value={code}
          onChange={(e) => setCode(e.target.value.toUpperCase())}
          maxLength={12}
          aria-label="Код друга"
        />
        <button className="btn primary" disabled={busy || code.replace(/[\s-]/g, '').length < 8}>
          Додати
        </button>
      </form>

      {incoming.length > 0 && (
        <div>
          <h3>Запити в друзі</h3>
          <div className="list">
            {incoming.map((r) => (
              <div key={r.id} className="list-item">
                <Avatar user={r.user} size={32} />
                <span className="name grow">{r.user.nickname}</span>
                <button className="btn primary sm" onClick={() => act(`/friends/requests/${r.id}/accept`, 'POST', 'Тепер ви друзі!')}>
                  Прийняти
                </button>
                <button className="btn ghost sm" onClick={() => act(`/friends/requests/${r.id}/decline`)} title="Відхилити">
                  ✕
                </button>
              </div>
            ))}
          </div>
        </div>
      )}

      <div>
        <h3>Друзі {friends.length > 0 && <span className="faint">({friends.length})</span>}</h3>
        {loaded && friends.length === 0 && <p className="faint">Поки нікого. Додайте друга за його кодом.</p>}
        <div className="list">
          {friends.map((f) => (
            <div key={f.id} className="list-item">
              <div style={{ position: 'relative' }}>
                <Avatar user={f} size={34} />
                <span className={`dot ${f.status}`} style={{ position: 'absolute', right: -1, bottom: -1, border: '2px solid var(--surface)', width: 12, height: 12 }} />
              </div>
              <div className="grow">
                <div className="name">{f.nickname}</div>
                <div className="faint">
                  {STATUS_TEXT[f.status]}
                  {f.roomCode && f.status !== 'offline' ? ` · ${f.roomCode}` : ''}
                </div>
              </div>
              {roomCode ? (
                f.roomCode === roomCode ? (
                  <span className="badge success">тут</span>
                ) : (
                  <button className="btn sm" disabled={invited.has(f.id) || f.status === 'offline'} onClick={() => invite(f)}>
                    {invited.has(f.id) ? 'Запрошено' : 'Запросити'}
                  </button>
                )
              ) : (
                f.roomCode &&
                f.status !== 'offline' && (
                  <button className="btn sm" onClick={() => navigate(`/room/${f.roomCode}`)}>
                    Приєднатися
                  </button>
                )
              )}
              {!compact && (
                <FriendMenu friend={f} onDone={() => load()} />
              )}
            </div>
          ))}
        </div>
      </div>

      {!compact && outgoing.length > 0 && (
        <div>
          <h3>Надіслані запити</h3>
          <div className="list">
            {outgoing.map((r) => (
              <div key={r.id} className="list-item">
                <Avatar user={r.user} size={28} />
                <span className="name grow">{r.user.nickname}</span>
                <span className="faint">очікує</span>
                <button className="btn ghost sm" onClick={() => act(`/friends/requests/${r.id}`, 'DELETE')} title="Скасувати запит">
                  ✕
                </button>
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}

function FriendMenu({ friend, onDone }: { friend: FriendDto; onDone: () => void }) {
  const [open, setOpen] = useState(false);
  const run = async (fn: () => Promise<unknown>, msg: string) => {
    try {
      await fn();
      toast(msg, 'success');
      onDone();
    } catch (e) {
      toastError(e);
    }
    setOpen(false);
  };
  return (
    <div style={{ position: 'relative' }}>
      <button className="btn ghost sm" onClick={() => setOpen(!open)} aria-label="Дії з другом">
        ⋯
      </button>
      {open && (
        <div className="card tight col" style={{ position: 'absolute', right: 0, top: '110%', zIndex: 10, width: 190, boxShadow: 'var(--shadow)', gap: '0.3rem' }}>
          <button className="btn sm" onClick={() => run(() => api(`/friends/${friend.id}`, { method: 'DELETE' }), 'Видалено з друзів')}>
            Видалити з друзів
          </button>
          <button className="btn danger sm" onClick={() => run(() => api('/blocks', { body: { userId: friend.id } }), 'Користувача заблоковано')}>
            Заблокувати
          </button>
        </div>
      )}
    </div>
  );
}
