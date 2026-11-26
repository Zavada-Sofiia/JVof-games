import type { PresenceStatus } from '@jvof/shared';
import { friendIdsOf } from '../friends/service';
import { emitToUser } from './hub';

/** Хто онлайн, хто в кімнаті, хто в грі. Живе в пам'яті процесу. */
class Presence {
  private sockets = new Map<string, Set<string>>();
  private rooms = new Map<string, { code: string; inGame: boolean }>();
  private last = new Map<string, string>();

  connect(userId: string, socketId: string) {
    let set = this.sockets.get(userId);
    if (!set) this.sockets.set(userId, (set = new Set()));
    set.add(socketId);
    this.changed(userId);
  }

  disconnect(userId: string, socketId: string) {
    const set = this.sockets.get(userId);
    set?.delete(socketId);
    if (set && set.size === 0) this.sockets.delete(userId);
    this.changed(userId);
  }

  isOnline = (userId: string) => this.sockets.has(userId);

  setRoom(userId: string, code: string | null, inGame = false) {
    if (code) this.rooms.set(userId, { code, inGame });
    else this.rooms.delete(userId);
    this.changed(userId);
  }

  get(userId: string): { status: PresenceStatus; roomCode: string | null } {
    if (!this.sockets.has(userId)) return { status: 'offline', roomCode: null };
    const r = this.rooms.get(userId);
    if (!r) return { status: 'online', roomCode: null };
    return { status: r.inGame ? 'in_game' : 'in_room', roomCode: r.code };
  }

  /** Повідомити друзів, якщо статус справді змінився */
  private changed(userId: string) {
    const p = this.get(userId);
    const key = `${p.status}:${p.roomCode}`;
    if (this.last.get(userId) === key) return;
    this.last.set(userId, key);
    if (p.status === 'offline') this.last.delete(userId);
    friendIdsOf(userId)
      .then((ids) => ids.forEach((id) => emitToUser(id, 'friend:presence', { userId, ...p })))
      .catch((e) => console.error('presence notify failed', e));
  }
}

export const presence = new Presence();
