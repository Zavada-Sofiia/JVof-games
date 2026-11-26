import { create } from 'zustand';

const PREFS_KEY = 'jvof-media';

interface Prefs {
  micOn: boolean;
  camOn: boolean;
  audioId: string | null;
  videoId: string | null;
}

function loadPrefs(): Prefs {
  try {
    return { micOn: true, camOn: true, audioId: null, videoId: null, ...JSON.parse(localStorage.getItem(PREFS_KEY) ?? '{}') };
  } catch {
    return { micOn: true, camOn: true, audioId: null, videoId: null };
  }
}

interface MediaState extends Prefs {
  audioTrack: MediaStreamTrack | null;
  videoTrack: MediaStreamTrack | null;
  devices: MediaDeviceInfo[];
  error: string | null;
  start: () => Promise<void>;
  stop: () => void;
  setMic: (on: boolean) => Promise<void>;
  setCam: (on: boolean) => Promise<void>;
  setAudioDevice: (id: string) => Promise<void>;
  setVideoDevice: (id: string) => Promise<void>;
  refreshDevices: () => Promise<void>;
}

function describe(e: unknown): string {
  const name = (e as { name?: string })?.name;
  if (name === 'NotAllowedError') return 'Браузер не дав доступу до камери чи мікрофона. Дозвольте доступ у налаштуваннях сайту.';
  if (name === 'NotFoundError') return 'Камеру чи мікрофон не знайдено';
  if (name === 'NotReadableError') return 'Пристрій зайнятий іншою програмою';
  if (!window.isSecureContext) return 'Камера й мікрофон працюють лише через HTTPS або localhost';
  return 'Не вдалося отримати доступ до пристрою';
}

async function getAudio(deviceId: string | null) {
  const s = await navigator.mediaDevices.getUserMedia({
    audio: { deviceId: deviceId ? { exact: deviceId } : undefined, echoCancellation: true, noiseSuppression: true, autoGainControl: true },
  });
  return s.getAudioTracks()[0];
}

async function getVideo(deviceId: string | null) {
  const s = await navigator.mediaDevices.getUserMedia({
    // Обмежуємо якість: у mesh кожен відправляє 7 потоків (розділ 5)
    video: { deviceId: deviceId ? { exact: deviceId } : undefined, width: { ideal: 640 }, height: { ideal: 360 }, frameRate: { ideal: 20, max: 24 } },
  });
  return s.getVideoTracks()[0];
}

export const useMedia = create<MediaState>((set, get) => {
  const save = () => {
    const { micOn, camOn, audioId, videoId } = get();
    localStorage.setItem(PREFS_KEY, JSON.stringify({ micOn, camOn, audioId, videoId }));
  };

  return {
    ...loadPrefs(),
    audioTrack: null,
    videoTrack: null,
    devices: [],
    error: null,

    refreshDevices: async () => {
      try {
        set({ devices: await navigator.mediaDevices.enumerateDevices() });
      } catch {
        /* ignore */
      }
    },

    start: async () => {
      const { micOn, camOn, audioId, videoId } = get();
      set({ error: null });
      // Мікрофон беремо завжди (вимкнений — це track.enabled = false), щоб вмикався миттєво
      if (!get().audioTrack) {
        try {
          const t = await getAudio(audioId).catch(() => getAudio(null));
          t.enabled = micOn;
          set({ audioTrack: t });
        } catch (e) {
          set({ error: describe(e), micOn: false });
        }
      }
      if (camOn && !get().videoTrack) {
        try {
          set({ videoTrack: await getVideo(videoId).catch(() => getVideo(null)) });
        } catch (e) {
          set({ error: describe(e), camOn: false });
        }
      }
      await get().refreshDevices();
    },

    stop: () => {
      get().audioTrack?.stop();
      get().videoTrack?.stop();
      set({ audioTrack: null, videoTrack: null });
    },

    setMic: async (on) => {
      let t = get().audioTrack;
      if (on && !t) {
        try {
          t = await getAudio(get().audioId);
          set({ audioTrack: t, error: null });
        } catch (e) {
          set({ error: describe(e) });
          return;
        }
      }
      if (t) t.enabled = on;
      set({ micOn: on });
      save();
    },

    setCam: async (on) => {
      if (on) {
        try {
          const t = get().videoTrack ?? (await getVideo(get().videoId));
          set({ videoTrack: t, camOn: true, error: null });
        } catch (e) {
          set({ error: describe(e), camOn: false });
        }
      } else {
        // Вимикаємо камеру повністю, щоб погас індикатор
        get().videoTrack?.stop();
        set({ videoTrack: null, camOn: false });
      }
      save();
    },

    setAudioDevice: async (id) => {
      set({ audioId: id });
      save();
      try {
        const t = await getAudio(id);
        t.enabled = get().micOn;
        get().audioTrack?.stop();
        set({ audioTrack: t, error: null });
      } catch (e) {
        set({ error: describe(e) });
      }
    },

    setVideoDevice: async (id) => {
      set({ videoId: id });
      save();
      if (!get().camOn) return;
      try {
        const t = await getVideo(id);
        get().videoTrack?.stop();
        set({ videoTrack: t, error: null });
      } catch (e) {
        set({ error: describe(e) });
      }
    },
  };
});

// Підключили/відключили навушники чи камеру — оновлюємо список
if (typeof navigator !== 'undefined' && navigator.mediaDevices) {
  navigator.mediaDevices.addEventListener?.('devicechange', () => void useMedia.getState().refreshDevices());
}
