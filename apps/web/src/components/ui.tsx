import { useEffect, type ReactNode } from 'react';
import { createPortal } from 'react-dom';
import type { PublicUser } from '@jvof/shared';
import { useUi } from '../store/ui';

export function Avatar({ user, size = 36 }: { user: Pick<PublicUser, 'nickname' | 'avatarColor' | 'avatarUrl'>; size?: number }) {
  const initials = user.nickname
    .split(/\s+/)
    .map((w) => w[0])
    .join('')
    .slice(0, 2)
    .toUpperCase();
  return (
    <div className="avatar" style={{ width: size, height: size, background: user.avatarColor, fontSize: size * 0.38 }}>
      {user.avatarUrl ? <img src={user.avatarUrl} alt="" /> : initials}
    </div>
  );
}

export function Spinner({ full }: { full?: boolean }) {
  return full ? (
    <div className="center" style={{ minHeight: '50vh' }}>
      <div className="spinner" />
    </div>
  ) : (
    <div className="spinner" />
  );
}

export function Modal({ title, onClose, children }: { title: string; onClose: () => void; children: ReactNode }) {
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && onClose();
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose]);
  // Портал у body: інакше backdrop-filter батьківських панелей обмежує position: fixed
  return createPortal(
    <div className="modal-backdrop" onMouseDown={(e) => e.target === e.currentTarget && onClose()}>
      <div className="modal" role="dialog" aria-modal="true" aria-label={title}>
        <div className="row" style={{ marginBottom: '0.8rem' }}>
          <h2 style={{ margin: 0 }}>{title}</h2>
          <span className="spacer" />
          <button className="btn ghost sm" onClick={onClose} aria-label="Закрити">
            ✕
          </button>
        </div>
        {children}
      </div>
    </div>,
    document.body,
  );
}

export function Toasts() {
  const { toasts, dismiss } = useUi();
  return (
    <div className="toasts" aria-live="polite">
      {toasts.map((t) => (
        <div key={t.id} className={`toast ${t.kind}`}>
          <span className="grow">{t.text}</span>
          {t.action && (
            <button
              className="btn primary sm"
              onClick={() => {
                t.action!.onClick();
                dismiss(t.id);
              }}
            >
              {t.action.label}
            </button>
          )}
          <button className="btn ghost sm" onClick={() => dismiss(t.id)} aria-label="Закрити">
            ✕
          </button>
        </div>
      ))}
    </div>
  );
}

export function copyText(text: string, label = 'Скопійовано') {
  navigator.clipboard
    .writeText(text)
    .then(() => useUi.getState().toast(label, 'success'))
    .catch(() => useUi.getState().toast(text, 'info'));
}

export function timeAgo(iso: string) {
  return new Date(iso).toLocaleString('uk-UA', { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' });
}
