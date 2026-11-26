import type { GameModule } from '@jvof/game-core';
import { mafiaModule } from '@jvof/game-mafia';

// Реєстр ігор: нова гра додається одним рядком (розділ 13 архітектури)
const modules = new Map<string, GameModule>([[mafiaModule.id, mafiaModule]]);

export const getGameModule = (id: string) => modules.get(id);
export const listGameModules = () => [...modules.values()];
export const gameTitle = (id: string) => modules.get(id)?.title ?? id;
