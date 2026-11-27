import { Link } from 'react-router';
import { CreateRoom, JoinByCode, PublicRooms, RecentGames } from './HomePage';

/** Вкладка «Мафія»: усе про гру в одному місці */
export function MafiaPage() {
  return (
    <div className="page col" style={{ gap: '1.4rem' }}>
      <section className="hero">
        <span className="hero-emoji" aria-hidden>
          🎭
        </span>
        <h1>
          <span className="grad-text">Мафія</span>
        </h1>
        <p>Мирні вдень шукають мафію, мафія вночі обирає жертву. Камери, мікрофони й черга промов перемикаються самі — залишається тільки блефувати.</p>
        <div className="row wrap" style={{ marginTop: '0.9rem', gap: '0.4rem' }}>
          <span className="stat-pill">🙂 Мирні</span>
          <span className="stat-pill">⭐ Шериф</span>
          <span className="stat-pill">💉 Лікар</span>
          <span className="stat-pill">💋 Повія</span>
          <span className="stat-pill">🔫 Мафія</span>
          <span className="stat-pill">🎩 Дон</span>
          <Link to="/how-to-play" className="stat-pill" style={{ textDecoration: 'none' }}>
            📖 Правила →
          </Link>
        </div>
      </section>

      <div className="home-grid">
        <CreateRoom gameId="mafia" />
        <div className="col" style={{ gap: '1.4rem' }}>
          <JoinByCode />
          <PublicRooms gameTitle="Мафія" />
          <RecentGames gameType="mafia" title="Мої партії" />
        </div>
      </div>
    </div>
  );
}
