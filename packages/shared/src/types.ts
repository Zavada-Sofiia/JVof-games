import type { RoomVisibility } from './schemas';

// ---------- Користувачі ----------

export interface PublicUser {
  id: string;
  nickname: string;
  avatarColor: string;
  /** URL аватара (з версією), або null якщо фото немає */
  avatarUrl: string | null;
}

export interface MeDto extends PublicUser {
  email: string;
  emailVerified: boolean;
  friendCode: string;
  createdAt: string;
  /** Коли знову можна змінити нікнейм (ISO), або null якщо вже можна */
  nicknameChangeAvailableAt: string | null;
}

export interface AuthResponse {
  accessToken: string;
  user: MeDto;
}

export type PresenceStatus = 'offline' | 'online' | 'in_room' | 'in_game';

export interface FriendDto extends PublicUser {
  status: PresenceStatus;
  /** Код кімнати, якщо друг у кімнаті */
  roomCode: string | null;
  since: string;
}

export interface FriendRequestDto {
  id: string;
  direction: 'incoming' | 'outgoing';
  user: PublicUser;
  createdAt: string;
}

export interface BlockDto {
  user: PublicUser;
  createdAt: string;
}

// ---------- Аудіо/відео політика ----------

/**
 * Хто кого чує й бачить прямо зараз. Визначає ігровий сервер, клієнти виконують.
 * Ключі мап — учасники; той, кого немає в мапі, користується `observers`.
 */
export interface AudioPolicy {
  /** Хто зараз має право говорити (для інтерфейсу) */
  speakers: string[];
  /** слухач -> кого він чує */
  hear: Record<string, string[]>;
  /** глядач -> чиє відео він бачить */
  see: Record<string, string[]>;
  /** Для всіх, кого немає в мапах (глядачі тощо) */
  observers: { hear: string[]; see: string[] };
  /** Людський опис поточного режиму звуку */
  note: string;
}

export function policyHears(policy: AudioPolicy, listener: string, speaker: string): boolean {
  const list = policy.hear[listener] ?? policy.observers.hear;
  return list.includes(speaker);
}

export function policySees(policy: AudioPolicy, viewer: string, publisher: string): boolean {
  const list = policy.see[viewer] ?? policy.observers.see;
  return list.includes(publisher);
}

// ---------- Кімнати ----------

export type RoomMemberRole = 'player' | 'spectator';

export interface RoomMemberDto extends PublicUser {
  role: RoomMemberRole;
  isAdmin: boolean;
  ready: boolean;
  connected: boolean;
  mic: boolean;
  cam: boolean;
  adminMutedMic: boolean;
  adminMutedCam: boolean;
}

export interface AdminLogEntry {
  ts: number;
  adminId: string;
  text: string;
}

export interface RoomStateDto {
  code: string;
  gameType: string;
  visibility: RoomVisibility;
  maxPlayers: number;
  settings: Record<string, unknown>;
  ownerId: string;
  adminId: string;
  members: RoomMemberDto[];
  /** 'lobby' — збираємось; 'playing' — йде партія; 'over' — партія завершена, видно підсумок */
  status: 'lobby' | 'playing' | 'over';
  game: { id: string; publicState: unknown } | null;
  policy: AudioPolicy;
  adminLog: AdminLogEntry[];
  serverNow: number;
}

export interface RoomInfoDto {
  code: string;
  gameType: string;
  gameTitle: string;
  visibility: RoomVisibility;
  owner: PublicUser;
  playerCount: number;
  maxPlayers: number;
  status: 'lobby' | 'playing' | 'over' | 'closed';
  canJoin: boolean;
  /** Чому не можна зайти (якщо canJoin = false) */
  reason?: string;
}

export interface PublicRoomDto {
  code: string;
  gameTitle: string;
  owner: PublicUser;
  playerCount: number;
  maxPlayers: number;
  status: 'lobby' | 'playing' | 'over';
}

export interface ChatMessageDto {
  id: string;
  channel: string;
  userId: string;
  nickname: string;
  text: string;
  ts: number;
}

export interface IceConfigDto {
  iceServers: { urls: string | string[]; username?: string; credential?: string }[];
}

// ---------- Історія ігор ----------

export interface GameSummaryDto {
  id: string;
  gameType: string;
  gameTitle: string;
  startedAt: string;
  endedAt: string | null;
  winner: string | null;
  myRole: string;
  myTeam: string;
  won: boolean;
  playerCount: number;
}

export interface GameDetailDto {
  id: string;
  gameType: string;
  gameTitle: string;
  startedAt: string;
  endedAt: string | null;
  winner: string | null;
  players: {
    user: PublicUser;
    seat: number;
    role: string;
    team: string;
    isAlive: boolean;
    diedAtPhase: string | null;
    won: boolean;
  }[];
  events: { seq: number; phase: string; type: string; actorId: string | null; payload: unknown; ts: string }[];
}

export interface StatsDto {
  total: number;
  wins: number;
  byRole: { role: string; games: number; wins: number }[];
  byGame: { gameType: string; gameTitle: string; games: number; wins: number }[];
}

// ---------- WebSocket ----------

export type Ack<T = unknown> = (res: { ok: true; data?: T } | { ok: false; error: string }) => void;

export interface RtcSignal {
  description?: { type: 'offer' | 'answer' | 'pranswer' | 'rollback'; sdp?: string };
  candidate?: { candidate: string; sdpMid?: string | null; sdpMLineIndex?: number | null } | null;
}

export interface ClientToServerEvents {
  'room:join': (p: { code: string }, ack: Ack<{ chat: ChatMessageDto[] }>) => void;
  'room:leave': () => void;
  'room:ready': (p: { ready: boolean }) => void;
  'room:media': (p: { mic: boolean; cam: boolean }) => void;
  'room:chat': (p: { channel: string; text: string }, ack: Ack) => void;
  'room:update': (p: { visibility?: RoomVisibility; maxPlayers?: number; settings?: Record<string, unknown> }, ack: Ack) => void;
  'room:set_role': (p: { role: RoomMemberRole }, ack: Ack) => void;
  'admin:transfer': (p: { userId: string }, ack: Ack) => void;
  'admin:mute': (p: { userId: string; kind: 'mic' | 'cam'; muted: boolean }, ack: Ack) => void;
  'admin:kick': (p: { userId: string; ban: boolean }, ack: Ack) => void;
  'admin:start': (ack: Ack) => void;
  'admin:control': (
    p: { type: 'next' | 'pause' | 'resume' | 'extend' | 'stop' | 'rematch'; seconds?: number },
    ack: Ack,
  ) => void;
  'game:action': (p: { action: unknown }, ack: Ack) => void;
  'rtc:signal': (p: { to: string; signal: RtcSignal }) => void;
}

export interface ServerToClientEvents {
  'room:state': (s: RoomStateDto) => void;
  'room:chat': (m: ChatMessageDto) => void;
  'room:chat_sync': (messages: ChatMessageDto[]) => void;
  'room:kicked': (p: { code: string; banned: boolean }) => void;
  'room:closed': (p: { code: string }) => void;
  'player:view': (v: unknown) => void;
  'room:invite': (p: { from: PublicUser; code: string; gameTitle: string }) => void;
  'friend:request': (r: FriendRequestDto) => void;
  'friend:changed': () => void;
  'friend:presence': (p: { userId: string; status: PresenceStatus; roomCode: string | null }) => void;
  'rtc:signal': (p: { from: string; signal: RtcSignal }) => void;
  notice: (p: { text: string; kind?: 'info' | 'error' }) => void;
}
