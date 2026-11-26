import { lazy, Suspense, useEffect, type ReactNode } from 'react';
import { Link, NavLink, Navigate, Route, Routes, useLocation } from 'react-router';
import { Avatar, Spinner, Toasts } from './components/ui';
import { useRealtime } from './lib/realtime';
import { ForgotPage, LoginPage, RegisterPage, ResetPage, VerifyPage } from './pages/AuthPages';
import { HomePage } from './pages/HomePage';
import { HowToPlayPage, PrivacyPage } from './pages/InfoPages';
import { MafiaPage } from './pages/MafiaPage';
import { useAuth } from './store/auth';
import { useUi } from './store/ui';

const ProfilePage = lazy(() => import('./pages/ProfilePage'));
const RoomPage = lazy(() => import('./pages/RoomPage'));
const GameDetailPage = lazy(() => import('./pages/GameDetailPage'));

function Header() {
  const user = useAuth((s) => s.user);
  const { theme, toggleTheme, sounds, toggleSounds } = useUi();
  return (
    <header className="header">
      <Link to="/" className="logo">
        <img src="/favicon.svg" alt="" /> <span>JVof games</span>
      </Link>
      {user && (
        <nav className="nav">
          <NavLink to="/" end>
            Головна
          </NavLink>
          <NavLink to="/mafia">🎭 Мафія</NavLink>
          <NavLink to="/how-to-play">Як грати</NavLink>
        </nav>
      )}
      <span className="spacer" />
      <button className="btn ghost sm" onClick={toggleSounds} title={sounds ? 'Вимкнути звуки подій' : 'Увімкнути звуки подій'}>
        {sounds ? '🔔' : '🔕'}
      </button>
      <button className="btn ghost sm" onClick={toggleTheme} title="Змінити тему">
        {theme === 'dark' ? '☀️' : '🌙'}
      </button>
      {user && (
        <Link to="/profile" className="row" style={{ color: 'var(--text)', textDecoration: 'none' }} title="Профіль">
          <Avatar user={user} size={30} />
          <span className="hide-sm" style={{ fontWeight: 600 }}>
            {user.nickname}
          </span>
        </Link>
      )}
    </header>
  );
}

function RequireAuth({ children }: { children: ReactNode }) {
  const status = useAuth((s) => s.status);
  const location = useLocation();
  if (status === 'loading') return <Spinner full />;
  if (status === 'out') return <Navigate to={`/login?next=${encodeURIComponent(location.pathname + location.search)}`} replace />;
  return <>{children}</>;
}

function GuestOnly({ children }: { children: ReactNode }) {
  const status = useAuth((s) => s.status);
  const next = new URLSearchParams(useLocation().search).get('next');
  if (status === 'loading') return <Spinner full />;
  if (status === 'in') return <Navigate to={next && next.startsWith('/') ? next : '/'} replace />;
  return <>{children}</>;
}

export function App() {
  const init = useAuth((s) => s.init);
  useEffect(() => {
    void init();
  }, [init]);
  useRealtime();
  const inRoom = useLocation().pathname.startsWith('/room/');

  return (
    <div className="app">
      <Header />
      <main style={{ flex: 1 }}>
        <Suspense fallback={<Spinner full />}>
          <Routes>
            <Route path="/login" element={<GuestOnly><LoginPage /></GuestOnly>} />
            <Route path="/register" element={<GuestOnly><RegisterPage /></GuestOnly>} />
            <Route path="/forgot" element={<GuestOnly><ForgotPage /></GuestOnly>} />
            <Route path="/reset" element={<ResetPage />} />
            <Route path="/verify" element={<VerifyPage />} />
            <Route path="/how-to-play" element={<HowToPlayPage />} />
            <Route path="/privacy" element={<PrivacyPage />} />
            <Route path="/" element={<RequireAuth><HomePage /></RequireAuth>} />
            <Route path="/mafia" element={<RequireAuth><MafiaPage /></RequireAuth>} />
            <Route path="/profile" element={<RequireAuth><ProfilePage /></RequireAuth>} />
            <Route path="/room/:code" element={<RequireAuth><RoomPage /></RequireAuth>} />
            <Route path="/games/:id" element={<RequireAuth><GameDetailPage /></RequireAuth>} />
            <Route path="*" element={<div className="page"><h1>Сторінку не знайдено</h1><Link to="/">На головну</Link></div>} />
          </Routes>
        </Suspense>
      </main>
      {!inRoom && (
        <footer className="footer">
          <Link to="/how-to-play">Як грати</Link> · <Link to="/privacy">Конфіденційність</Link>
        </footer>
      )}
      <Toasts />
    </div>
  );
}
