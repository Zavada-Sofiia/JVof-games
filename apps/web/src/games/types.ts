import type { FC } from 'react';
import type { RoomMemberDto, RoomStateDto } from '@jvof/shared';

export interface GameProps {
  room: RoomStateDto;
  publicState: unknown;
  view: unknown;
  meId: string;
  isAdmin: boolean;
  /** Поточний час сервера (з поправкою на розбіжність годинників) */
  serverNow: () => number;
  act: (action: unknown) => Promise<void>;
  control: (type: 'next' | 'pause' | 'resume' | 'extend' | 'stop' | 'rematch', seconds?: number) => Promise<void>;
  nick: (id: string | null | undefined) => string;
}

export interface TileInfo {
  seat?: number;
  dead?: boolean;
  /** Чия зараз черга говорити */
  turn?: boolean;
  badge?: string;
  /** Підпис ролі (видно лише тим, кому можна) */
  role?: string;
}

/** Клієнтська частина гри: свій екран, свої позначки на плитках відео, свої звуки */
export interface ClientGame {
  Bar: FC<GameProps>;
  Panel: FC<GameProps>;
  tile(publicState: unknown, view: unknown, userId: string): TileInfo;
  /** Порядок плиток відео */
  order(publicState: unknown, members: RoomMemberDto[]): string[];
  /** Звуки та сповіщення при зміні стану */
  onChange?(prev: unknown, next: unknown, view: unknown, meId: string): void;
}
