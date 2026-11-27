import { GameError, normalizeBySchema, type SettingsField } from '@jvof/game-core';
import type { MafiaSettings, Role } from './types';

export const MIN_PLAYERS = 4;
export const MAX_PLAYERS = 16;

export const mafiaSettingsSchema: SettingsField[] = [
  {
    key: 'hostMode',
    label: 'Ведучий',
    type: 'select',
    default: 'auto',
    options: [
      { value: 'auto', label: 'Авто-ведучий (сервер веде за таймерами)' },
      { value: 'human', label: 'Ведучий-людина (адмін веде й не грає)' },
    ],
  },
  { key: 'speechSeconds', label: 'Час на промову', type: 'number', default: 60, min: 15, max: 180, step: 5, unit: 'с' },
  { key: 'lastSpeech', label: 'Остання промова страченого', type: 'boolean', default: true },
  { key: 'lastSpeechSeconds', label: 'Тривалість останньої промови', type: 'number', default: 30, min: 10, max: 120, step: 5, unit: 'с' },
  { key: 'nightSeconds', label: 'Тривалість ночі', type: 'number', default: 45, min: 15, max: 180, step: 5, unit: 'с' },
  { key: 'votingSeconds', label: 'Час на голосування', type: 'number', default: 30, min: 10, max: 120, step: 5, unit: 'с' },
  {
    key: 'firstNightKill',
    label: 'Вбивство в першу ніч',
    type: 'boolean',
    default: false,
    hint: 'За замовчуванням перша ніч знайомча: мафія нікого не вбиває',
  },
  {
    key: 'doctorSelfHeal',
    label: 'Лікар може лікувати себе',
    type: 'boolean',
    default: true,
    hint: 'Але не дві ночі поспіль',
  },
  {
    key: 'rolesMode',
    label: 'Склад ролей',
    type: 'select',
    default: 'auto',
    options: [
      { value: 'auto', label: 'Автоматично за кількістю гравців' },
      { value: 'manual', label: 'Вручну' },
    ],
  },
  { key: 'mafiaCount', label: 'Мафія (разом із доном)', type: 'number', default: 2, min: 1, max: 5, hint: 'Лише для ручного складу' },
  { key: 'don', label: 'Дон', type: 'boolean', default: true, hint: 'Лише для ручного складу' },
  { key: 'sheriff', label: 'Шериф', type: 'boolean', default: true, hint: 'Лише для ручного складу' },
  { key: 'doctor', label: 'Лікар', type: 'boolean', default: true, hint: 'Лише для ручного складу' },
  {
    key: 'prostitute',
    label: 'Повія',
    type: 'boolean',
    default: false,
    hint: 'Додаткова роль мирних (від 6 гравців): вночі блокує дію гравця, вдень у нього алібі на голосуванні',
  },
  { key: 'deadVideo', label: 'Камери вибулих видно', type: 'boolean', default: true },
  { key: 'allowSpectators', label: 'Друзі можуть дивитися як глядачі', type: 'boolean', default: true },
];

export function normalizeMafiaSettings(raw: Record<string, unknown>): MafiaSettings {
  return normalizeBySchema(mafiaSettingsSchema, raw) as unknown as MafiaSettings;
}

export function defaultRoleCounts(n: number): Record<Role, number> {
  const mafiaTotal = n <= 5 ? 1 : Math.floor(n / 3);
  const don = mafiaTotal >= 2 ? 1 : 0;
  const sheriff = n >= 4 ? 1 : 0;
  const doctor = n >= 5 ? 1 : 0;
  return {
    don,
    mafia: mafiaTotal - don,
    sheriff,
    doctor,
    prostitute: 0,
    civilian: n - mafiaTotal - sheriff - doctor,
  };
}

/** Склад ролей для n гравців з урахуванням налаштувань. Кидає GameError, якщо склад неможливий. */
export function computeRoleCounts(n: number, s: MafiaSettings): Record<Role, number> {
  if (n < MIN_PLAYERS) throw new GameError(`Для Мафії потрібно щонайменше ${MIN_PLAYERS} гравці`);
  if (n > MAX_PLAYERS) throw new GameError(`Для Мафії можна не більше ${MAX_PLAYERS} гравців`);
  if (s.rolesMode === 'auto') {
    const counts = defaultRoleCounts(n);
    if (s.prostitute && n >= 6 && counts.civilian > 0) {
      counts.prostitute = 1;
      counts.civilian--;
    }
    return counts;
  }
  const mafiaTotal = s.mafiaCount;
  const don = s.don ? 1 : 0;
  const counts: Record<Role, number> = {
    don,
    mafia: mafiaTotal - don,
    sheriff: s.sheriff ? 1 : 0,
    doctor: s.doctor ? 1 : 0,
    prostitute: s.prostitute ? 1 : 0,
    civilian: 0,
  };
  counts.civilian = n - mafiaTotal - counts.sheriff - counts.doctor - counts.prostitute;
  if (counts.mafia < 0) throw new GameError('Мафії має бути щонайменше стільки ж, скільки донів');
  if (counts.civilian < 0) throw new GameError('Ролей більше, ніж гравців');
  if (mafiaTotal * 2 >= n) throw new GameError('Забагато мафії: мирних має бути більше');
  return counts;
}
