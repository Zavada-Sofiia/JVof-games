import { useEffect } from 'react';
import { useNavigate } from 'react-router';
import type { PresenceStatus } from '@jvof/shared';
import { useAuth } from '../store/auth';
import { useFriends } from '../store/friends';
import { toast } from '../store/ui';
import { connectSocket, disconnectSocket, getSocket } from './socket';
import { sounds } from './sounds';

/** Глобальні події реального часу: друзі, запрошення, сповіщення */
export function useRealtime() {
  const status = useAuth((s) => s.status);
  const navigate = useNavigate();

  useEffect(() => {
    if (status !== 'in') {
      disconnectSocket();
      return;
    }
    const s = getSocket();
    const reloadFriends = () => useFriends.getState().load().catch(() => {});
    const onRequest = (r: { user: { nickname: string } }) => {
      sounds.notify();
      toast(`${r.user.nickname} хоче додати вас у друзі`, 'info', { action: { label: 'Переглянути', onClick: () => navigate('/') } });
      reloadFriends();
    };
    const onInvite = (p: { from: { nickname: string }; code: string; gameTitle: string }) => {
      sounds.notify();
      toast(`${p.from.nickname} кличе вас у гру «${p.gameTitle}»`, 'info', {
        action: { label: 'Приєднатися', onClick: () => navigate(`/room/${p.code}`) },
        ttl: 30000,
      });
    };
    const onPresence = (p: { userId: string; status: PresenceStatus; roomCode: string | null }) =>
      useFriends.getState().setPresence(p.userId, p.status, p.roomCode);
    const onNotice = (p: { text: string; kind?: 'info' | 'error' }) => toast(p.text, p.kind ?? 'info');

    s.on('friend:request', onRequest);
    s.on('friend:changed', reloadFriends);
    s.on('friend:presence', onPresence);
    s.on('room:invite', onInvite);
    s.on('notice', onNotice);
    s.on('connect', reloadFriends);
    connectSocket();
    return () => {
      s.off('friend:request', onRequest);
      s.off('friend:changed', reloadFriends);
      s.off('friend:presence', onPresence);
      s.off('room:invite', onInvite);
      s.off('notice', onNotice);
      s.off('connect', reloadFriends);
    };
  }, [status, navigate]);
}
