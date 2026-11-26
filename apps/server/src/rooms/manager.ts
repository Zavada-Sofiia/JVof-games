import { randomUUID } from 'node:crypto';
import { GameError, type ChatAccess, type ControlAction, type GameModule } from '@jvof/game-core';
import {
  ROOM_CODE_LENGTH,
  type AdminLogEntry,
  type AudioPolicy,
  type ChatMessageDto,
  type CreateRoomInput,
  type PublicRoomDto,
  type PublicUser,
  type RoomInfoDto,
  type RoomMemberRole,
  type RoomStateDto,
  type RoomVisibility,
} from '@jvof/shared';
import { Prisma, prisma } from '../db';
import { areFriends, blockedEitherWay } from '../friends/service';
import { getGameModule } from '../games/registry';
import { randomCode } from '../lib/crypto';
import { badRequest, forbidden, notFound } from '../lib/errors';
import { getIO, onUserUpdated } from '../realtime/hub';
import { presence } from '../realtime/presence';
import { publicUserSelect, toPublicUser } from '../users/dto';

const LOBBY_DISCONNECT_MS = 90_000;
const GAME_DISCONNECT_MS = 5 * 60_000;
const ADMIN_DISCONNECT_MS = 30_000;
const EMPTY_ROOM_MS = 10 * 60_000;
const CHAT_LIMIT = 300;
const ADMIN_LOG_LIMIT = 100;

/** Помилка, яку можна показати користувачу (відповідь на сокет-подію) */
export class RoomError extends Error {}

interface Member {
  user: PublicUser;
  role: RoomMemberRole;
  ready: boolean;
  socketId: string | null;
  mic: boolean;
  cam: boolean;
  adminMutedMic: boolean;
  adminMutedCam: boolean;
  disconnectedAt: number | null;
  dbId: string | null;
}

interface ActiveGame {
  id: string;
  state: unknown;
  startedAt: Date;
  config: Record<string, unknown>;
  participants: Set<string>;
  hostId: string | null;
}

export class Room {
  members = new Map<string, Member>();
  banned = new Set<string>();
  invited = new Set<string>();
  chat: ChatMessageDto[] = [];
  adminLog: AdminLogEntry[] = [];
  game: ActiveGame | null = null;
  status: 'lobby' | 'playing' | 'over' = 'lobby';
  timer: NodeJS.Timeout | null = null;
  emptySince: number | null = Date.now();

  constructor(
    public id: string,
    public code: string,
    public module: GameModule,
    public ownerId: string,
    public adminId: string,
    public visibility: RoomVisibility,
    public maxPlayers: number,
    public settings: Record<string, unknown>,
  ) {}

  get channel() {
    return `room:${this.code}`;
  }
  get playerCount() {
    return [...this.members.values()].filter((m) => m.role === 'player').length;
  }
  get allowSpectators() {
    return this.settings.allowSpectators !== false;
  }
  isParticipant(userId: string) {
    return !!this.game?.participants.has(userId);
  }
  connectedMembers() {
    return [...this.members.values()].filter((m) => m.socketId);
  }
}

class RoomManager {
  private rooms = new Map<string, Room>();
  private sweeper: NodeJS.Timeout | null = null;

  start() {
    this.sweeper = setInterval(() => this.sweep(), 10_000);
    onUserUpdated((id) => this.refreshUser(id));
  }

  stop() {
    if (this.sweeper) clearInterval(this.sweeper);
    for (const r of this.rooms.values()) if (r.timer) clearTimeout(r.timer);
  }

  // ---------- створення й пошук ----------

  async create(ownerId: string, input: CreateRoomInput): Promise<string> {
    const module = getGameModule(input.gameType);
    if (!module) throw badRequest('Невідома гра');
    const settings = module.normalizeSettings(input.settings);
    const maxPlayers = Math.min(module.maxPlayers, Math.max(module.minPlayers, input.maxPlayers));
    for (let i = 0; i < 20; i++) {
      const code = randomCode(ROOM_CODE_LENGTH);
      if (this.rooms.has(code)) continue;
      try {
        const row = await prisma.room.create({
          data: { code, ownerId, gameType: module.id, visibility: input.visibility, settingsJson: { ...settings, maxPlayers } as Prisma.InputJsonValue },
        });
        this.rooms.set(code, new Room(row.id, code, module, ownerId, ownerId, input.visibility, maxPlayers, settings));
        return code;
      } catch (e) {
        if (e instanceof Prisma.PrismaClientKnownRequestError && e.code === 'P2002') continue;
        throw e;
      }
    }
    throw new Error('Не вдалося згенерувати код кімнати');
  }

  /** Кімната з пам'яті, або відновлена з БД після перезапуску сервера */
  async load(code: string): Promise<Room | null> {
    const existing = this.rooms.get(code);
    if (existing) return existing;
    const row = await prisma.room.findUnique({ where: { code } });
    if (!row || row.status === 'closed') return null;
    const module = getGameModule(row.gameType);
    if (!module) return null;
    const { maxPlayers, ...raw } = row.settingsJson as Record<string, unknown>;
    const settings = module.normalizeSettings(raw);
    const room = new Room(row.id, code, module, row.ownerId, row.ownerId, row.visibility, Number(maxPlayers) || module.defaultMaxPlayers, settings);
    this.rooms.set(code, room);
    if (row.status !== 'open') await prisma.room.update({ where: { id: row.id }, data: { status: 'open' } });
    return room;
  }

  get(code: string) {
    return this.rooms.get(code);
  }

  private roomOfUser(userId: string): Room | undefined {
    for (const r of this.rooms.values()) if (r.members.has(userId)) return r;
    return undefined;
  }

  private async requireRoom(code: string): Promise<Room> {
    const room = await this.load(code.toUpperCase());
    if (!room) throw notFound('Кімнату не знайдено або її вже закрито');
    return room;
  }

  async publicRooms(viewerId: string): Promise<PublicRoomDto[]> {
    const list = [...this.rooms.values()].filter((r) => r.visibility === 'public' && r.members.size > 0 && !r.banned.has(viewerId));
    const owners = await prisma.user.findMany({ where: { id: { in: list.map((r) => r.ownerId) } }, select: publicUserSelect });
    const blocks = await prisma.block.findMany({
      where: { OR: [{ blockerId: viewerId }, { blockedId: viewerId }] },
      select: { blockerId: true, blockedId: true },
    });
    const blocked = new Set(blocks.flatMap((b) => [b.blockerId, b.blockedId]));
    return list
      .filter((r) => !blocked.has(r.ownerId))
      .flatMap((r) => {
        const o = owners.find((u) => u.id === r.ownerId);
        return o ? [{ code: r.code, gameTitle: r.module.title, owner: toPublicUser(o), playerCount: r.playerCount, maxPlayers: r.maxPlayers, status: r.status }] : [];
      });
  }

  async info(code: string, userId: string): Promise<RoomInfoDto> {
    const room = await this.requireRoom(code);
    const owner = await prisma.user.findUnique({ where: { id: room.ownerId }, select: publicUserSelect });
    if (!owner) throw notFound('Кімнату не знайдено');
    const check = await this.checkJoin(room, userId);
    return {
      code: room.code,
      gameType: room.module.id,
      gameTitle: room.module.title,
      visibility: room.visibility,
      owner: toPublicUser(owner),
      playerCount: room.playerCount,
      maxPlayers: room.maxPlayers,
      status: room.status,
      canJoin: check.ok,
      reason: check.ok ? undefined : check.reason,
    };
  }

  // ---------- вхід і вихід ----------

  private async checkJoin(room: Room, userId: string): Promise<{ ok: true; role: RoomMemberRole } | { ok: false; reason: string }> {
    const member = room.members.get(userId);
    if (member) return { ok: true, role: member.role };
    if (room.banned.has(userId)) return { ok: false, reason: 'Адмін вигнав вас із цієї кімнати' };
    if (userId !== room.ownerId) {
      if ((await blockedEitherWay(userId, room.ownerId)) || (room.adminId !== room.ownerId && (await blockedEitherWay(userId, room.adminId)))) {
        return { ok: false, reason: 'Немає доступу до цієї кімнати' };
      }
      if (room.visibility === 'friends' && !room.invited.has(userId) && !(await areFriends(userId, room.ownerId))) {
        return { ok: false, reason: 'Ця кімната лише для друзів власника' };
      }
    }
    if (room.status === 'playing') {
      if (room.isParticipant(userId)) return { ok: true, role: 'player' };
      return room.allowSpectators ? { ok: true, role: 'spectator' } : { ok: false, reason: 'Гра вже йде, глядачів у цій кімнаті не пускають' };
    }
    if (room.playerCount < room.maxPlayers) return { ok: true, role: 'player' };
    return room.allowSpectators ? { ok: true, role: 'spectator' } : { ok: false, reason: 'Кімната заповнена' };
  }

  /** Додати користувача до кімнати (без сокета). Повертає роль. */
  async join(code: string, userId: string): Promise<{ role: RoomMemberRole }> {
    const room = await this.requireRoom(code);
    if (room.members.has(userId)) return { role: room.members.get(userId)!.role };
    const check = await this.checkJoin(room, userId);
    if (!check.ok) throw forbidden(check.reason);

    // Одночасно можна бути лише в одній кімнаті
    const prev = this.roomOfUser(userId);
    if (prev && prev !== room) this.removeMember(prev, userId, 'left');

    const u = await prisma.user.findUnique({ where: { id: userId }, select: publicUserSelect });
    if (!u) throw notFound();
    const db = await prisma.roomMember.create({ data: { roomId: room.id, userId, role: check.role }, select: { id: true } });
    room.members.set(userId, {
      user: toPublicUser(u),
      role: check.role,
      ready: false,
      socketId: null,
      mic: false,
      cam: false,
      adminMutedMic: false,
      adminMutedCam: false,
      disconnectedAt: Date.now(),
      dbId: db.id,
    });
    if (!room.members.has(room.adminId)) room.adminId = userId;
    room.invited.delete(userId);
    this.broadcast(room);
    return { role: check.role };
  }

  /** Сокет заходить у кімнату (після join або при реконнекті) */
  async attach(socketId: string, userId: string, code: string): Promise<{ room: Room; chat: ChatMessageDto[] }> {
    const room = await this.requireRoom(code);
    if (!room.members.has(userId)) await this.join(code, userId);
    const m = room.members.get(userId)!;
    const io = getIO();
    if (m.socketId && m.socketId !== socketId) {
      const old = io.sockets.sockets.get(m.socketId);
      if (old) {
        old.emit('notice', { text: 'Ви відкрили цю кімнату в іншій вкладці', kind: 'info' });
        old.emit('room:closed', { code: room.code });
        old.leave(room.channel);
      }
    }
    m.socketId = socketId;
    m.disconnectedAt = null;
    room.emptySince = null;
    io.sockets.sockets.get(socketId)?.join(room.channel);
    presence.setRoom(userId, room.code, room.status === 'playing' && room.isParticipant(userId));
    this.broadcast(room);
    const access = this.chatAccess(room, userId);
    return { room, chat: room.chat.filter((c) => access.read.includes(c.channel)) };
  }

  detach(socketId: string, userId: string) {
    const room = this.roomOfUser(userId);
    const m = room?.members.get(userId);
    if (!room || !m || m.socketId !== socketId) return;
    m.socketId = null;
    m.disconnectedAt = Date.now();
    m.mic = false;
    m.cam = false;
    this.broadcast(room);
  }

  leave(userId: string) {
    const room = this.roomOfUser(userId);
    if (room) this.removeMember(room, userId, 'left');
  }

  removeUserEverywhere(userId: string) {
    this.leave(userId);
  }

  private removeMember(room: Room, userId: string, reason: 'left' | 'kicked' | 'timeout') {
    const m = room.members.get(userId);
    if (!m) return;
    room.members.delete(userId);
    if (m.socketId) getIO().sockets.sockets.get(m.socketId)?.leave(room.channel);
    presence.setRoom(userId, null);
    if (m.dbId) prisma.roomMember.update({ where: { id: m.dbId }, data: { leftAt: new Date() } }).catch(() => {});

    if (room.status === 'playing' && room.game?.participants.has(userId)) {
      const action: ControlAction = room.game.hostId === userId ? { type: '@host_left' } : { type: '@remove_player', playerId: userId };
      this.safeDispatch(room, null, action);
    }
    if (room.adminId === userId) this.transferAdminAuto(room);
    if (reason === 'left') this.log(room, userId, `${m.user.nickname} вийшов(ла) з кімнати`, false);
    if (room.members.size === 0) room.emptySince = Date.now();
    this.broadcast(room);
  }

  private transferAdminAuto(room: Room) {
    const candidates = room.connectedMembers().filter((m) => m.user.id !== room.adminId);
    const players = candidates.filter((m) => m.role === 'player');
    const pick = (players.length ? players : candidates)[Math.floor(Math.random() * (players.length || candidates.length))];
    if (!pick) return;
    if (room.status === 'playing' && room.game?.hostId === room.adminId) this.safeDispatch(room, null, { type: '@host_left' });
    room.adminId = pick.user.id;
    this.log(room, pick.user.id, `Права адміна автоматично перейшли до ${pick.user.nickname}`, false);
  }

  // ---------- стан для клієнтів ----------

  private policy(room: Room): AudioPolicy {
    const members = [...room.members.values()];
    const mutedMic = new Set(members.filter((m) => m.adminMutedMic).map((m) => m.user.id));
    const mutedCam = new Set(members.filter((m) => m.adminMutedCam).map((m) => m.user.id));
    const spectators = new Set(members.filter((m) => m.role === 'spectator' && !room.isParticipant(m.user.id)).map((m) => m.user.id));

    let base: AudioPolicy;
    if (room.status === 'playing' && room.game) {
      base = room.module.engine.getAudioPolicy(room.game.state);
    } else {
      const speakers = members.filter((m) => !spectators.has(m.user.id)).map((m) => m.user.id);
      const all = members.map((m) => m.user.id);
      const hear: Record<string, string[]> = {};
      const see: Record<string, string[]> = {};
      for (const id of all) {
        hear[id] = speakers.filter((x) => x !== id);
        see[id] = speakers.filter((x) => x !== id);
      }
      base = { speakers, hear, see, observers: { hear: speakers, see: speakers }, note: room.status === 'over' ? 'Гру завершено: усі можуть говорити' : 'Лобі: усі говорять вільно' };
    }
    const canTalk = (id: string) => !mutedMic.has(id) && !spectators.has(id);
    const canShow = (id: string) => !mutedCam.has(id) && !spectators.has(id);
    const mapVals = (rec: Record<string, string[]>, f: (id: string) => boolean) =>
      Object.fromEntries(Object.entries(rec).map(([k, v]) => [k, v.filter(f)]));
    return {
      speakers: base.speakers.filter(canTalk),
      hear: mapVals(base.hear, canTalk),
      see: mapVals(base.see, canShow),
      observers: { hear: base.observers.hear.filter(canTalk), see: base.observers.see.filter(canShow) },
      note: base.note,
    };
  }

  private chatAccess(room: Room, userId: string): ChatAccess {
    if (room.status === 'playing' && room.game) {
      if (!room.isParticipant(userId)) return { read: ['main', 'spectators'], write: ['spectators'] };
      return room.module.engine.getChatAccess(room.game.state, userId);
    }
    if (room.status === 'over') return { read: ['main', 'mafia', 'ghosts', 'spectators'], write: ['main'] };
    return { read: ['main'], write: ['main'] };
  }

  private stateDto(room: Room): RoomStateDto {
    const now = Date.now();
    return {
      code: room.code,
      gameType: room.module.id,
      visibility: room.visibility,
      maxPlayers: room.maxPlayers,
      settings: room.settings,
      ownerId: room.ownerId,
      adminId: room.adminId,
      members: [...room.members.values()].map((m) => ({
        ...m.user,
        role: m.role,
        isAdmin: m.user.id === room.adminId,
        ready: m.ready,
        connected: !!m.socketId,
        mic: m.mic,
        cam: m.cam,
        adminMutedMic: m.adminMutedMic,
        adminMutedCam: m.adminMutedCam,
      })),
      status: room.status,
      game: room.game ? { id: room.game.id, publicState: room.module.engine.getPublicState(room.game.state, now) } : null,
      policy: this.policy(room),
      adminLog: room.adminLog,
      serverNow: now,
    };
  }

  broadcast(room: Room) {
    const io = getIO();
    io.to(room.channel).emit('room:state', this.stateDto(room));
    if (room.game) {
      for (const m of room.members.values()) {
        if (!m.socketId) continue;
        io.to(m.socketId).emit('player:view', room.module.engine.getPlayerView(room.game.state, m.user.id));
      }
    }
  }

  private log(room: Room, adminId: string, text: string, broadcast = true) {
    room.adminLog.push({ ts: Date.now(), adminId, text });
    if (room.adminLog.length > ADMIN_LOG_LIMIT) room.adminLog.shift();
    if (broadcast) this.broadcast(room);
  }

  private refreshUser(userId: string) {
    const room = this.roomOfUser(userId);
    if (!room) return;
    prisma.user
      .findUnique({ where: { id: userId }, select: publicUserSelect })
      .then((u) => {
        const m = room.members.get(userId);
        if (u && m) {
          m.user = toPublicUser(u);
          this.broadcast(room);
        }
      })
      .catch(() => {});
  }

  // ---------- дії учасників ----------

  private async member(code: string, userId: string): Promise<{ room: Room; m: Member }> {
    const room = this.rooms.get(code);
    const m = room?.members.get(userId);
    if (!room || !m) throw new RoomError('Ви не в цій кімнаті');
    return { room, m };
  }

  private requireAdmin(room: Room, userId: string) {
    if (room.adminId !== userId) throw new RoomError('Це може зробити лише адмін кімнати');
  }

  async setReady(code: string, userId: string, ready: boolean) {
    const { room, m } = await this.member(code, userId);
    m.ready = ready;
    this.broadcast(room);
  }

  async setMedia(code: string, userId: string, mic: boolean, cam: boolean) {
    const { room, m } = await this.member(code, userId);
    if (m.mic === mic && m.cam === cam) return;
    m.mic = mic;
    m.cam = cam;
    this.broadcast(room);
  }

  async setRole(code: string, userId: string, role: RoomMemberRole) {
    const { room, m } = await this.member(code, userId);
    if (room.status === 'playing') throw new RoomError('Під час гри роль змінити не можна');
    if (role === m.role) return;
    if (role === 'player' && room.playerCount >= room.maxPlayers) throw new RoomError('Місць для гравців уже немає');
    m.role = role;
    m.ready = false;
    this.broadcast(room);
  }

  async chat(code: string, userId: string, channel: string, text: string) {
    const { room, m } = await this.member(code, userId);
    if (!this.chatAccess(room, userId).write.includes(channel)) throw new RoomError('Зараз у цей чат писати не можна');
    const msg: ChatMessageDto = { id: randomUUID(), channel, userId, nickname: m.user.nickname, text, ts: Date.now() };
    room.chat.push(msg);
    if (room.chat.length > CHAT_LIMIT) room.chat.shift();
    const io = getIO();
    for (const other of room.members.values()) {
      if (other.socketId && this.chatAccess(room, other.user.id).read.includes(channel)) io.to(other.socketId).emit('room:chat', msg);
    }
  }

  async update(code: string, userId: string, patch: { visibility?: RoomVisibility; maxPlayers?: number; settings?: Record<string, unknown> }) {
    const { room } = await this.member(code, userId);
    this.requireAdmin(room, userId);
    if (room.status === 'playing') throw new RoomError('Налаштування не можна змінювати під час гри');
    if (patch.maxPlayers !== undefined) {
      const max = Math.min(room.module.maxPlayers, Math.max(room.module.minPlayers, patch.maxPlayers));
      if (max < room.playerCount) throw new RoomError(`Зараз у кімнаті вже ${room.playerCount} гравців`);
      room.maxPlayers = max;
    }
    if (patch.visibility) room.visibility = patch.visibility;
    if (patch.settings) room.settings = room.module.normalizeSettings({ ...room.settings, ...patch.settings });
    await prisma.room.update({
      where: { id: room.id },
      data: { visibility: room.visibility, settingsJson: { ...room.settings, maxPlayers: room.maxPlayers } as Prisma.InputJsonValue },
    });
    this.broadcast(room);
  }

  async transferAdmin(code: string, userId: string, targetId: string) {
    const { room } = await this.member(code, userId);
    this.requireAdmin(room, userId);
    const target = room.members.get(targetId);
    if (!target || !target.socketId) throw new RoomError('Цього учасника зараз немає в кімнаті');
    if (room.status === 'playing' && room.game?.hostId) throw new RoomError('Під час гри з ведучим-людиною права передати не можна');
    room.adminId = targetId;
    this.log(room, userId, `Права адміна передано: ${target.user.nickname}`);
  }

  async adminMute(code: string, userId: string, targetId: string, kind: 'mic' | 'cam', muted: boolean) {
    const { room } = await this.member(code, userId);
    this.requireAdmin(room, userId);
    const t = room.members.get(targetId);
    if (!t) throw new RoomError('Учасника не знайдено');
    if (kind === 'mic') t.adminMutedMic = muted;
    else t.adminMutedCam = muted;
    const what = kind === 'mic' ? 'мікрофон' : 'камеру';
    this.log(room, userId, `${muted ? 'Вимкнено' : 'Повернено'} ${what}: ${t.user.nickname}`);
  }

  async kick(code: string, userId: string, targetId: string, ban: boolean) {
    const { room } = await this.member(code, userId);
    this.requireAdmin(room, userId);
    if (targetId === userId) throw new RoomError('Не можна вигнати себе');
    const t = room.members.get(targetId);
    if (!t) throw new RoomError('Учасника не знайдено');
    if (ban) room.banned.add(targetId);
    if (t.socketId) getIO().to(t.socketId).emit('room:kicked', { code: room.code, banned: ban });
    this.log(room, userId, `${ban ? 'Вигнано назавжди' : 'Вигнано'}: ${t.user.nickname}`, false);
    this.removeMember(room, targetId, 'kicked');
  }

  async invite(code: string, userId: string, friendId: string) {
    const room = this.rooms.get(code);
    if (!room?.members.has(userId)) throw forbidden('Ви не в цій кімнаті');
    if (!(await areFriends(userId, friendId))) throw forbidden('Запрошувати можна лише друзів');
    if (await blockedEitherWay(userId, friendId)) throw forbidden('Немає доступу');
    room.invited.add(friendId);
    room.banned.delete(friendId);
    return room;
  }

  // ---------- гра ----------

  async startGame(code: string, userId: string) {
    const { room } = await this.member(code, userId);
    this.requireAdmin(room, userId);
    if (room.status === 'playing') throw new RoomError('Гра вже йде');
    const hostId = room.module.hasHumanHost(room.settings) ? room.adminId : null;
    const players = [...room.members.values()].filter((m) => m.role === 'player' && m.socketId && m.user.id !== hostId);
    if (players.length < room.module.minPlayers) throw new RoomError(`Потрібно щонайменше ${room.module.minPlayers} гравці онлайн (зараз ${players.length})`);
    if (players.length > room.module.maxPlayers) throw new RoomError(`Забагато гравців: максимум ${room.module.maxPlayers}`);

    let state: unknown;
    try {
      state = room.module.engine.start(
        players.map((m, i) => ({ id: m.user.id, nickname: m.user.nickname, seat: i + 1 })),
        room.settings,
        { now: Date.now(), random: Math.random, hostId },
      );
    } catch (e) {
      if (e instanceof GameError) throw new RoomError(e.message);
      throw e;
    }
    const participants = new Set(players.map((m) => m.user.id));
    if (hostId) participants.add(hostId);
    room.game = { id: randomUUID(), state, startedAt: new Date(), config: { ...room.settings }, participants, hostId };
    room.status = 'playing';
    room.chat = room.chat.filter((c) => c.channel === 'main');
    for (const m of room.members.values()) m.ready = false;
    for (const id of participants) presence.setRoom(id, room.code, true);
    prisma.room.update({ where: { id: room.id }, data: { status: 'playing' } }).catch(() => {});
    this.log(room, userId, 'Гру розпочато', false);
    this.afterChange(room);
  }

  async gameAction(code: string, userId: string, action: unknown) {
    const { room } = await this.member(code, userId);
    if (room.status !== 'playing' || !room.game) throw new RoomError('Гра зараз не йде');
    if (typeof action !== 'object' || action === null) throw new RoomError('Некоректна дія');
    this.dispatch(room, userId, action);
  }

  async control(code: string, userId: string, type: 'next' | 'pause' | 'resume' | 'extend' | 'stop' | 'rematch', seconds?: number) {
    const { room } = await this.member(code, userId);
    this.requireAdmin(room, userId);
    if (type === 'rematch') {
      if (room.status !== 'over') throw new RoomError('Реванш можна почати після завершення партії');
      room.status = 'lobby';
      room.game = null;
      room.chat = room.chat.filter((c) => c.channel === 'main');
      for (const m of room.members.values()) m.ready = false;
      this.log(room, userId, 'Реванш: повертаємось у лобі');
      return;
    }
    if (room.status !== 'playing') throw new RoomError('Гра зараз не йде');
    const map = {
      next: { type: '@next' },
      pause: { type: '@pause' },
      resume: { type: '@resume' },
      extend: { type: '@extend', ms: Math.max(5, Math.min(300, seconds ?? 30)) * 1000 },
      stop: { type: '@stop' },
    } as const satisfies Record<string, ControlAction>;
    const text = { next: 'Наступна фаза', pause: 'Пауза', resume: 'Продовжено', extend: `Таймер +${seconds ?? 30} с`, stop: 'Партію зупинено' }[type];
    room.adminLog.push({ ts: Date.now(), adminId: userId, text });
    this.dispatch(room, null, map[type]);
  }

  private dispatch(room: Room, actorId: string | null, action: unknown) {
    if (!room.game) return;
    try {
      room.game.state = room.module.engine.handleAction(room.game.state, actorId, action, { now: Date.now(), random: Math.random });
    } catch (e) {
      if (e instanceof GameError) throw new RoomError(e.message);
      throw e;
    }
    this.afterChange(room);
  }

  private safeDispatch(room: Room, actorId: string | null, action: unknown) {
    try {
      this.dispatch(room, actorId, action);
    } catch (e) {
      if (!(e instanceof RoomError)) console.error('game dispatch failed', e);
    }
  }

  private afterChange(room: Room) {
    if (!room.game) return;
    if (room.timer) clearTimeout(room.timer);
    room.timer = null;
    const engine = room.module.engine;
    if (engine.isOver(room.game.state)) {
      room.status = 'over';
      for (const id of room.game.participants) if (room.members.has(id)) presence.setRoom(id, room.code, false);
      this.persistGame(room).catch((e) => console.error('Не вдалося зберегти партію', e));
      prisma.room.update({ where: { id: room.id }, data: { status: 'open' } }).catch(() => {});
      this.broadcast(room);
      // Після гри всі бачать усі чати (мафії, привидів) — надсилаємо історію заново
      const io = getIO();
      for (const m of room.members.values()) if (m.socketId) io.to(m.socketId).emit('room:chat_sync', room.chat);
      return;
    }
    const deadline = engine.getNextDeadline(room.game.state);
    if (deadline !== null) {
      room.timer = setTimeout(() => this.safeDispatch(room, null, { type: '@timeout' }), Math.max(0, deadline - Date.now()) + 25);
    }
    this.broadcast(room);
  }

  private async persistGame(room: Room) {
    const g = room.game;
    if (!g) return;
    const engine = room.module.engine;
    const result = engine.getResult(g.state);
    if (!result) return;
    const existingUsers = new Set(
      (await prisma.user.findMany({ where: { id: { in: result.players.map((p) => p.id) } }, select: { id: true } })).map((u) => u.id),
    );
    const events = engine.getEvents(g.state);
    const isUuid = (s: string | null) => !!s && /^[0-9a-f-]{36}$/i.test(s);
    await prisma.game.create({
      data: {
        id: g.id,
        roomId: room.id,
        gameType: room.module.id,
        configJson: { ...g.config, hostId: g.hostId } as Prisma.InputJsonValue,
        startedAt: g.startedAt,
        endedAt: new Date(),
        winner: result.winner,
        players: {
          createMany: {
            data: result.players
              .filter((p) => existingUsers.has(p.id))
              .map((p) => ({ userId: p.id, seat: p.seat, role: p.role, team: p.team, isAlive: p.isAlive, diedAtPhase: p.diedAtPhase, won: p.won })),
          },
        },
        events: {
          createMany: {
            data: events.map((e) => ({
              seq: e.seq,
              phase: e.phase,
              type: e.type,
              actorId: isUuid(e.actorId) && existingUsers.has(e.actorId!) ? e.actorId : null,
              payloadJson: (e.payload ?? {}) as Prisma.InputJsonValue,
              ts: new Date(e.ts),
            })),
          },
        },
      },
    });
  }

  // ---------- WebRTC-сигналізація ----------

  canSignal(code: string | undefined, from: string, to: string): string | null {
    if (!code) return null;
    const room = this.rooms.get(code);
    const a = room?.members.get(from);
    const b = room?.members.get(to);
    if (!a?.socketId || !b?.socketId) return null;
    return b.socketId;
  }

  isMember(code: string, userId: string) {
    return !!this.rooms.get(code)?.members.has(userId);
  }

  // ---------- прибирання ----------

  private sweep() {
    const now = Date.now();
    for (const room of this.rooms.values()) {
      for (const m of [...room.members.values()]) {
        if (m.socketId || m.disconnectedAt === null) continue;
        const gone = now - m.disconnectedAt;
        const inGame = room.status === 'playing' && room.isParticipant(m.user.id);
        if (gone > (inGame ? GAME_DISCONNECT_MS : LOBBY_DISCONNECT_MS)) this.removeMember(room, m.user.id, 'timeout');
        else if (m.user.id === room.adminId && gone > ADMIN_DISCONNECT_MS && room.connectedMembers().length > 0) {
          this.transferAdminAuto(room);
          this.broadcast(room);
        }
      }
      if (room.connectedMembers().length === 0) {
        room.emptySince ??= now;
        if (now - room.emptySince > EMPTY_ROOM_MS) this.close(room);
      } else room.emptySince = null;
    }
  }

  private close(room: Room) {
    if (room.timer) clearTimeout(room.timer);
    for (const id of room.members.keys()) presence.setRoom(id, null);
    getIO().to(room.channel).emit('room:closed', { code: room.code });
    this.rooms.delete(room.code);
    prisma.room.update({ where: { id: room.id }, data: { status: 'closed' } }).catch(() => {});
  }
}

export const roomManager = new RoomManager();
