import { useUi } from '../store/ui';

let ctx: AudioContext | null = null;

function tone(freqs: number[], duration = 0.18, type: OscillatorType = 'sine', gap = 0.12, volume = 0.08) {
  if (!useUi.getState().sounds) return;
  try {
    ctx ??= new AudioContext();
    const start = ctx.currentTime;
    freqs.forEach((f, i) => {
      const osc = ctx!.createOscillator();
      const gain = ctx!.createGain();
      osc.type = type;
      osc.frequency.value = f;
      const t0 = start + i * gap;
      gain.gain.setValueAtTime(0, t0);
      gain.gain.linearRampToValueAtTime(volume, t0 + 0.02);
      gain.gain.exponentialRampToValueAtTime(0.0001, t0 + duration);
      osc.connect(gain).connect(ctx!.destination);
      osc.start(t0);
      osc.stop(t0 + duration + 0.05);
    });
  } catch {
    /* звук не критичний */
  }
}

export const sounds = {
  night: () => tone([523, 392, 262], 0.5, 'sine', 0.22),
  day: () => tone([392, 523, 659], 0.4, 'triangle', 0.16),
  yourTurn: () => tone([880, 1175], 0.22, 'triangle', 0.14, 0.1),
  vote: () => tone([660, 660], 0.15, 'square', 0.18, 0.04),
  notify: () => tone([740, 988], 0.18, 'sine', 0.1),
  gameOver: () => tone([523, 659, 784, 1047], 0.35, 'triangle', 0.15),
};
