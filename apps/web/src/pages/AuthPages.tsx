import { useEffect, useState, type FormEvent } from 'react';
import { Link, useNavigate, useSearchParams } from 'react-router';
import { api } from '../lib/api';
import { useAuth } from '../store/auth';
import { toast } from '../store/ui';

function useSubmit(fn: () => Promise<void>) {
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const submit = async (e: FormEvent) => {
    e.preventDefault();
    setError('');
    setBusy(true);
    try {
      await fn();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Помилка');
    } finally {
      setBusy(false);
    }
  };
  return { error, busy, submit };
}

export function LoginPage() {
  const login = useAuth((s) => s.login);
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const { error, busy, submit } = useSubmit(() => login(email, password));
  return (
    <div className="page narrow">
      <form className="card col" onSubmit={submit}>
        <h1>Вхід</h1>
        <p className="muted">Мафія та інші ігри з друзями: бачите й чуєте одне одного, а гра сама керує тим, хто коли говорить.</p>
        <label className="field">
          Email
          <input className="input" type="email" autoComplete="email" required value={email} onChange={(e) => setEmail(e.target.value)} />
        </label>
        <label className="field">
          Пароль
          <input className="input" type="password" autoComplete="current-password" required value={password} onChange={(e) => setPassword(e.target.value)} />
        </label>
        {error && <div className="error-text">{error}</div>}
        <button className="btn primary lg" disabled={busy}>
          Увійти
        </button>
        <div className="row" style={{ justifyContent: 'space-between' }}>
          <Link to="/register">Створити акаунт</Link>
          <Link to="/forgot">Забули пароль?</Link>
        </div>
      </form>
    </div>
  );
}

export function RegisterPage() {
  const register = useAuth((s) => s.register);
  const [email, setEmail] = useState('');
  const [nickname, setNickname] = useState('');
  const [password, setPassword] = useState('');
  const { error, busy, submit } = useSubmit(async () => {
    await register(email, nickname, password);
    toast('Акаунт створено! Ми надіслали лист для підтвердження пошти.', 'success');
  });
  return (
    <div className="page narrow">
      <form className="card col" onSubmit={submit}>
        <h1>Реєстрація</h1>
        <label className="field">
          Email
          <input className="input" type="email" autoComplete="email" required value={email} onChange={(e) => setEmail(e.target.value)} />
        </label>
        <label className="field">
          Нікнейм (його бачать друзі)
          <input className="input" autoComplete="nickname" required minLength={2} maxLength={24} value={nickname} onChange={(e) => setNickname(e.target.value)} />
        </label>
        <label className="field">
          Пароль (щонайменше 8 символів)
          <input className="input" type="password" autoComplete="new-password" required minLength={8} value={password} onChange={(e) => setPassword(e.target.value)} />
        </label>
        {error && <div className="error-text">{error}</div>}
        <button className="btn primary lg" disabled={busy}>
          Зареєструватися
        </button>
        <p className="faint" style={{ margin: 0 }}>
          Реєструючись, ви погоджуєтесь з <Link to="/privacy">умовами конфіденційності</Link>. Відео не записується.
        </p>
        <Link to="/login">Уже маю акаунт</Link>
      </form>
    </div>
  );
}

export function ForgotPage() {
  const [email, setEmail] = useState('');
  const [sent, setSent] = useState(false);
  const { error, busy, submit } = useSubmit(async () => {
    await api('/auth/password/forgot', { body: { email } });
    setSent(true);
  });
  return (
    <div className="page narrow">
      <form className="card col" onSubmit={submit}>
        <h1>Відновлення пароля</h1>
        {sent ? (
          <p>Якщо акаунт із такою поштою існує, ми надіслали лист із посиланням. Перевірте пошту (і папку «Спам»).</p>
        ) : (
          <>
            <label className="field">
              Email
              <input className="input" type="email" required value={email} onChange={(e) => setEmail(e.target.value)} />
            </label>
            {error && <div className="error-text">{error}</div>}
            <button className="btn primary" disabled={busy}>
              Надіслати посилання
            </button>
          </>
        )}
        <Link to="/login">Повернутися до входу</Link>
      </form>
    </div>
  );
}

export function ResetPage() {
  const [params] = useSearchParams();
  const navigate = useNavigate();
  const [password, setPassword] = useState('');
  const { error, busy, submit } = useSubmit(async () => {
    await api('/auth/password/reset', { body: { token: params.get('token') ?? '', password } });
    toast('Пароль змінено. Увійдіть з новим паролем.', 'success');
    await useAuth.getState().logout();
    navigate('/login');
  });
  return (
    <div className="page narrow">
      <form className="card col" onSubmit={submit}>
        <h1>Новий пароль</h1>
        <label className="field">
          Новий пароль (щонайменше 8 символів)
          <input className="input" type="password" autoComplete="new-password" required minLength={8} value={password} onChange={(e) => setPassword(e.target.value)} />
        </label>
        {error && <div className="error-text">{error}</div>}
        <button className="btn primary" disabled={busy}>
          Зберегти пароль
        </button>
      </form>
    </div>
  );
}

export function VerifyPage() {
  const [params] = useSearchParams();
  const [state, setState] = useState<'loading' | 'ok' | 'error'>('loading');
  const [message, setMessage] = useState('');
  useEffect(() => {
    api('/auth/verify', { body: { token: params.get('token') ?? '' } })
      .then(() => {
        setState('ok');
        const u = useAuth.getState().user;
        if (u) useAuth.getState().setUser({ ...u, emailVerified: true });
      })
      .catch((e: Error) => {
        setState('error');
        setMessage(e.message);
      });
  }, [params]);
  return (
    <div className="page narrow">
      <div className="card col">
        <h1>Підтвердження пошти</h1>
        {state === 'loading' && <p>Перевіряємо...</p>}
        {state === 'ok' && <p>Пошту підтверджено. Дякуємо!</p>}
        {state === 'error' && <p className="error-text">{message}</p>}
        <Link to="/">На головну</Link>
      </div>
    </div>
  );
}
