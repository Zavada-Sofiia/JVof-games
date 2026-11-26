import type { GameModule } from '@jvof/game-core';
import { mafiaEngine } from './engine';
import { MAX_PLAYERS, MIN_PLAYERS, mafiaSettingsSchema, normalizeMafiaSettings } from './settings';

export const mafiaModule: GameModule = {
  id: 'mafia',
  title: 'Мафія',
  description: 'Мирні шукають мафію, мафія вночі обирає жертву. Гра сама керує тим, хто коли говорить.',
  minPlayers: MIN_PLAYERS,
  maxPlayers: MAX_PLAYERS,
  defaultMaxPlayers: 8,
  settingsSchema: mafiaSettingsSchema,
  normalizeSettings: (raw) => normalizeMafiaSettings(raw) as unknown as Record<string, unknown>,
  hasHumanHost: (settings) => settings.hostMode === 'human',
  engine: mafiaEngine,
  clientEntry: 'mafia',
};
