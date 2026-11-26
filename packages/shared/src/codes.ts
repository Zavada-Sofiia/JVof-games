// Алфавіт без схожих символів (0/O, 1/I/L), щоб код легко було продиктувати голосом.
export const CODE_ALPHABET = 'ABCDEFGHJKMNPQRSTUVWXYZ23456789';

export const FRIEND_CODE_LENGTH = 8;
export const ROOM_CODE_LENGTH = 4;

/** "K7M29QXP" -> "K7M2-9QXP" */
export function formatFriendCode(code: string): string {
  const c = normalizeCode(code);
  return c.length === FRIEND_CODE_LENGTH ? `${c.slice(0, 4)}-${c.slice(4)}` : c;
}

/** Прибирає пробіли й дефіси та переводить у верхній регістр. */
export function normalizeCode(input: string): string {
  return input.toUpperCase().replace(/[\s-]/g, '');
}

export function isValidCode(code: string, length: number): boolean {
  if (code.length !== length) return false;
  for (const ch of code) if (!CODE_ALPHABET.includes(ch)) return false;
  return true;
}
