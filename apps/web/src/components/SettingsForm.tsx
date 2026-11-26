import type { SettingsField } from '@jvof/game-core';

/** Форма налаштувань гри, побудована зі схеми модуля (кожна гра описує свої поля) */
export function SettingsForm({
  schema,
  value,
  onChange,
  disabled,
  only,
}: {
  schema: SettingsField[];
  value: Record<string, unknown>;
  onChange: (patch: Record<string, unknown>) => void;
  disabled?: boolean;
  only?: string[];
}) {
  const fields = only ? schema.filter((f) => only.includes(f.key)) : schema;
  const manualHidden = (key: string) => ['mafiaCount', 'don', 'sheriff', 'doctor'].includes(key) && value.rolesMode !== 'manual';
  return (
    <div className="col">
      {fields
        .filter((f) => !manualHidden(f.key) && !(f.key === 'lastSpeechSeconds' && value.lastSpeech === false))
        .map((f) => {
          if (f.type === 'boolean')
            return (
              <label key={f.key} className="check" title={f.hint}>
                <input type="checkbox" checked={!!value[f.key]} disabled={disabled} onChange={(e) => onChange({ [f.key]: e.target.checked })} />
                <span>
                  {f.label}
                  {f.hint && <span className="faint"> — {f.hint}</span>}
                </span>
              </label>
            );
          if (f.type === 'number')
            return (
              <label key={f.key} className="field">
                <span>
                  {f.label}: <b style={{ color: 'var(--text)' }}>{String(value[f.key] ?? f.default)}{f.unit ? ` ${f.unit}` : ''}</b>
                </span>
                <input
                  type="range"
                  min={f.min}
                  max={f.max}
                  step={f.step ?? 1}
                  value={Number(value[f.key] ?? f.default)}
                  disabled={disabled}
                  onChange={(e) => onChange({ [f.key]: Number(e.target.value) })}
                  style={{ accentColor: 'var(--accent)' }}
                />
              </label>
            );
          return (
            <label key={f.key} className="field">
              <span>{f.label}</span>
              <select className="input" value={String(value[f.key] ?? f.default)} disabled={disabled} onChange={(e) => onChange({ [f.key]: e.target.value })}>
                {f.options.map((o) => (
                  <option key={o.value} value={o.value}>
                    {o.label}
                  </option>
                ))}
              </select>
            </label>
          );
        })}
    </div>
  );
}
