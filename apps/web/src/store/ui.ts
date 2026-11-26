import { create } from 'zustand';

export interface Toast {
  id: number;
  text: string;
  kind: 'info' | 'error' | 'success';
  action?: { label: string; onClick: () => void };
  ttl: number;
}

type Theme = 'dark' | 'light';
const stored = <T extends string>(key: string, fallback: T): T => {
  try {
    return (localStorage.getItem(key) as T) || fallback;
  } catch {
    return fallback;
  }
};

interface UiState {
  theme: Theme;
  sounds: boolean;
  toasts: Toast[];
  toggleTheme: () => void;
  toggleSounds: () => void;
  toast: (text: string, kind?: Toast['kind'], opts?: { action?: Toast['action']; ttl?: number }) => void;
  dismiss: (id: number) => void;
}

let nextId = 1;

export const useUi = create<UiState>((set, get) => ({
  theme: stored<Theme>('jvof-theme', 'dark'),
  sounds: stored('jvof-sounds', 'on') === 'on',
  toasts: [],
  toggleTheme: () => {
    const theme: Theme = get().theme === 'dark' ? 'light' : 'dark';
    document.documentElement.dataset.theme = theme;
    localStorage.setItem('jvof-theme', theme);
    set({ theme });
  },
  toggleSounds: () => {
    const sounds = !get().sounds;
    localStorage.setItem('jvof-sounds', sounds ? 'on' : 'off');
    set({ sounds });
  },
  toast: (text, kind = 'info', opts = {}) => {
    const t: Toast = { id: nextId++, text, kind, action: opts.action, ttl: opts.ttl ?? (opts.action ? 15000 : 4500) };
    set({ toasts: [...get().toasts.slice(-4), t] });
    setTimeout(() => get().dismiss(t.id), t.ttl);
  },
  dismiss: (id) => set({ toasts: get().toasts.filter((t) => t.id !== id) }),
}));

export const toast = (...args: Parameters<UiState['toast']>) => useUi.getState().toast(...args);
export const toastError = (e: unknown) => toast(e instanceof Error ? e.message : 'Щось пішло не так', 'error');
