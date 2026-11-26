import type { GameModule } from '@jvof/game-core';
import { mafiaModule } from '@jvof/game-mafia';
import { mafiaClient } from './mafia/client';
import type { ClientGame } from './types';

/** Ігри, доступні при створенні кімнати */
export const gameModules: GameModule[] = [mafiaModule];

/** Екрани ігор за clientEntry */
export const gameClients: Record<string, ClientGame> = {
  mafia: mafiaClient,
};
