import type { GameModule } from '@jvof/game-core';
import { mafiaModule } from '@jvof/game-mafia';
import { spyfallModule } from '@jvof/game-spyfall';
import { mafiaClient } from './mafia/client';
import { spyfallClient } from './spyfall/client';
import type { ClientGame } from './types';

/** Ігри, доступні при створенні кімнати */
export const gameModules: GameModule[] = [mafiaModule, spyfallModule];

/** Екрани ігор за clientEntry */
export const gameClients: Record<string, ClientGame> = {
  mafia: mafiaClient,
  spyfall: spyfallClient,
};
