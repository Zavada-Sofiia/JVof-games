import { create } from 'zustand';
import type { FriendDto, FriendRequestDto } from '@jvof/shared';
import { api } from '../lib/api';

interface FriendsState {
  friends: FriendDto[];
  requests: FriendRequestDto[];
  loaded: boolean;
  load: () => Promise<void>;
  setPresence: (userId: string, status: FriendDto['status'], roomCode: string | null) => void;
}

export const useFriends = create<FriendsState>((set, get) => ({
  friends: [],
  requests: [],
  loaded: false,
  load: async () => {
    const [friends, requests] = await Promise.all([api<FriendDto[]>('/friends'), api<FriendRequestDto[]>('/friends/requests')]);
    set({ friends, requests, loaded: true });
  },
  setPresence: (userId, status, roomCode) =>
    set({ friends: get().friends.map((f) => (f.id === userId ? { ...f, status, roomCode } : f)) }),
}));
