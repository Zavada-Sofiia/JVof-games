import { z } from 'zod';

const email = z.string().trim().toLowerCase().email('Некоректний email').max(254);
const password = z
  .string()
  .min(8, 'Пароль має містити щонайменше 8 символів')
  .max(128, 'Пароль задовгий');
export const nicknameSchema = z
  .string()
  .trim()
  .min(2, 'Нікнейм має містити щонайменше 2 символи')
  .max(24, 'Нікнейм має бути не довшим за 24 символи')
  .regex(/^[\p{L}\p{N} _.'’ʼ\-]+$/u, "Нікнейм може містити лише літери, цифри, пробіл, апостроф і символи _ . -");

export const registerSchema = z.object({ email, nickname: nicknameSchema, password });
export type RegisterInput = z.infer<typeof registerSchema>;

export const loginSchema = z.object({ email, password: z.string().min(1).max(128) });
export type LoginInput = z.infer<typeof loginSchema>;

export const forgotPasswordSchema = z.object({ email });
export const resetPasswordSchema = z.object({ token: z.string().min(10).max(200), password });
export const verifyEmailSchema = z.object({ token: z.string().min(10).max(200) });

export const AVATAR_COLORS = [
  '#7c5cff',
  '#e5484d',
  '#f76b15',
  '#ffc53d',
  '#46a758',
  '#12a594',
  '#0090ff',
  '#d6409f',
  '#8e8c99',
] as const;

/** Аватар: невелике зображення data:image/(png|jpeg|webp) до ~60 КБ. */
const avatarImage = z
  .string()
  .max(80_000, 'Зображення завелике')
  .regex(/^data:image\/(png|jpeg|webp);base64,[A-Za-z0-9+/=]+$/, 'Непідтримуваний формат зображення');

export const updateMeSchema = z.object({
  nickname: nicknameSchema.optional(),
  avatarColor: z.enum(AVATAR_COLORS).optional(),
  avatarImage: avatarImage.nullable().optional(),
});
export type UpdateMeInput = z.infer<typeof updateMeSchema>;

export const changePasswordSchema = z.object({
  currentPassword: z.string().min(1).max(128),
  newPassword: password,
});

export const deleteAccountSchema = z.object({ password: z.string().min(1).max(128) });

export const friendRequestSchema = z.object({ code: z.string().trim().min(4).max(20) });
export const blockSchema = z.object({ userId: z.string().uuid() });

export const roomVisibilitySchema = z.enum(['private', 'friends', 'public']);
export type RoomVisibility = z.infer<typeof roomVisibilitySchema>;

export const createRoomSchema = z.object({
  gameType: z.string().min(1).max(32),
  visibility: roomVisibilitySchema.default('private'),
  maxPlayers: z.number().int().min(2).max(16),
  settings: z.record(z.string(), z.unknown()).default({}),
});
export type CreateRoomInput = z.infer<typeof createRoomSchema>;

export const updateRoomSchema = z.object({
  visibility: roomVisibilitySchema.optional(),
  maxPlayers: z.number().int().min(2).max(16).optional(),
  settings: z.record(z.string(), z.unknown()).optional(),
});

export const inviteSchema = z.object({ friendId: z.string().uuid() });

export const chatSchema = z.object({
  channel: z.string().min(1).max(20),
  text: z.string().trim().min(1).max(500),
});
