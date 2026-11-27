import type { IceConfigDto, RtcSignal } from '@jvof/shared';
import type { AppSocket } from '../lib/socket';

export type PeerState = 'connecting' | 'connected' | 'failed';

/**
 * Абстракція відео-сервісу. Зараз — WebRTC P2P (mesh). Якщо колись знадобиться LiveKit,
 * він реалізує той самий інтерфейс, і гру переписувати не доведеться (розділ 5).
 */
export interface VideoProvider {
  /** Хто зараз у кімнаті (крім мене) — з ними тримаємо з'єднання */
  setPeers(ids: string[]): void;
  /** Мої треки та кому їх зараз можна надсилати (політика сервера) */
  setLocal(audio: MediaStreamTrack | null, video: MediaStreamTrack | null, sendAudioTo: (peer: string) => boolean, sendVideoTo: (peer: string) => boolean): void;
  onStreams(cb: (streams: Map<string, MediaStream>) => void): void;
  onStates(cb: (states: Map<string, PeerState>) => void): void;
  /** Рівень звуку кожного співрозмовника 0..1 (з WebRTC, без WebAudio) */
  audioLevels(): Map<string, number>;
  /** Перебудувати всі з'єднання з нуля */
  restart(): void;
  close(): void;
}

interface Peer {
  id: string;
  pc: RTCPeerConnection;
  polite: boolean;
  makingOffer: boolean;
  ignoreOffer: boolean;
  audio: RTCRtpSender;
  video: RTCRtpSender;
  stream: MediaStream;
  pending: RTCIceCandidateInit[];
  /** Сесія співрозмовника, з якою зв'язане це з'єднання */
  remoteSession: string | null;
  state: PeerState;
  failTimer: ReturnType<typeof setTimeout> | null;
  createdAt: number;
}

const MAX_VIDEO_BITRATE = 450_000;
const randomId = () => Math.random().toString(36).slice(2) + Date.now().toString(36);

export class MeshProvider implements VideoProvider {
  private peers = new Map<string, Peer>();
  private wanted = new Set<string>();
  private streamListener: (s: Map<string, MediaStream>) => void = () => {};
  private stateListener: (s: Map<string, PeerState>) => void = () => {};
  private local: { audio: MediaStreamTrack | null; video: MediaStreamTrack | null; sendAudioTo: (p: string) => boolean; sendVideoTo: (p: string) => boolean } = {
    audio: null,
    video: null,
    sendAudioTo: () => false,
    sendVideoTo: () => false,
  };
  private closed = false;
  /** Моя сесія: нова після кожного перезавантаження сторінки */
  private session = randomId();

  constructor(
    private selfId: string,
    private socket: AppSocket,
    private ice: IceConfigDto,
  ) {
    socket.on('rtc:signal', this.onSignal);
  }

  onStreams(cb: (s: Map<string, MediaStream>) => void) {
    this.streamListener = cb;
    this.emit();
  }

  onStates(cb: (s: Map<string, PeerState>) => void) {
    this.stateListener = cb;
    this.emitStates();
  }

  private emit() {
    this.streamListener(new Map([...this.peers].map(([id, p]) => [id, p.stream])));
  }

  private emitStates() {
    this.stateListener(new Map([...this.peers].map(([id, p]) => [id, p.state])));
  }

  audioLevels(): Map<string, number> {
    const out = new Map<string, number>();
    for (const [id, p] of this.peers) {
      for (const r of p.pc.getReceivers()) {
        if (r.track?.kind !== 'audio') continue;
        const src = r.getSynchronizationSources?.()[0];
        if (!src) continue;
        // audioLevel лишається від останнього пакета; якщо пакетів давно не було — людина мовчить.
        // Браузери рахують timestamp по-різному (від епохи або від timeOrigin), тож перевіряємо обидва.
        const age = Math.min(Math.abs(Date.now() - src.timestamp), Math.abs(performance.now() - src.timestamp));
        if (age < 1000) out.set(id, src.audioLevel ?? 0);
      }
    }
    return out;
  }

  setPeers(ids: string[]) {
    this.wanted = new Set(ids.filter((id) => id !== this.selfId));
    for (const id of [...this.peers.keys()]) if (!this.wanted.has(id)) this.drop(id);
    for (const id of this.wanted) if (!this.peers.has(id)) this.create(id);
  }

  setLocal(audio: MediaStreamTrack | null, video: MediaStreamTrack | null, sendAudioTo: (p: string) => boolean, sendVideoTo: (p: string) => boolean) {
    this.local = { audio, video, sendAudioTo, sendVideoTo };
    for (const p of this.peers.values()) this.applyLocal(p);
  }

  /** Подвійне виконання політики: відправник просто не надсилає трек тим, кому зараз не можна */
  private applyLocal(p: Peer) {
    const a = this.local.sendAudioTo(p.id) ? this.local.audio : null;
    const v = this.local.sendVideoTo(p.id) ? this.local.video : null;
    if (p.audio.track !== a) p.audio.replaceTrack(a).catch(() => {});
    if (p.video.track !== v) p.video.replaceTrack(v).catch(() => {});
  }

  private signal(to: string, signal: RtcSignal) {
    this.socket.emit('rtc:signal', { to, signal: { ...signal, session: this.session } });
  }

  private setState(p: Peer, state: PeerState) {
    if (p.state === state) return;
    p.state = state;
    this.emitStates();
  }

  private create(id: string, remoteSession: string | null = null): Peer {
    const pc = new RTCPeerConnection({ iceServers: this.ice.iceServers });
    // Кожен надсилає свої аудіо й відео в окремих «sendonly» лініях, а приймає лінії співрозмовника
    const audioTx = pc.addTransceiver('audio', { direction: 'sendonly' });
    const videoTx = pc.addTransceiver('video', { direction: 'sendonly' });

    const peer: Peer = {
      id,
      pc,
      polite: this.selfId > id,
      makingOffer: false,
      ignoreOffer: false,
      audio: audioTx.sender,
      video: videoTx.sender,
      stream: new MediaStream(),
      pending: [],
      remoteSession,
      state: 'connecting',
      failTimer: null,
      createdAt: Date.now(),
    };
    this.peers.set(id, peer);

    pc.ontrack = (e) => {
      const tracks = peer.stream.getTracks().filter((t) => t.kind !== e.track.kind || t === e.track);
      if (!tracks.includes(e.track)) tracks.push(e.track);
      // новий об'єкт, щоб React побачив зміну
      peer.stream = new MediaStream(tracks);
      this.emit();
    };
    pc.onicecandidate = ({ candidate }) => this.signal(id, { candidate: candidate ? (candidate.toJSON() as RtcSignal['candidate']) : null });
    pc.onnegotiationneeded = async () => {
      try {
        peer.makingOffer = true;
        await pc.setLocalDescription();
        this.signal(id, { description: pc.localDescription!.toJSON() });
      } catch (e) {
        console.warn('negotiation failed', e);
      } finally {
        peer.makingOffer = false;
      }
    };
    pc.oniceconnectionstatechange = () => {
      if (pc.iceConnectionState === 'failed') pc.restartIce();
    };
    pc.onconnectionstatechange = () => {
      if (this.peers.get(id) !== peer) return;
      const s = pc.connectionState;
      if (s === 'connected') {
        if (peer.failTimer) clearTimeout(peer.failTimer);
        peer.failTimer = null;
        this.setState(peer, 'connected');
        // після з'єднання (зокрема в Safari) ще раз прикладаємо параметри відео
        this.limitVideo(peer);
      } else if (s === 'failed' || s === 'disconnected') {
        this.setState(peer, s === 'failed' ? 'failed' : 'connecting');
        // не відновилось за кілька секунд — перебудовуємо з'єднання з нуля
        if (!peer.failTimer && !this.closed) {
          peer.failTimer = setTimeout(() => {
            peer.failTimer = null;
            if (this.peers.get(id) === peer && pc.connectionState !== 'connected') this.rebuild(id);
          }, s === 'failed' ? 2000 : 8000);
        }
      }
    };
    this.applyLocal(peer);
    this.emit();
    this.emitStates();
    return peer;
  }

  private limitVideo(p: Peer) {
    try {
      const params = p.video.getParameters();
      if (!params.encodings?.length) return;
      params.encodings[0].maxBitrate = MAX_VIDEO_BITRATE;
      p.video.setParameters(params).catch(() => {});
    } catch {
      /* не всі браузери дозволяють */
    }
  }

  private rebuild(id: string, remoteSession: string | null = null): Peer {
    this.drop(id);
    return this.create(id, remoteSession);
  }

  private drop(id: string) {
    const p = this.peers.get(id);
    if (!p) return;
    if (p.failTimer) clearTimeout(p.failTimer);
    p.pc.close();
    this.peers.delete(id);
    this.emit();
    this.emitStates();
  }

  restart() {
    // нова сесія: співрозмовники побачать її й теж перебудують з'єднання
    this.session = randomId();
    for (const id of [...this.peers.keys()]) this.rebuild(id);
  }

  /** Perfect negotiation (MDN): ввічливий бік поступається при зустрічних offer */
  private onSignal = async ({ from, signal }: { from: string; signal: RtcSignal }) => {
    if (this.closed || from === this.selfId) return;
    let peer = this.peers.get(from);
    if (!peer) peer = this.create(from, signal.session ?? null);
    else if (signal.session && peer.remoteSession && signal.session !== peer.remoteSession) {
      // співрозмовник перезавантажив сторінку — старе з'єднання вже мертве
      if (!signal.description) return; // кандидати старої/нової сесії до offer ігноруємо
      peer = this.rebuild(from, signal.session);
    } else if (signal.session && !peer.remoteSession) peer.remoteSession = signal.session;

    const { pc } = peer;
    try {
      if (signal.description) {
        const d = signal.description;
        const collision = d.type === 'offer' && (peer.makingOffer || pc.signalingState !== 'stable');
        peer.ignoreOffer = !peer.polite && collision;
        if (peer.ignoreOffer) return;
        await pc.setRemoteDescription(d as RTCSessionDescriptionInit);
        for (const c of peer.pending.splice(0)) await pc.addIceCandidate(c).catch(() => {});
        if (d.type === 'offer') {
          await pc.setLocalDescription();
          this.signal(from, { description: pc.localDescription!.toJSON() });
        }
      } else if (signal.candidate !== undefined) {
        if (!pc.remoteDescription) {
          if (signal.candidate) peer.pending.push(signal.candidate as RTCIceCandidateInit);
          return;
        }
        try {
          await pc.addIceCandidate((signal.candidate ?? undefined) as RTCIceCandidateInit | undefined);
        } catch (e) {
          if (!peer.ignoreOffer) console.warn('ICE candidate error', e);
        }
      }
    } catch (e) {
      console.warn('signal handling failed', e);
      // зламаний стан (напр. розбіжність m-ліній) — перебудовуємо
      if (this.wanted.has(from) && Date.now() - peer.createdAt > 3000) this.rebuild(from, signal.session ?? null);
    }
  };

  close() {
    this.closed = true;
    this.socket.off('rtc:signal', this.onSignal);
    for (const id of [...this.peers.keys()]) this.drop(id);
  }
}
