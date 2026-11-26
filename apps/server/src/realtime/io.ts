import type { Server as HttpServer } from 'node:http';
import { Server } from 'socket.io';
import { chatSchema, type Ack } from '@jvof/shared';
import { verifyAccessToken } from '../auth/tokens';
import { env } from '../env';
import { HttpError } from '../lib/errors';
import { RoomError, roomManager } from '../rooms/manager';
import { setIO, userChannel, type IO } from './hub';
import { presence } from './presence';

declare module 'socket.io' {
  interface Socket {
    roomCode?: string;
  }
}

function fail(ack: Ack<any> | undefined, e: unknown) {
  const msg = e instanceof RoomError || e instanceof HttpError ? e.message : 'Щось пішло не так';
  if (!(e instanceof RoomError || e instanceof HttpError)) console.error(e);
  if (typeof ack === 'function') ack({ ok: false, error: msg });
}

/** Обгортка: виконує обробник і відповідає ack-ом ok/error */
function handle<T>(ack: Ack<T> | undefined, fn: () => Promise<T | void> | T | void) {
  Promise.resolve()
    .then(fn)
    .then((data) => typeof ack === 'function' && ack({ ok: true, data: data ?? undefined }))
    .catch((e) => fail(ack, e));
}

export function createIO(server: HttpServer): IO {
  const io: IO = new Server(server, {
    cors: { origin: env.webOrigin, credentials: true },
    pingInterval: 10_000,
    pingTimeout: 8_000,
  });
  setIO(io);

  io.use(async (socket, next) => {
    try {
      const token = socket.handshake.auth?.token;
      if (typeof token !== 'string') throw new Error();
      socket.data.userId = await verifyAccessToken(token);
      next();
    } catch {
      next(new Error('unauthorized'));
    }
  });

  io.on('connection', (socket) => {
    const userId = socket.data.userId;
    socket.join(userChannel(userId));
    presence.connect(userId, socket.id);
    const code = () => {
      if (!socket.roomCode) throw new RoomError('Спершу зайдіть у кімнату');
      return socket.roomCode;
    };

    socket.on('room:join', ({ code: c }, ack) =>
      handle(ack, async () => {
        const target = String(c ?? '').toUpperCase();
        if (socket.roomCode && socket.roomCode !== target) socket.leave(`room:${socket.roomCode}`);
        const { chat } = await roomManager.attach(socket.id, userId, target);
        socket.roomCode = target;
        return { chat };
      }),
    );

    socket.on('room:leave', () => {
      if (socket.roomCode) socket.leave(`room:${socket.roomCode}`);
      socket.roomCode = undefined;
      roomManager.leave(userId);
    });

    socket.on('room:ready', ({ ready }) => handle(undefined, () => roomManager.setReady(code(), userId, !!ready)));
    socket.on('room:media', ({ mic, cam }) => handle(undefined, () => roomManager.setMedia(code(), userId, !!mic, !!cam)));
    socket.on('room:chat', (p, ack) =>
      handle(ack, () => {
        const r = chatSchema.safeParse(p);
        if (!r.success) throw new RoomError(r.error.issues[0]?.message ?? 'Некоректне повідомлення');
        return roomManager.chat(code(), userId, r.data.channel, r.data.text);
      }),
    );
    socket.on('room:update', (p, ack) => handle(ack, () => roomManager.update(code(), userId, p ?? {})));
    socket.on('room:set_role', ({ role }, ack) =>
      handle(ack, () => {
        if (role !== 'player' && role !== 'spectator') throw new RoomError('Некоректна роль');
        return roomManager.setRole(code(), userId, role);
      }),
    );
    socket.on('admin:transfer', ({ userId: t }, ack) => handle(ack, () => roomManager.transferAdmin(code(), userId, String(t))));
    socket.on('admin:mute', ({ userId: t, kind, muted }, ack) =>
      handle(ack, () => roomManager.adminMute(code(), userId, String(t), kind === 'cam' ? 'cam' : 'mic', !!muted)),
    );
    socket.on('admin:kick', ({ userId: t, ban }, ack) => handle(ack, () => roomManager.kick(code(), userId, String(t), !!ban)));
    socket.on('admin:start', (ack) => handle(ack, () => roomManager.startGame(code(), userId)));
    socket.on('admin:control', ({ type, seconds }, ack) =>
      handle(ack, () => {
        if (!['next', 'pause', 'resume', 'extend', 'stop', 'rematch'].includes(type)) throw new RoomError('Невідома команда');
        return roomManager.control(code(), userId, type, typeof seconds === 'number' ? seconds : undefined);
      }),
    );
    socket.on('game:action', ({ action }, ack) => handle(ack, () => roomManager.gameAction(code(), userId, action)));

    // Сигналізація WebRTC: пересилаємо offer/answer/ICE лише між учасниками однієї кімнати
    socket.on('rtc:signal', ({ to, signal }) => {
      const target = roomManager.canSignal(socket.roomCode, userId, String(to));
      if (target) io.to(target).emit('rtc:signal', { from: userId, signal });
    });

    socket.on('disconnect', () => {
      presence.disconnect(userId, socket.id);
      roomManager.detach(socket.id, userId);
    });
  });

  return io;
}
