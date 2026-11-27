import { useEffect, useRef, useState } from 'react';
import { useMedia } from '../store/media';

let audioCtx: AudioContext | null = null;
const ctx = () => (audioCtx ??= new AudioContext());

/** Рівень гучності треку 0..1 (для індикатора «говорить» і перевірки мікрофона) */
export function useAudioLevel(track: MediaStreamTrack | null | undefined, enabled = true): number {
  const [level, setLevel] = useState(0);
  useEffect(() => {
    if (!track || !enabled || track.readyState === 'ended') {
      setLevel(0);
      return;
    }
    let raf = 0;
    let src: MediaStreamAudioSourceNode | null = null;
    try {
      const c = ctx();
      if (c.state === 'suspended') void c.resume();
      src = c.createMediaStreamSource(new MediaStream([track]));
      const an = c.createAnalyser();
      an.fftSize = 512;
      src.connect(an);
      const buf = new Uint8Array(an.fftSize);
      let last = 0;
      const loop = (t: number) => {
        raf = requestAnimationFrame(loop);
        if (t - last < 120) return;
        last = t;
        an.getByteTimeDomainData(buf);
        let sum = 0;
        for (const v of buf) sum += ((v - 128) / 128) ** 2;
        setLevel(Math.min(1, Math.sqrt(sum / buf.length) * 4));
      };
      raf = requestAnimationFrame(loop);
    } catch {
      /* WebAudio недоступний */
    }
    return () => {
      cancelAnimationFrame(raf);
      src?.disconnect();
    };
  }, [track, enabled]);
  return level;
}

export function VideoEl({ stream, track, mirror }: { stream?: MediaStream | null; track?: MediaStreamTrack | null; mirror?: boolean }) {
  const ref = useRef<HTMLVideoElement>(null);
  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    const src = track ? new MediaStream([track]) : (stream ?? null);
    if (el.srcObject !== src) el.srcObject = src;
    el.play().catch(() => {});
  }, [stream, track]);
  return <video ref={ref} autoPlay playsInline muted className={mirror ? 'mirror' : undefined} />;
}

/** Звук співрозмовника. muted = отримувач додатково глушить тих, кого зараз не можна чути. */
export function RemoteAudio({ stream, muted, onBlocked }: { stream: MediaStream; muted: boolean; onBlocked?: () => void }) {
  const ref = useRef<HTMLAudioElement>(null);
  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    if (el.srcObject !== stream) el.srcObject = stream;
    // Safari/iPad блокує звук без дотику користувача — тоді просимо натиснути кнопку
    el.play().catch((e: { name?: string }) => {
      if (e?.name === 'NotAllowedError') onBlocked?.();
    });
  }, [stream, onBlocked]);
  useEffect(() => {
    if (ref.current) ref.current.muted = muted;
  }, [muted]);
  return <audio ref={ref} autoPlay playsInline data-remote-audio />;
}

export function DevicePickers() {
  const { devices, audioId, videoId, setAudioDevice, setVideoDevice } = useMedia();
  const mics = devices.filter((d) => d.kind === 'audioinput');
  const cams = devices.filter((d) => d.kind === 'videoinput');
  return (
    <div className="col">
      <label className="field">
        Мікрофон
        <select className="input" value={audioId ?? ''} onChange={(e) => setAudioDevice(e.target.value)}>
          {!audioId && <option value="">За замовчуванням</option>}
          {mics.map((d, i) => (
            <option key={d.deviceId || i} value={d.deviceId}>
              {d.label || `Мікрофон ${i + 1}`}
            </option>
          ))}
        </select>
      </label>
      <label className="field">
        Камера
        <select className="input" value={videoId ?? ''} onChange={(e) => setVideoDevice(e.target.value)}>
          {!videoId && <option value="">За замовчуванням</option>}
          {cams.map((d, i) => (
            <option key={d.deviceId || i} value={d.deviceId}>
              {d.label || `Камера ${i + 1}`}
            </option>
          ))}
        </select>
      </label>
    </div>
  );
}

/** Екран перед входом у кімнату: бачиш себе, вибираєш пристрої, чуєш рівень звуку */
export function DeviceCheck({ onJoin, title }: { onJoin: () => void; title: string }) {
  const { micOn, camOn, videoTrack, audioTrack, error, start, setMic, setCam } = useMedia();
  const level = useAudioLevel(audioTrack, micOn);
  useEffect(() => {
    void start();
  }, [start]);
  return (
    <div className="page medium">
      <div className="card col">
        <h1>{title}</h1>
        <p className="muted">Перевірте камеру й мікрофон перед входом. Камера необов'язкова: без неї друзі бачитимуть ваш аватар.</p>
        <div className="preview">{camOn && videoTrack ? (
            <VideoEl track={videoTrack} />
          ) : (
            <span className="faint">{camOn && !error ? 'Чекаємо доступу до камери…' : 'Камеру вимкнено'}</span>
          )}</div>
        <div className="row">
          <span className="faint">🎙</span>
          <div className="meter grow">
            <div style={{ width: `${Math.round(level * 100)}%` }} />
          </div>
        </div>
        {error && <div className="error-text">{error}</div>}
        <div className="row wrap">
          <button className={`btn ${micOn ? '' : 'off'}`} onClick={() => setMic(!micOn)}>
            {micOn ? '🎙 Мікрофон увімкнено' : '🔇 Мікрофон вимкнено'}
          </button>
          <button className={`btn ${camOn ? '' : 'off'}`} onClick={() => setCam(!camOn)}>
            {camOn ? '📷 Камера увімкнена' : '🚫 Камера вимкнена'}
          </button>
        </div>
        <DevicePickers />
        <button className="btn primary lg" onClick={onJoin}>
          Зайти в кімнату
        </button>
      </div>
    </div>
  );
}
