import { io, type Socket } from 'socket.io-client';
import type { ClientToServerEvents, ServerToClientEvents } from '@jvof/shared';
import { getAccessToken, refreshSession } from './api';

export type AppSocket = Socket<ServerToClientEvents, ClientToServerEvents>;

let socket: AppSocket | null = null;

export function getSocket(): AppSocket {
  if (socket) return socket;
  socket = io({
    autoConnect: false,
    transports: ['websocket', 'polling'],
    // функція: при кожному перепідключенні береться свіжий токен
    auth: (cb) => cb({ token: getAccessToken() }),
  });
  socket.on('connect_error', async (err) => {
    if (err.message === 'unauthorized') {
      if (await refreshSession()) socket?.connect();
    }
  });
  return socket;
}

export function connectSocket() {
  const s = getSocket();
  if (!s.connected) s.connect();
}

export function disconnectSocket() {
  socket?.disconnect();
}

/** emit з підтвердженням як Promise */
export function emitAck<T = unknown>(event: keyof ClientToServerEvents, ...args: unknown[]): Promise<T> {
  return new Promise((resolve, reject) => {
    const s = getSocket() as unknown as Socket;
    const timer = setTimeout(() => reject(new Error('Сервер не відповідає')), 10_000);
    s.emit(event, ...args, (r: { ok: boolean; data?: T; error?: string }) => {
      clearTimeout(timer);
      if (r.ok) resolve(r.data as T);
      else reject(new Error(r.error ?? 'Помилка'));
    });
  });
}
