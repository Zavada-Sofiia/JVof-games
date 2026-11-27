import { Link } from 'react-router';
import { CreateRoom, JoinByCode, PublicRooms, RecentGames } from './HomePage';

/** Вкладка «Шпигун» */
export function SpyfallPage() {
  return (
    <div className="page col" style={{ gap: '1.4rem' }}>
      <section className="hero">
        <span className="hero-emoji" aria-hidden>
          🕵️
        </span>
        <h1>
          <span className="grad-text">Шпигун</span>
        </h1>
        <p>Усі гравці в одній локації — лікарні, цирку чи на підводному човні. Усі, крім шпигуна. Питайте одне одного так, щоб свої зрозуміли, а шпигун — ні.</p>
        <div className="row wrap" style={{ marginTop: '0.9rem', gap: '0.4rem' }}>
          <span className="stat-pill">❓ Питання по колу</span>
          <span className="stat-pill">☝️ Одне звинувачення на гравця</span>
          <span className="stat-pill">🗺 100 локацій</span>
          <span className="stat-pill">📍 Шпигун може вгадати локацію</span>
          <Link to="/how-to-play#spyfall" className="stat-pill" style={{ textDecoration: 'none' }}>
            📖 Правила →
          </Link>
        </div>
      </section>

      <div className="home-grid">
        <CreateRoom gameId="spyfall" />
        <div className="col" style={{ gap: '1.4rem' }}>
          <JoinByCode />
          <PublicRooms gameTitle="Шпигун" />
          <RecentGames gameType="spyfall" title="Мої партії" />
        </div>
      </div>
    </div>
  );
}
