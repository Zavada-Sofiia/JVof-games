import type { Server } from 'socket.io';
import type { ClientToServerEvents, ServerToClientEvents } from '@jvof/shared';

export interface SocketData {
  userId: string;
}

export type IO = Server<ClientToServerEvents, ServerToClientEvents, Record<string, never>, SocketData>;

let io: IO | null = null;

export function setIO(server: IO) {
  io = server;
}

export function getIO(): IO {
  if (!io) throw new Error('Socket.IO ще не запущено');
  return io;
}

export const userChannel = (userId: string) => `user:${userId}`;

export function emitToUser<E extends keyof ServerToClientEvents>(
  userId: string,
  event: E,
  ...args: Parameters<ServerToClientEvents[E]>
) {
  io?.to(userChannel(userId)).emit(event, ...args);
}

// Слухачі «користувач змінив профіль» (кімнати оновлюють нікнейм/аватар учасника)
type UserUpdatedListener = (userId: string) => void;
const userUpdatedListeners: UserUpdatedListener[] = [];
export const onUserUpdated = (fn: UserUpdatedListener) => userUpdatedListeners.push(fn);
export const userUpdated = (userId: string) => userUpdatedListeners.forEach((fn) => fn(userId));
