import type { GameEventRecord, PhaseTimer } from '@jvof/game-core';

export type Role = 'civilian' | 'sheriff' | 'doctor' | 'prostitute' | 'mafia' | 'don';
export type Team = 'civilians' | 'mafia';

export const ROLE_INFO: Record<Role, { title: string; team: Team; description: string }> = {
  civilian: { title: 'Мирний', team: 'civilians', description: 'Вдень обговорюєте й голосуєте. Ваша мета — знайти мафію.' },
  sheriff: { title: 'Шериф', team: 'civilians', description: 'Щоночі перевіряєте одного гравця: мафія він чи ні.' },
  doctor: {
    title: 'Лікар',
    team: 'civilians',
    description: 'Щоночі рятуєте одного гравця. Себе лікувати можна, але не дві ночі поспіль.',
  },
  prostitute: {
    title: 'Повія',
    team: 'civilians',
    description: 'Щоночі йдете до когось у гості: його нічна дія не спрацює, а наступного дня в нього алібі — за нього не голосують.',
  },
  mafia: { title: 'Мафія', team: 'mafia', description: 'Щоночі разом із командою обираєте жертву.' },
  don: {
    title: 'Дон',
    team: 'mafia',
    description: 'Голова мафії: остаточно вирішує, кого вбити, і щоночі може шукати шерифа.',
  },
};

export const TEAM_TITLE: Record<Team, string> = { civilians: 'Мирні', mafia: 'Мафія' };

export const ROLE_ORDER: Role[] = ['civilian', 'sheriff', 'doctor', 'prostitute', 'mafia', 'don'];

export type Phase = 'ROLE_ASSIGN' | 'NIGHT' | 'DAY_ANNOUNCE' | 'DAY_DISCUSSION' | 'VOTING' | 'EXECUTION' | 'GAME_OVER';

export const PHASE_TITLE: Record<Phase, string> = {
  ROLE_ASSIGN: 'Роздача ролей',
  NIGHT: 'Ніч',
  DAY_ANNOUNCE: 'Ранок',
  DAY_DISCUSSION: 'Обговорення',
  VOTING: 'Голосування',
  EXECUTION: 'Вирок',
  GAME_OVER: 'Кінець гри',
};

export interface MafiaSettings {
  hostMode: 'auto' | 'human';
  speechSeconds: number;
  lastSpeech: boolean;
  lastSpeechSeconds: number;
  firstNightKill: boolean;
  doctorSelfHeal: boolean;
  nightSeconds: number;
  votingSeconds: number;
  rolesMode: 'auto' | 'manual';
  mafiaCount: number;
  don: boolean;
  sheriff: boolean;
  doctor: boolean;
  prostitute: boolean;
  deadVideo: boolean;
  allowSpectators: boolean;
}

export interface MafiaPlayer {
  id: string;
  nickname: string;
  seat: number;
  role: Role;
  alive: boolean;
  /** Ключ фази, коли гравець вибув (напр. "night-2", "day-1", "left") */
  diedAt: string | null;
}

export interface NightState {
  /** мафіозі -> обрана жертва */
  mafiaVotes: Record<string, string>;
  sheriffCheck: string | null;
  donCheck: string | null;
  doctorHeal: string | null;
  /** До кого пішла Повія (його нічна дія блокується, вдень у нього алібі) */
  visit: string | null;
}

export type ChronicleEntry =
  | { kind: 'night'; round: number; killedId: string | null; alibiId?: string | null }
  | { kind: 'vote'; round: number; voteRound: 1 | 2; votes: Record<string, string>; leaders: string[] }
  | { kind: 'execution'; round: number; targetId: string | null; outcome: 'executed' | 'tie' | 'nobody' }
  | { kind: 'left'; round: number; playerId: string };

export interface CheckRecord {
  by: 'sheriff' | 'don';
  actorId: string;
  round: number;
  targetId: string;
  /** sheriff: чи мафія; don: чи шериф; null — перевірку заблокувала Повія */
  result: boolean | null;
}

export interface MafiaState {
  settings: MafiaSettings;
  hostId: string | null;
  hostMode: 'auto' | 'human';
  players: MafiaPlayer[];
  roleCounts: Record<Role, number>;
  phase: Phase;
  round: number;
  timer: PhaseTimer;
  night: NightState;
  lastSelfHealRound: number | null;
  /** До кого Повія ходила минулої ночі (двічі поспіль не можна) */
  lastVisitTarget: string | null;
  /** Алібі на денне голосування */
  alibi: { round: number; playerId: string } | null;
  lastNight: { round: number; killedId: string | null } | null;
  discussion: { order: string[]; index: number; timeUp: boolean };
  voting: { round: 1 | 2; candidates: string[]; votes: Record<string, string> };
  execution: { targetId: string | null; outcome: 'executed' | 'tie' | 'nobody'; speech: boolean } | null;
  checks: CheckRecord[];
  chronicle: ChronicleEntry[];
  winner: Team | null;
  aborted: boolean;
  /** Лічильник «моментів» гри для звукових сигналів */
  step: number;
  events: GameEventRecord[];
}

// ---------- Дії гравців ----------

export type MafiaAction =
  | { type: 'night'; kind: 'kill' | 'check' | 'heal' | 'visit'; target: string }
  | { type: 'vote'; target: string }
  | { type: 'end_speech' };

// ---------- Що бачать клієнти ----------

export interface MafiaPublicPlayer {
  id: string;
  nickname: string;
  seat: number;
  alive: boolean;
  /** Відкривається лише в кінці гри */
  role: Role | null;
}

export interface MafiaPublicState {
  phase: Phase;
  phaseKey: string;
  round: number;
  hostMode: 'auto' | 'human';
  hostId: string | null;
  paused: boolean;
  endsAt: number | null;
  remainingMs: number | null;
  players: MafiaPublicPlayer[];
  roleCounts: Record<Role, number>;
  speakerId: string | null;
  speakerTimeUp: boolean;
  order: string[];
  orderIndex: number;
  voting: { round: 1 | 2; candidates: string[]; votedIds: string[] } | null;
  lastNight: { round: number; killedId: string | null } | null;
  /** У кого сьогодні алібі (за нього не голосують) */
  alibiId: string | null;
  execution: { targetId: string | null; outcome: 'executed' | 'tie' | 'nobody'; speech: boolean } | null;
  winner: Team | null;
  aborted: boolean;
  chronicle: ChronicleEntry[];
  settings: MafiaSettings;
}

export interface MafiaPlayerView {
  kind: 'player' | 'host';
  me: { id: string; role: Role; team: Team; alive: boolean } | null;
  /** Для мафії: хто ще в команді */
  teammates: { id: string; role: Role }[];
  /** Мої результати перевірок (шериф/дон) */
  checks: CheckRecord[];
  night: {
    canKill: boolean;
    check: 'sheriff' | 'don' | null;
    canHeal: boolean;
    cannotHealSelf: boolean;
    myKill: string | null;
    myCheck: string | null;
    myHeal: string | null;
    canVisit: boolean;
    myVisit: string | null;
    /** До кого не можна йти цієї ночі (був минулої) */
    cannotVisitId: string | null;
    /** Голоси команди мафії (бачать лише мафія та ведучий) */
    teamVotes: Record<string, string>;
  } | null;
  myVote: string | null;
  /** Ролі всіх (ведучому — завжди, решті — в кінці гри) */
  roles: Record<string, Role> | null;
  /** Нічні дії (тільки ведучому) */
  hostNight: NightState | null;
}
