import { create } from 'zustand';
import type { AuthResponse, MeDto } from '@jvof/shared';
import { api, refreshSession, setAuthListener, setSession } from '../lib/api';

interface AuthState {
  user: MeDto | null;
  status: 'loading' | 'in' | 'out';
  init: () => Promise<void>;
  login: (email: string, password: string) => Promise<void>;
  register: (email: string, nickname: string, password: string) => Promise<void>;
  logout: () => Promise<void>;
  setUser: (u: MeDto) => void;
}

export const useAuth = create<AuthState>((set) => {
  setAuthListener((r) => set(r ? { user: r.user, status: 'in' } : { user: null, status: 'out' }));
  return {
    user: null,
    status: 'loading',
    init: async () => {
      await refreshSession();
    },
    login: async (email, password) => setSession(await api<AuthResponse>('/auth/login', { body: { email, password } })),
    register: async (email, nickname, password) => setSession(await api<AuthResponse>('/auth/register', { body: { email, nickname, password } })),
    logout: async () => {
      await api('/auth/logout', { body: {} }).catch(() => {});
      setSession(null);
    },
    setUser: (user) => set({ user }),
  };
});
