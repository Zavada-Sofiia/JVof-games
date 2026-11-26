import { createHash } from 'node:crypto';
import type { MeDto, PublicUser } from '@jvof/shared';

export const NICKNAME_COOLDOWN_MS = 14 * 24 * 60 * 60 * 1000;

interface UserRow {
  id: string;
  nickname: string;
  avatarColor: string;
  avatarImage: string | null;
}

export function avatarUrl(u: UserRow): string | null {
  if (!u.avatarImage) return null;
  const v = createHash('sha1').update(u.avatarImage).digest('hex').slice(0, 10);
  return `/api/users/${u.id}/avatar?v=${v}`;
}

export function toPublicUser(u: UserRow): PublicUser {
  return { id: u.id, nickname: u.nickname, avatarColor: u.avatarColor, avatarUrl: avatarUrl(u) };
}

export function toMe(
  u: UserRow & { email: string; friendCode: string; createdAt: Date; nicknameChangedAt: Date | null },
): MeDto {
  const next = u.nicknameChangedAt ? u.nicknameChangedAt.getTime() + NICKNAME_COOLDOWN_MS : 0;
  return {
    ...toPublicUser(u),
    email: u.email,
    friendCode: u.friendCode,
    createdAt: u.createdAt.toISOString(),
    nicknameChangeAvailableAt: next > Date.now() ? new Date(next).toISOString() : null,
  };
}

/** Поля, яких достатньо для PublicUser (щоб не тягнути з бази зайве) */
export const publicUserSelect = { id: true, nickname: true, avatarColor: true, avatarImage: true } as const;
