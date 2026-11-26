import { useEffect, useState } from 'react';

/** Секунди, що лишились до endsAt (за серверним часом). Оновлюється 4 рази на секунду. */
export function useCountdown(endsAt: number | null, pausedRemaining: number | null, paused: boolean, serverNow: () => number): number | null {
  const [, tick] = useState(0);
  useEffect(() => {
    if (paused || endsAt === null) return;
    const t = setInterval(() => tick((x) => x + 1), 250);
    return () => clearInterval(t);
  }, [endsAt, paused]);
  if (paused) return pausedRemaining === null ? null : Math.ceil(pausedRemaining / 1000);
  if (endsAt === null) return null;
  return Math.max(0, Math.ceil((endsAt - serverNow()) / 1000));
}
