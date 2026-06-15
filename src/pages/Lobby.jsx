import { useState, useEffect } from 'react';
import { useNavigate, useParams, useLocation } from 'react-router-dom';
import { socket, emitAsync } from '../socket/socket';
import PlayerList from '../components/PlayerList';

export default function Lobby() {
  const { code } = useParams();
  const location = useLocation();
  const nav = useNavigate();
  const savedLobby = sessionStorage.getItem(`lobby_${code}`);
  const initState = location.state ?? (savedLobby ? JSON.parse(savedLobby) : {});
  if (location.state) sessionStorage.setItem(`lobby_${code}`, JSON.stringify(location.state));

  const [players, setPlayers] = useState(initState.state?.players ?? []);
  const [isHost, setIsHost] = useState(initState.isHost ?? false);
  const [myId] = useState(initState.playerId);
  const [maxQ] = useState(initState.state?.maxQuestions ?? '?');
  const [loading, setLoading] = useState(false);
  const [copied, setCopied] = useState(false);

  useEffect(() => {
    // Listen for lobby events
    socket.on('player-joined', ({ player }) => {
      setPlayers(prev => {
        if (prev.find(p => p.id === player.id)) return prev;
        return [...prev, { ...player, connected: true }];
      });
    });

    socket.on('player-left', ({ playerId }) => {
      setPlayers(prev => prev.map(p => p.id === playerId ? { ...p, connected: false } : p));
    });

    socket.on('host-changed', ({ newHostId }) => {
      if (newHostId === myId) setIsHost(true);
    });

    socket.on('game-started', () => {
      nav(`/game/${code}`, { state: { isHost, playerId: myId } });
    });

    return () => {
      socket.off('player-joined');
      socket.off('player-left');
      socket.off('host-changed');
      socket.off('game-started');
    };
  }, [code, isHost, myId, nav]);

  async function startGame() {
    setLoading(true);
    const res = await emitAsync('start-game', {});
    if (!res.ok) alert(res.error);
    setLoading(false);
  }

  function copyCode() {
    navigator.clipboard.writeText(code);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  }

  const active = players.filter(p => !p.isSpectator);
  const spectators = players.filter(p => p.isSpectator);

  return (
    <div style={S.page}>
      <div style={S.container}>
        {/* Room Code Banner */}
        <div style={S.codeBanner}>
          <p style={S.codeLabel}>KODE ROOM</p>
          <div style={S.codeRow}>
            <span style={S.code}>{code}</span>
            <button style={S.copyBtn} onClick={copyCode}>
              {copied ? '✓ Disalin!' : '📋 Salin'}
            </button>
          </div>
          <p style={S.codeHint}>Bagikan kode ini kepada teman</p>
        </div>

        {/* Game Info */}
        <div className="info-row">
          <div style={S.infoBox}>
            <span style={S.infoN}>{maxQ}</span>
            <span style={S.infoL}>Soal</span>
          </div>
          <div style={S.infoBox}>
            <span style={S.infoN}>{active.length}</span>
            <span style={S.infoL}>Pemain</span>
          </div>
          <div style={S.infoBox}>
            <span style={S.infoN}>30s</span>
            <span style={S.infoL}>Per Soal</span>
          </div>
        </div>

        {/* Player list */}
        <PlayerList players={active} myId={myId} />

        {spectators.length > 0 && (
          <div style={S.spectators}>
            <span style={S.specLabel}>👀 Penonton: </span>
            {spectators.map(p => (
              <span key={p.id} style={S.specName}>{p.name}</span>
            ))}
          </div>
        )}

        {/* Start Button */}
        {isHost ? (
          <button
            style={{ ...S.startBtn, opacity: active.length < 1 ? 0.5 : 1 }}
            onClick={startGame}
            disabled={loading || active.length < 1}
          >
            {loading ? '⏳ Memulai…' : '🚀 Mulai Game!'}
          </button>
        ) : (
          <div style={S.waitBox}>
            <div style={S.spinner} />
            <span style={{ color:'#64748B', fontSize:'0.9rem' }}>Menunggu host memulai game…</span>
          </div>
        )}

        <button style={S.leaveBtn} onClick={() => {
          socket.emit('leave-room');
          nav('/');
        }}>← Keluar Room</button>
      </div>
    </div>
  );
}

const S = {
  page: { minHeight:'100vh', display:'flex', alignItems:'center', justifyContent:'center',
    background:'#0a0e1a', padding:'20px', fontFamily:'system-ui,sans-serif' },
  container: { width:'100%', maxWidth:'500px' },
  codeBanner: { background:'rgba(15,23,42,0.95)', border:'1px solid rgba(255,255,255,0.08)',
    borderRadius:'16px', padding:'24px', textAlign:'center', marginBottom:'16px' },
  codeLabel: { color:'#64748B', fontSize:'0.75rem', fontWeight:700, letterSpacing:'0.1em',
    textTransform:'uppercase', margin:'0 0 8px' },
  codeRow: { display:'flex', alignItems:'center', justifyContent:'center', gap:'12px' },
  code: { fontSize:'2.2rem', fontWeight:900, color:'#60A5FA', letterSpacing:'0.15em' },
  copyBtn: { padding:'8px 16px', borderRadius:'8px', border:'1px solid rgba(96,165,250,0.4)',
    background:'rgba(96,165,250,0.1)', color:'#60A5FA', cursor:'pointer', fontWeight:700,
    fontSize:'0.8rem' },
  codeHint: { color:'#475569', fontSize:'0.8rem', margin:'8px 0 0' },
  infoRow: { display:'grid', gridTemplateColumns:'1fr 1fr 1fr', gap:'10px', marginBottom:'16px' },
  infoBox: { background:'rgba(15,23,42,0.95)', border:'1px solid rgba(255,255,255,0.08)',
    borderRadius:'12px', padding:'14px', textAlign:'center', display:'flex',
    flexDirection:'column', gap:'4px' },
  infoN: { fontSize:'1.5rem', fontWeight:900, color:'#EDF2FF' },
  infoL: { fontSize:'0.72rem', color:'#64748B', textTransform:'uppercase', fontWeight:600 },
  spectators: { padding:'10px 14px', background:'rgba(255,255,255,0.03)',
    borderRadius:'10px', marginBottom:'14px', fontSize:'0.82rem', color:'#64748B' },
  specLabel: { fontWeight:700 },
  specName: { marginLeft:'8px', color:'#94A3B8' },
  startBtn: { width:'100%', padding:'16px', border:'none', borderRadius:'14px',
    background:'linear-gradient(135deg,#10B981,#3B82F6)', color:'#fff',
    fontSize:'1.1rem', fontWeight:900, cursor:'pointer', marginBottom:'12px',
    boxShadow:'0 8px 25px rgba(16,185,129,0.35)' },
  waitBox: { display:'flex', alignItems:'center', justifyContent:'center', gap:'12px',
    padding:'16px', marginBottom:'12px' },
  spinner: { width:'20px', height:'20px', border:'3px solid rgba(255,255,255,0.1)',
    borderTopColor:'#60A5FA', borderRadius:'50%',
    animation:'spin 0.8s linear infinite' },
  leaveBtn: { width:'100%', padding:'12px', border:'1px solid rgba(255,255,255,0.08)',
    borderRadius:'10px', background:'transparent', color:'#64748B', cursor:'pointer',
    fontWeight:600, fontSize:'0.9rem' },
};
