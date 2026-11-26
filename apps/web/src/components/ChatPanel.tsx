import { useEffect, useMemo, useRef, useState, type FormEvent } from 'react';
import type { ChatMessageDto } from '@jvof/shared';
import { emitAck } from '../lib/socket';
import { toastError } from '../store/ui';

export const CHANNEL_TITLE: Record<string, string> = {
  main: 'Загальний',
  mafia: '🔫 Мафія',
  ghosts: '👻 Привиди',
  spectators: '👀 Глядачі',
};

export function ChatPanel({ messages, access, meId }: { messages: ChatMessageDto[]; access: { read: string[]; write: string[] }; meId: string }) {
  const channels = useMemo(() => [...new Set([...access.read, ...access.write])], [access]);
  const [channel, setChannel] = useState('main');
  const [text, setText] = useState('');
  const box = useRef<HTMLDivElement>(null);
  const active = channels.includes(channel) ? channel : (access.write[0] ?? channels[0] ?? 'main');
  const shown = messages.filter((m) => m.channel === active);
  const canWrite = access.write.includes(active);

  // Якщо відкрився новий канал для запису (напр. ніч у мафії) — переключаємось на нього
  const writeKey = access.write.join(',');
  useEffect(() => {
    if (access.write.length && !access.write.includes(channel)) setChannel(access.write[0]);
  }, [writeKey]);

  useEffect(() => {
    box.current?.scrollTo({ top: box.current.scrollHeight });
  }, [shown.length, active]);

  const send = async (e: FormEvent) => {
    e.preventDefault();
    const t = text.trim();
    if (!t) return;
    setText('');
    try {
      await emitAck('room:chat', { channel: active, text: t });
    } catch (err) {
      toastError(err);
      setText(t);
    }
  };

  return (
    <div className="chat">
      {channels.length > 1 && (
        <div className="tabs" style={{ marginBottom: '0.5rem' }}>
          {channels.map((c) => (
            <button key={c} className={`tab ${c === active ? 'active' : ''}`} onClick={() => setChannel(c)}>
              {CHANNEL_TITLE[c] ?? c}
            </button>
          ))}
        </div>
      )}
      <div className="chat-messages" ref={box}>
        {shown.length === 0 && <div className="faint">Повідомлень поки немає</div>}
        {shown.map((m) => (
          <div key={m.id} className="chat-msg">
            <span className="who" style={{ color: m.userId === meId ? 'var(--accent-2)' : undefined }}>
              {m.nickname}
            </span>
            {m.text}
          </div>
        ))}
      </div>
      <form className="chat-form" onSubmit={send}>
        <input
          className="input"
          placeholder={canWrite ? 'Повідомлення…' : 'Зараз писати сюди не можна'}
          value={text}
          disabled={!canWrite}
          maxLength={500}
          onChange={(e) => setText(e.target.value)}
        />
        <button className="btn primary" disabled={!canWrite || !text.trim()}>
          ➤
        </button>
      </form>
    </div>
  );
}
