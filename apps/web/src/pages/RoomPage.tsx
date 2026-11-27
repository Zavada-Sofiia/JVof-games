import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useNavigate, useParams } from 'react-router';
import {
  policyHears,
  policySees,
  type ChatMessageDto,
  type IceConfigDto,
  type RoomInfoDto,
  type RoomMemberDto,
  type RoomStateDto,
  type RoomVisibility,
} from '@jvof/shared';
import { ChatPanel } from '../components/ChatPanel';
import { MicIcon, MicOffIcon, SettingsIcon, VideoIcon, VideoOffIcon } from '../components/icons';
import { FriendsPanel } from '../components/FriendsPanel';
import { DeviceCheck, DevicePickers, RemoteAudio, VideoEl, useAudioLevel } from '../components/media';
import { SettingsForm } from '../components/SettingsForm';
import { Avatar, Modal, Spinner, copyText } from '../components/ui';
import { gameClients, gameModules } from '../games/registry';
import type { GameProps, TileInfo } from '../games/types';
import { api } from '../lib/api';
import { emitAck, getSocket } from '../lib/socket';
import { MeshProvider, type PeerState } from '../rtc/mesh';
import { useFitGrid } from '../lib/useFitGrid';
import { useAuth } from '../store/auth';
import { useMedia } from '../store/media';
import { toast, toastError } from '../store/ui';

type SideTab = 'game' | 'chat' | 'people';

export default function RoomPage() {
  const code = (useParams().code ?? '').toUpperCase();
  const [info, setInfo] = useState<RoomInfoDto | null>(null);
  const [error, setError] = useState('');
  const [entered, setEntered] = useState(false);

  useEffect(() => {
    setEntered(false);
    api<RoomInfoDto>(`/rooms/${code}`)
      .then(setInfo)
      .catch((e: Error) => setError(e.message));
  }, [code]);

  if (error)
    return (
      <div className="page narrow">
        <div className="card col">
          <h1>Кімната {code}</h1>
          <p className="error-text">{error}</p>
          <a href="/">На головну</a>
        </div>
      </div>
    );
  if (!info) return <Spinner full />;
  if (!info.canJoin)
    return (
      <div className="page narrow">
        <div className="card col">
          <h1>Кімната {code}</h1>
          <p className="error-text">{info.reason}</p>
          <a href="/">На головну</a>
        </div>
      </div>
    );
  if (!entered) return <DeviceCheck title={`${info.gameTitle} · кімната ${code}`} onJoin={() => setEntered(true)} />;
  return <Room code={code} />;
}

function Room({ code }: { code: string }) {
  const me = useAuth((s) => s.user)!;
  const navigate = useNavigate();
  const [state, setState] = useState<RoomStateDto | null>(null);
  const [view, setView] = useState<unknown>(null);
  const [access, setAccess] = useState<{ read: string[]; write: string[] }>({ read: ['main'], write: ['main'] });
  const [chat, setChat] = useState<ChatMessageDto[]>([]);
  const [streams, setStreams] = useState<Map<string, MediaStream>>(new Map());
  const [tab, setTab] = useState<SideTab>('game');
  const [unread, setUnread] = useState(false);
  const [devicesOpen, setDevicesOpen] = useState(false);
  const [meshReady, setMeshReady] = useState(false);
  const [peerStates, setPeerStates] = useState<Map<string, PeerState>>(new Map());
  const [audioBlocked, setAudioBlocked] = useState(false);
  const gridRef = useRef<HTMLDivElement>(null);
  const onAudioBlocked = useCallback(() => setAudioBlocked(true), []);
  const levelCache = useRef(new Map<string, () => number>());
  const levelGetters = useCallback((id: string) => {
    let fn = levelCache.current.get(id);
    if (!fn) {
      fn = () => mesh.current?.audioLevels().get(id) ?? 0;
      levelCache.current.set(id, fn);
    }
    return fn;
  }, []);
  // Будь-який дотик до сторінки — шанс увімкнути заблокований звук
  useEffect(() => {
    if (!audioBlocked) return;
    const unlock = () => {
      const els = [...document.querySelectorAll<HTMLAudioElement>('audio[data-remote-audio]')];
      Promise.all(els.map((a) => a.play()))
        .then(() => setAudioBlocked(false))
        .catch(() => {});
    };
    document.addEventListener('pointerdown', unlock);
    return () => document.removeEventListener('pointerdown', unlock);
  }, [audioBlocked]);
  const grid = useFitGrid(gridRef, state?.members.length ?? 0);
  const skew = useRef(0);
  const mesh = useRef<MeshProvider | null>(null);
  const prevPublic = useRef<unknown>(null);
  const tabRef = useRef(tab);
  tabRef.current = tab;
  const media = useMedia();

  const serverNow = useCallback(() => Date.now() + skew.current, []);

  // ---------- підключення до кімнати ----------
  useEffect(() => {
    const s = getSocket();
    let alive = true;
    const join = () =>
      emitAck<{ chat: ChatMessageDto[] }>('room:join', { code })
        .then((r) => alive && setChat(r.chat))
        .catch((e: Error) => {
          toast(e.message, 'error');
          navigate('/');
        });
    const onState = (st: RoomStateDto) => {
      skew.current = st.serverNow - Date.now();
      setState(st);
    };
    const onChat = (m: ChatMessageDto) => {
      setChat((c) => [...c.slice(-299), m]);
      if (tabRef.current !== 'chat' && m.userId !== me.id) setUnread(true);
    };
    const onKicked = (p: { banned: boolean }) => {
      toast(p.banned ? 'Адмін вигнав вас із кімнати назавжди' : 'Адмін вигнав вас із кімнати', 'error');
      navigate('/');
    };
    const onClosed = () => navigate('/');
    s.on('room:state', onState);
    s.on('player:view', setView);
    s.on('room:access', setAccess);
    s.on('room:chat', onChat);
    s.on('room:chat_sync', setChat);
    s.on('room:kicked', onKicked);
    s.on('room:closed', onClosed);
    s.on('connect', join);
    if (s.connected) void join();
    return () => {
      alive = false;
      s.off('room:state', onState);
      s.off('player:view', setView);
      s.off('room:access', setAccess);
      s.off('room:chat', onChat);
      s.off('room:chat_sync', setChat);
      s.off('room:kicked', onKicked);
      s.off('room:closed', onClosed);
      s.off('connect', join);
    };
  }, [code, me.id, navigate]);

  // Вихід зі сторінки: з лобі виходимо зовсім, з гри — лише «відходимо» (місце зберігається 5 хв)
  const stateRef = useRef(state);
  stateRef.current = state;
  useEffect(() => {
    void useMedia.getState().start(); // ідемпотентно: бере пристрої, якщо їх ще немає
    return () => {
      const st = stateRef.current;
      const inGame = st?.status === 'playing' && (st.game?.publicState as { players?: { id: string }[]; hostId?: string } | undefined);
      const participant = inGame && (inGame.players?.some((p) => p.id === me.id) || inGame.hostId === me.id);
      getSocket().emit(participant ? 'room:away' : 'room:leave');
      useMedia.getState().stop();
    };
  }, [me.id]);

  // ---------- WebRTC ----------
  useEffect(() => {
    let provider: MeshProvider | null = null;
    let cancelled = false;
    api<IceConfigDto>(`/rooms/${code}/ice-config`)
      .catch(() => ({ iceServers: [{ urls: 'stun:stun.l.google.com:19302' }] }) as IceConfigDto)
      .then((ice) => {
        if (cancelled) return;
        provider = new MeshProvider(me.id, getSocket(), ice);
        provider.onStreams(setStreams);
        provider.onStates(setPeerStates);
        mesh.current = provider;
        setMeshReady(true);
      });
    return () => {
      cancelled = true;
      provider?.close();
      mesh.current = null;
      setMeshReady(false);
    };
  }, [code, me.id]);

  const meMember = state?.members.find((m) => m.id === me.id);
  const policy = state?.policy;
  const canSpeak = !!policy?.speakers.includes(me.id);

  // Кого тримаємо в mesh: усіх підключених учасників
  const peerKey = state?.members.filter((m) => m.connected && m.id !== me.id).map((m) => m.id).sort().join(',') ?? '';
  useEffect(() => {
    mesh.current?.setPeers(peerKey ? peerKey.split(',') : []);
  }, [peerKey, meshReady]);

  // Що й кому надсилаю — за політикою сервера
  useEffect(() => {
    if (!mesh.current || !policy || !meMember) return;
    const audio = media.micOn && !meMember.adminMutedMic ? media.audioTrack : null;
    const video = media.camOn && !meMember.adminMutedCam ? media.videoTrack : null;
    mesh.current.setLocal(
      audio,
      video,
      (peer) => policyHears(policy, peer, me.id),
      (peer) => policySees(policy, peer, me.id),
    );
  }, [policy, meMember, media.micOn, media.camOn, media.audioTrack, media.videoTrack, me.id, peerKey, meshReady]);

  // Повідомляємо іншим, чи увімкнені в мене камера й мікрофон
  useEffect(() => {
    getSocket().emit('room:media', { mic: media.micOn && !!media.audioTrack, cam: media.camOn && !!media.videoTrack });
  }, [media.micOn, media.camOn, media.audioTrack, media.videoTrack, state?.status]);

  // Звуки зміни фази
  const client = state ? gameClients[gameModules.find((g) => g.id === state.gameType)?.clientEntry ?? ''] : undefined;
  useEffect(() => {
    const ps = state?.game?.publicState ?? null;
    if (ps && client?.onChange) client.onChange(prevPublic.current, ps, view, me.id);
    prevPublic.current = ps;
  }, [state?.game?.publicState, client, view, me.id]);

  if (!state || !meMember) return <Spinner full />;

  const module = gameModules.find((g) => g.id === state.gameType)!;
  const isAdmin = state.adminId === me.id;
  const nick = (id: string | null | undefined) => state.members.find((m) => m.id === id)?.nickname ?? (id ? '???' : '—');
  const gameProps: GameProps | null =
    client && state.game
      ? {
          room: state,
          publicState: state.game.publicState,
          view,
          meId: me.id,
          isAdmin,
          serverNow,
          nick: (id) => {
            const players = (state.game!.publicState as { players?: { id: string; nickname: string }[] }).players;
            return players?.find((p) => p.id === id)?.nickname ?? nick(id);
          },
          act: (action) => emitAck('game:action', { action }),
          control: (type, seconds) => emitAck('admin:control', { type, seconds }),
        }
      : null;

  const order = gameProps && client ? client.order(gameProps.publicState, state.members) : state.members.map((m) => m.id);
  const tiles = order.map((id) => state.members.find((m) => m.id === id)).filter((m): m is RoomMemberDto => !!m);

  return (
    <div className="room">
      <div className="room-main">
        {gameProps && client ? <client.Bar {...gameProps} /> : <LobbyBar state={state} />}
        <div
          className={`video-grid ${grid ? 'fitted' : ''}`}
          ref={gridRef}
          style={grid ? { gridTemplateColumns: `repeat(${grid.cols}, ${grid.width}px)` } : undefined}
        >
          {tiles.map((m) => (
            <Tile
              key={m.id}
              member={m}
              isMe={m.id === me.id}
              stream={streams.get(m.id)}
              canHear={m.id !== me.id && policyHears(state.policy, me.id, m.id)}
              canSee={m.id === me.id || policySees(state.policy, me.id, m.id)}
              localTrack={m.id === me.id ? media.videoTrack : null}
              localAudio={m.id === me.id && media.micOn && canSpeak ? media.audioTrack : null}
              info={gameProps && client ? client.tile(gameProps.publicState, view, m.id) : {}}
              peerState={peerStates.get(m.id)}
              peerLevel={m.id === me.id ? undefined : levelGetters(m.id)}
              onAudioBlocked={onAudioBlocked}
            />
          ))}
        </div>
      </div>

      <aside className="room-side">
        <div style={{ padding: '0.8rem 0.8rem 0' }}>
          <div className="tabs">
            <button className={`tab ${tab === 'game' ? 'active' : ''}`} onClick={() => setTab('game')}>
              {state.game ? 'Гра' : 'Лобі'}
            </button>
            <button
              className={`tab ${tab === 'chat' ? 'active' : ''}`}
              onClick={() => {
                setTab('chat');
                setUnread(false);
              }}
            >
              Чат {unread && <span className="unread" />}
            </button>
            <button className={`tab ${tab === 'people' ? 'active' : ''}`} onClick={() => setTab('people')}>
              Учасники
            </button>
          </div>
        </div>
        <div className="room-side-body">
          {tab === 'game' &&
            (gameProps && client ? (
              <client.Panel {...gameProps} />
            ) : (
              <LobbyPanel state={state} meId={me.id} isAdmin={isAdmin} schema={module.settingsSchema} normalize={module.normalizeSettings} minPlayers={module.minPlayers} maxPlayers={module.maxPlayers} />
            ))}
          {tab === 'chat' && <ChatPanel messages={chat} access={access} meId={me.id} />}
          {tab === 'people' && <PeoplePanel state={state} meId={me.id} isAdmin={isAdmin} />}
        </div>
      </aside>

      <div className="controls">
        <button
          className={`btn icon ${media.micOn && !meMember.adminMutedMic ? '' : 'off'}`}
          disabled={meMember.adminMutedMic}
          onClick={() => media.setMic(!media.micOn)}
          title={meMember.adminMutedMic ? 'Адмін вимкнув вам мікрофон' : media.micOn ? 'Вимкнути мікрофон' : 'Увімкнути мікрофон'}
        >
          {media.micOn && !meMember.adminMutedMic ? <MicIcon size={20} /> : <MicOffIcon size={20} />}
        </button>
        <button
          className={`btn icon ${media.camOn && !meMember.adminMutedCam ? '' : 'off'}`}
          disabled={meMember.adminMutedCam}
          onClick={() => media.setCam(!media.camOn)}
          title={meMember.adminMutedCam ? 'Адмін вимкнув вам камеру' : media.camOn ? 'Вимкнути камеру' : 'Увімкнути камеру'}
        >
          {media.camOn && !meMember.adminMutedCam ? <VideoIcon size={20} /> : <VideoOffIcon size={20} />}
        </button>
        <button className="btn icon" onClick={() => setDevicesOpen(true)} title="Пристрої">
          <SettingsIcon size={20} />
        </button>
        <span className="faint hide-sm" style={{ maxWidth: 260 }}>
          {meMember.adminMutedMic
            ? 'Адмін вимкнув вам мікрофон'
            : meMember.role === 'spectator' && state.status !== 'playing'
              ? 'Глядачі не говорять'
              : canSpeak
                ? media.micOn
                  ? 'Вас чують'
                  : 'Мікрофон вимкнено'
                : 'Зараз вас не чують'}
        </span>
        {audioBlocked && (
          <button className="btn primary" onClick={() => document.querySelectorAll<HTMLAudioElement>('audio[data-remote-audio]').forEach((a) => a.play().then(() => setAudioBlocked(false)).catch(() => {}))}>
            🔊 Увімкнути звук
          </button>
        )}
        <span className="spacer hide-sm" />
        {state.status === 'lobby' && meMember.role === 'player' && (
          <button className={`btn ${meMember.ready ? 'selected' : ''}`} onClick={() => getSocket().emit('room:ready', { ready: !meMember.ready })}>
            {meMember.ready ? '✓ Готовий(а)' : 'Я готовий(а)'}
          </button>
        )}
        {isAdmin && state.status !== 'playing' && <StartButton state={state} minPlayers={module.minPlayers} hostMode={module.hasHumanHost(state.settings)} />}
        {isAdmin && state.status === 'playing' && <GameControls state={state} />}
        <button
          className="btn danger"
          onClick={() => {
            getSocket().emit('room:leave');
            navigate('/');
          }}
        >
          Вийти
        </button>
      </div>

      {devicesOpen && (
        <Modal title="Пристрої" onClose={() => setDevicesOpen(false)}>
          <DevicePickers />
          {media.error && <p className="error-text">{media.error}</p>}
          <div className="col" style={{ marginTop: '0.8rem' }}>
            <div className="faint">Когось не чути чи не видно? Спробуйте перепідключити відео й звук з усіма.</div>
            <button
              className="btn"
              onClick={() => {
                mesh.current?.restart();
                setDevicesOpen(false);
                toast('Перепідключаємось…', 'info');
              }}
            >
              🔄 Перепідключити відео
            </button>
          </div>
        </Modal>
      )}
    </div>
  );
}

// ---------- плитка відео ----------

/** Опитує рівень звуку співрозмовника 5 разів на секунду */
function usePolledLevel(get?: () => number) {
  const [level, setLevel] = useState(0);
  useEffect(() => {
    if (!get) {
      setLevel(0);
      return;
    }
    const t = setInterval(() => setLevel(get()), 200);
    return () => clearInterval(t);
  }, [get]);
  return level;
}

function Tile({
  member,
  isMe,
  stream,
  canHear,
  canSee,
  localTrack,
  localAudio,
  info,
  peerState,
  peerLevel,
  onAudioBlocked,
}: {
  peerState?: PeerState;
  peerLevel?: () => number;
  onAudioBlocked?: () => void;
  member: RoomMemberDto;
  isMe: boolean;
  stream?: MediaStream;
  canHear: boolean;
  canSee: boolean;
  localTrack: MediaStreamTrack | null;
  localAudio: MediaStreamTrack | null;
  info: TileInfo;
}) {
  // свій голос міряємо через WebAudio, чужий — через статистику WebRTC (у Safari WebAudio з чужим потоком глючить)
  const localLevel = useAudioLevel(isMe ? localAudio : null, isMe && !!localAudio);
  const remoteLevel = usePolledLevel(!isMe && canHear && member.mic ? peerLevel : undefined);
  const speaking = (isMe ? localLevel > 0.08 : remoteLevel > 0.02);
  const showVideo = canSee && member.cam && !member.adminMutedCam && (isMe ? !!localTrack : !!stream?.getVideoTracks().length);
  const cls = ['tile', speaking && 'speaking', info.turn && !speaking && 'turn', info.dead && 'dead'].filter(Boolean).join(' ');
  return (
    <div className={cls}>
      {showVideo ? isMe ? <VideoEl track={localTrack} mirror /> : <VideoEl stream={stream} /> : <Avatar user={member} size={72} />}
      {!isMe && stream && <RemoteAudio stream={stream} muted={!canHear} onBlocked={onAudioBlocked} />}
      {!isMe && member.connected && peerState && peerState !== 'connected' && (
        <div className="tile-status">{peerState === 'failed' ? 'Немає зв’язку з цим гравцем' : 'З’єднуємось…'}</div>
      )}
      {info.seat !== undefined && <div className="tile-seat">{info.seat}</div>}
      <div className="tile-icons">
        {member.isAdmin && <span className="tile-icon" title="Адмін">👑</span>}
        {!member.connected && <span className="tile-icon" title="Немає зв'язку">📡</span>}
        {(member.adminMutedMic || !member.mic) && <span className="tile-icon" title={member.adminMutedMic ? 'Мікрофон вимкнув адмін' : 'Мікрофон вимкнено'}>🔇</span>}
        {info.dead && <span className="tile-icon">☠️</span>}
      </div>
      <div className="tile-label">
        <span className="tile-name">
          {member.nickname}
          {isMe && ' (ви)'}
        </span>
        {info.role && <span className="tile-name">{info.role}</span>}
        {info.badge && <span className="tile-name">{info.badge}</span>}
      </div>
    </div>
  );
}

// ---------- лобі ----------

const VIS_TITLE: Record<RoomVisibility, string> = { private: 'Приватна (за кодом)', friends: 'Лише для друзів', public: 'Публічна' };

function LobbyBar({ state }: { state: RoomStateDto }) {
  const link = `${location.origin}/room/${state.code}`;
  return (
    <div className="phase-bar">
      <div className="grow">
        <div className="phase-title">
          {state.status === 'over' ? 'Партію завершено' : 'Лобі'} · кімната <span className="mono">{state.code}</span>
        </div>
        <div className="faint">{state.policy.note}</div>
      </div>
      <button className="btn sm" onClick={() => copyText(state.code, 'Код скопійовано')}>
        Код
      </button>
      <button className="btn sm primary" onClick={() => copyText(link, 'Посилання скопійовано')}>
        Скопіювати посилання
      </button>
    </div>
  );
}

function LobbyPanel({
  state,
  meId,
  isAdmin,
  schema,
  normalize,
  minPlayers,
  maxPlayers,
}: {
  state: RoomStateDto;
  meId: string;
  isAdmin: boolean;
  schema: Parameters<typeof SettingsForm>[0]['schema'];
  normalize: (r: Record<string, unknown>) => Record<string, unknown>;
  minPlayers: number;
  maxPlayers: number;
}) {
  const me = state.members.find((m) => m.id === meId)!;
  const players = state.members.filter((m) => m.role === 'player');
  const update = (patch: Record<string, unknown>) => emitAck('room:update', patch).catch(toastError);
  return (
    <div className="col" style={{ gap: '1rem' }}>
      <div className="card tight col">
        <div className="row">
          <h3 className="grow" style={{ margin: 0 }}>
            Гравці {players.length}/{state.maxPlayers}
          </h3>
          <button className="btn sm" onClick={() => emitAck('room:set_role', { role: me.role === 'player' ? 'spectator' : 'player' }).catch(toastError)}>
            {me.role === 'player' ? 'Стати глядачем' : 'Стати гравцем'}
          </button>
        </div>
        <div className="list">
          {state.members.map((m) => (
            <div key={m.id} className="list-item">
              <Avatar user={m} size={28} />
              <span className="name grow">{m.nickname}</span>
              {m.isAdmin && <span className="badge accent">адмін</span>}
              {m.role === 'spectator' && <span className="badge">глядач</span>}
              {m.role === 'player' && (m.ready ? <span className="badge success">готовий</span> : <span className="badge">не готовий</span>)}
              {!m.connected && <span className="badge warn">офлайн</span>}
            </div>
          ))}
        </div>
      </div>

      <div className="card tight col">
        <h3>Запросити друзів</h3>
        <FriendsPanel roomCode={state.code} compact />
      </div>

      <div className="card tight col">
        <h3>Налаштування {!isAdmin && <span className="faint">(змінює адмін)</span>}</h3>
        <label className="field">
          Хто може зайти
          <select className="input" value={state.visibility} disabled={!isAdmin} onChange={(e) => update({ visibility: e.target.value })}>
            {Object.entries(VIS_TITLE).map(([v, t]) => (
              <option key={v} value={v}>
                {t}
              </option>
            ))}
          </select>
        </label>
        <label className="field">
          <span>
            Максимум гравців: <b style={{ color: 'var(--text)' }}>{state.maxPlayers}</b>
          </span>
          <input type="range" min={minPlayers} max={maxPlayers} value={state.maxPlayers} disabled={!isAdmin} onChange={(e) => update({ maxPlayers: Number(e.target.value) })} style={{ accentColor: 'var(--accent)' }} />
        </label>
        <SettingsForm schema={schema} value={state.settings} disabled={!isAdmin} onChange={(p) => update({ settings: normalize({ ...state.settings, ...p }) })} />
      </div>
    </div>
  );
}

function StartButton({ state, minPlayers, hostMode }: { state: RoomStateDto; minPlayers: number; hostMode: boolean }) {
  const [confirm, setConfirm] = useState(false);
  const players = state.members.filter((m) => m.role === 'player' && m.connected && !(hostMode && m.isAdmin));
  const notReady = players.filter((m) => !m.ready && !m.isAdmin);
  const start = () =>
    emitAck('admin:start')
      .then(() => setConfirm(false))
      .catch(toastError);
  if (state.status === 'over')
    return (
      <button className="btn primary" onClick={() => emitAck('admin:control', { type: 'rematch' }).catch(toastError)}>
        Реванш
      </button>
    );
  return (
    <>
      <button className="btn primary" disabled={players.length < minPlayers} title={players.length < minPlayers ? `Потрібно щонайменше ${minPlayers} гравці` : ''} onClick={() => (notReady.length ? setConfirm(true) : start())}>
        ▶ Почати гру ({players.length})
      </button>
      {confirm && (
        <Modal title="Не всі готові" onClose={() => setConfirm(false)}>
          <p>Ще не натиснули «готовий»: {notReady.map((m) => m.nickname).join(', ')}. Почати все одно?</p>
          <div className="row">
            <span className="spacer" />
            <button className="btn" onClick={() => setConfirm(false)}>
              Зачекати
            </button>
            <button className="btn primary" onClick={start}>
              Почати
            </button>
          </div>
        </Modal>
      )}
    </>
  );
}

function GameControls({ state }: { state: RoomStateDto }) {
  const [confirmStop, setConfirmStop] = useState(false);
  const ps = state.game?.publicState as { paused?: boolean } | undefined;
  const c = (type: 'next' | 'pause' | 'resume' | 'extend' | 'stop', seconds?: number) => emitAck('admin:control', { type, seconds }).catch(toastError);
  return (
    <>
      {ps?.paused ? (
        <button className="btn" onClick={() => c('resume')} title="Продовжити">
          ▶
        </button>
      ) : (
        <button className="btn" onClick={() => c('pause')} title="Пауза">
          ⏸
        </button>
      )}
      <button className="btn" onClick={() => c('extend', 30)} title="Додати 30 секунд">
        +30с
      </button>
      <button className="btn" onClick={() => c('next')} title="Пропустити фазу">
        ⏭
      </button>
      <button className="btn danger" onClick={() => setConfirmStop(true)} title="Зупинити партію">
        ⏹
      </button>
      {confirmStop && (
        <Modal title="Зупинити партію?" onClose={() => setConfirmStop(false)}>
          <p>Партія завершиться без переможця.</p>
          <div className="row">
            <span className="spacer" />
            <button className="btn" onClick={() => setConfirmStop(false)}>
              Ні
            </button>
            <button
              className="btn danger"
              onClick={() => {
                void c('stop');
                setConfirmStop(false);
              }}
            >
              Зупинити
            </button>
          </div>
        </Modal>
      )}
    </>
  );
}

// ---------- учасники й панель адміна ----------

function PeoplePanel({ state, meId, isAdmin }: { state: RoomStateDto; meId: string; isAdmin: boolean }) {
  const [kick, setKick] = useState<RoomMemberDto | null>(null);
  const run = (p: Promise<unknown>) => p.catch(toastError);
  const sorted = useMemo(() => [...state.members].sort((a, b) => Number(b.isAdmin) - Number(a.isAdmin)), [state.members]);
  return (
    <div className="col" style={{ gap: '1rem' }}>
      <div className="list">
        {sorted.map((m) => (
          <div key={m.id} className="list-item" style={{ flexWrap: 'wrap' }}>
            <Avatar user={m} size={30} />
            <div className="grow">
              <div className="name">
                {m.nickname} {m.id === meId && <span className="faint">(ви)</span>}
              </div>
              <div className="faint">
                {m.isAdmin ? 'адмін · ' : ''}
                {m.role === 'spectator' ? 'глядач' : 'гравець'}
                {!m.connected && ' · немає зв’язку'}
              </div>
            </div>
            {isAdmin && m.id !== meId && (
              <div className="row" style={{ gap: '0.25rem' }}>
                <button className={`btn sm ${m.adminMutedMic ? 'off' : ''}`} title={m.adminMutedMic ? 'Повернути мікрофон' : 'Вимкнути мікрофон'} onClick={() => run(emitAck('admin:mute', { userId: m.id, kind: 'mic', muted: !m.adminMutedMic }))}>
                  {m.adminMutedMic ? '🔇' : '🎙'}
                </button>
                <button className={`btn sm ${m.adminMutedCam ? 'off' : ''}`} title={m.adminMutedCam ? 'Повернути камеру' : 'Вимкнути камеру'} onClick={() => run(emitAck('admin:mute', { userId: m.id, kind: 'cam', muted: !m.adminMutedCam }))}>
                  {m.adminMutedCam ? '🚫' : '📷'}
                </button>
                <button className="btn sm" title="Передати права адміна" onClick={() => run(emitAck('admin:transfer', { userId: m.id }))}>
                  👑
                </button>
                <button className="btn sm danger" title="Вигнати" onClick={() => setKick(m)}>
                  ✕
                </button>
              </div>
            )}
          </div>
        ))}
      </div>
      {state.adminLog.length > 0 && (
        <details className="card tight">
          <summary style={{ cursor: 'pointer', fontWeight: 700 }}>Журнал дій адміна</summary>
          <div className="col" style={{ marginTop: '0.5rem', gap: '0.25rem' }}>
            {[...state.adminLog].reverse().map((e, i) => (
              <div key={i} className="faint">
                {new Date(e.ts).toLocaleTimeString('uk-UA', { hour: '2-digit', minute: '2-digit' })} · {e.text}
              </div>
            ))}
          </div>
        </details>
      )}
      {kick && (
        <Modal title={`Вигнати ${kick.nickname}?`} onClose={() => setKick(null)}>
          <p className="muted">Якщо йде гра, гравець вибуде з партії.</p>
          <div className="row wrap">
            <span className="spacer" />
            <button className="btn" onClick={() => setKick(null)}>
              Скасувати
            </button>
            <button className="btn danger" onClick={() => run(emitAck('admin:kick', { userId: kick.id, ban: false })).then(() => setKick(null))}>
              Вигнати
            </button>
            <button className="btn danger" onClick={() => run(emitAck('admin:kick', { userId: kick.id, ban: true })).then(() => setKick(null))}>
              Вигнати назавжди
            </button>
          </div>
        </Modal>
      )}
    </div>
  );
}
