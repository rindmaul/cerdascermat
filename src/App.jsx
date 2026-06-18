import { BrowserRouter, Routes, Route, Navigate } from 'react-router-dom';
import Home from './pages/Home';
import Lobby from './pages/Lobby';
import Game from './pages/Game';
import Result from './pages/Result';

export default function App() {
  return (
    <BrowserRouter>
      <style>{`
      * { box-sizing: border-box; margin: 0; padding: 0; }
      body { background: #0a0e1a; font-family: system-ui, sans-serif; }
      input:focus { outline: none; border-color: rgba(59,130,246,0.6) !important; }
      button:active { transform: scale(0.97); }
      @keyframes spin { to { transform: rotate(360deg); } }
      @keyframes floatUp { 0%{transform:translateY(0);opacity:1} 100%{transform:translateY(-80px);opacity:0} }
      @keyframes popIn { 0%{transform:scale(0.5);opacity:0} 70%{transform:scale(1.1)} 100%{transform:scale(1);opacity:1} }
      @keyframes fadeSlideIn { 0%{opacity:0;transform:translateY(-8px)} 100%{opacity:1;transform:translateY(0)} }
      ::-webkit-scrollbar { width: 4px; }
      ::-webkit-scrollbar-track { background: rgba(255,255,255,0.03); }
      ::-webkit-scrollbar-thumb { background: rgba(255,255,255,0.1); border-radius: 2px; }

      /* ── Responsive Game Layout ── */
      .game-layout { display: flex; min-height: 100vh; }
      .game-main { flex: 1; padding: 16px; min-width: 0; }
      .game-sidebar { width: 260px; flex-shrink: 0; padding: 16px 16px 16px 0; }

      @media (max-width: 768px) {
        .game-sidebar { display: none; }
        .game-main { padding: 12px; }
      }

      /* ── Responsive MC Grid ── */
      .mc-grid { display: grid; grid-template-columns: 1fr 1fr; gap: 10px; }
      .tf-grid { display: grid; grid-template-columns: 1fr 1fr; gap: 10px; }

      @media (max-width: 480px) {
        .mc-grid { grid-template-columns: 1fr; }
        .tf-grid { grid-template-columns: 1fr; }
      }

      /* ── Responsive Lobby ── */
      .info-row { display: grid; grid-template-columns: 1fr 1fr 1fr; gap: 10px; margin-bottom: 16px; }
      
      @media (max-width: 400px) {
        .info-row { grid-template-columns: 1fr; }
      }

      /* ── Responsive Home ── */
      .q-grid { display: grid; grid-template-columns: repeat(5, 1fr); gap: 8px; margin-bottom: 20px; }

      @media (max-width: 400px) {
        .q-grid { grid-template-columns: repeat(4, 1fr); }
      }

      /* ── Responsive Result Podium ── */
      .podium { display: flex; align-items: flex-end; justify-content: center; gap: 12px; margin-bottom: 24px; padding: 20px 0; }

      @media (max-width: 360px) {
        .podium { gap: 6px; }
      }

      /* ── Mobile bottom leaderboard ── */
      .mobile-lb { display: none; }

      @media (max-width: 768px) {
        .mobile-lb { display: block; margin-top: 16px; }
      }

      /* ── General card ── */
      .card { background: rgba(15,23,42,0.95); border-radius: 16px; border: 1px solid rgba(255,255,255,0.08); padding: 20px; }

      @media (max-width: 480px) {
        .card { padding: 14px; border-radius: 12px; }
      }
    `}</style>
      <Routes>
        <Route path="/"              element={<Home />} />
        <Route path="/lobby/:code"   element={<Lobby />} />
        <Route path="/game/:code"    element={<Game />} />
        <Route path="/result/:code"  element={<Result />} />
        <Route path="*"              element={<Navigate to="/" />} />
      </Routes>
    </BrowserRouter>
  );
}
