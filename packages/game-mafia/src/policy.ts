import type { AudioPolicy } from '@jvof/shared';
import { ROLE_INFO, type MafiaState } from './types';

/**
 * Політика звуку й відео по фазах (розділ 5 архітектури):
 * - ніч: камери вимкнені, мафія чує лише одна одну, решта не чує нічого;
 * - обговорення: говорить тільки той, чия черга (поки не вийшов його час);
 * - голосування: усі мікрофони вимкнені;
 * - остання промова: тільки страчений;
 * - вибулі: мікрофон заблоковано до кінця гри;
 * - ведучий-людина: говорить завжди, вночі чує мафію.
 */
export function getMafiaAudioPolicy(s: MafiaState): AudioPolicy {
  const host = s.hostId;
  const ids = s.players.map((p) => p.id);
  const participants = host ? [...ids, host] : ids;
  const aliveMafia = s.players.filter((p) => p.alive && ROLE_INFO[p.role].team === 'mafia').map((p) => p.id);
  const over = s.phase === 'GAME_OVER';
  const night = s.phase === 'NIGHT';

  let speakers: string[] = [];
  let note = '';
  switch (s.phase) {
    case 'ROLE_ASSIGN':
      note = 'Роздача ролей: мікрофони вимкнені';
      break;
    case 'NIGHT':
      speakers = aliveMafia;
      note = 'Ніч: місто спить, мафія говорить лише між собою';
      break;
    case 'DAY_ANNOUNCE':
      note = 'Ранок: оголошення результатів ночі';
      break;
    case 'DAY_DISCUSSION': {
      const speaker = s.discussion.order[s.discussion.index];
      if (speaker && !s.discussion.timeUp) speakers = [speaker];
      note = s.discussion.timeUp ? 'Час промови вийшов' : 'Обговорення: говорить той, чия черга';
      break;
    }
    case 'VOTING':
      note = 'Голосування: мікрофони вимкнені';
      break;
    case 'EXECUTION':
      if (s.execution?.speech && s.execution.targetId) speakers = [s.execution.targetId];
      note = s.execution?.speech ? 'Остання промова' : 'Вирок';
      break;
    case 'GAME_OVER':
      speakers = participants;
      note = 'Гру завершено: усі можуть говорити';
      break;
  }
  if (host && !speakers.includes(host)) speakers.push(host);

  const hear: Record<string, string[]> = {};
  const see: Record<string, string[]> = {};
  const visible = over
    ? participants
    : participants.filter((id) => id === host || s.settings.deadVideo || s.players.find((p) => p.id === id)?.alive);

  for (const p of participants) {
    if (night) {
      if (aliveMafia.includes(p)) hear[p] = [...aliveMafia, ...(host ? [host] : [])].filter((x) => x !== p);
      else if (p === host) hear[p] = aliveMafia;
      else hear[p] = host ? [host] : [];
      see[p] = [];
    } else {
      hear[p] = speakers.filter((x) => x !== p);
      see[p] = visible.filter((x) => x !== p);
    }
  }

  return {
    speakers,
    hear,
    see,
    observers: {
      hear: night ? (host ? [host] : []) : speakers,
      see: night ? [] : visible,
    },
    note,
  };
}
