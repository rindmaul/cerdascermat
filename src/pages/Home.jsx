import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { socket, emitAsync, saveSession, loadSession, clearSession } from '../socket/socket';

const QUESTION_OPTIONS = [20,30,50,100,150,200,250,300,350,400,450,500];

export default function Home() {
  const nav = useNavigate();
  const [tab, setTab] = useState('join');         // 'join' | 'create'
  const [name, setName] = useState('');
  const [code, setCode] = useState('');
  const [maxQ, setMaxQ] = useState(100);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');

  async function handleConnect(action) {
    if (!name.trim()) return setError('Masukkan nama terlebih dahulu');
    if (action === 'join' && !code.trim()) return setError('Masukkan kode room');
    setError('');
    setLoading(true);

    try {
      if (!socket.connected) socket.connect();
      await new Promise((res, rej) => {
        socket.once('connect', res);
        socket.once('connect_error', rej);
        if (socket.connected) res();
      });

      const { sessionToken } = loadSession();

      if (action === 'create') {
        const res = await emitAsync('create-room', { playerName: name.trim(), maxQuestions: maxQ });
        if (!res.ok) throw new Error(res.error);
        saveSession(res.sessionToken, res.playerId);

        // Ambil state terbaru dari server supaya host sudah masuk sebagai pemain
        const joinRes = await emitAsync('join-room', {
          code: res.code,
          playerName: name.trim(),
          sessionToken: res.sessionToken,
        });

        nav(`/lobby/${res.code}`, { 
          state: { 
            isHost: true, 
            playerId: res.playerId, 
            state: joinRes.state ?? res.state 
          } 
});
      } else {
        // Clear session lama supaya nama baru dipakai
        clearSession();

        const res = await emitAsync('join-room', {
          code: code.toUpperCase().trim(),
          playerName: name.trim(),
          sessionToken: null,  // force buat player baru
        });

        if (!res.ok) throw new Error(res.error);
        saveSession(res.sessionToken, res.playerId);

        if (res.state?.status === 'playing') {
          nav(`/game/${code.toUpperCase().trim()}`, {
            state: { isHost: res.isHost, playerId: res.playerId, rejoined: true },
          });
        } else {
          nav(`/lobby/${code.toUpperCase().trim()}`, {
            state: { isHost: res.isHost, playerId: res.playerId, state: res.state },
          });
        }
      }
    } catch (e) {
      setError(e.message || 'Koneksi gagal');
    } finally {
      setLoading(false);
    }
  }

  return (
    <div style={styles.page}>
      <div style={styles.card}>
        {/* Header */}
        <div style={styles.header}>
          <div style={styles.logo}>🧠</div>
          <h1 style={styles.title}>CerdasCermat</h1>
          <p style={styles.sub}>Multiplayer Quiz Realtime</p>
        </div>

        {/* Tabs */}
        <div style={styles.tabs}>
          {['join','create'].map(t => (
            <button key={t} onClick={() => setTab(t)}
              style={{ ...styles.tab, ...(tab === t ? styles.tabActive : {}) }}>
              {t === 'join' ? '🚪 Gabung Room' : '🏠 Buat Room'}
            </button>
          ))}
        </div>

        {/* Name */}
        <label style={styles.label}>Nama Kamu</label>
        <input
          style={styles.input}
          placeholder="Contoh: Budi123"
          maxLength={30}
          value={name}
          onChange={e => setName(e.target.value)}
          onKeyDown={e => e.key === 'Enter' && handleConnect(tab)}
        />

        {/* Join: code input */}
        {tab === 'join' && (
          <>
            <label style={styles.label}>Kode Room</label>
            <input
              style={{ ...styles.input, textTransform: 'uppercase', letterSpacing: '0.2em', fontWeight: 700 }}
              placeholder="Contoh: ABCD123"
              maxLength={8}
              value={code}
              onChange={e => setCode(e.target.value.toUpperCase())}
              onKeyDown={e => e.key === 'Enter' && handleConnect('join')}
            />
          </>
        )}

        {/* Create: max questions */}
        {tab === 'create' && (
          <>
            <label style={styles.label}>Jumlah Soal</label>
            <div className="q-grid">
              {QUESTION_OPTIONS.map(n => (
                <button key={n} onClick={() => setMaxQ(n)}
                  style={{ ...styles.qBtn, ...(maxQ === n ? styles.qBtnActive : {}) }}>
                  {n}
                </button>
              ))}
            </div>
          </>
        )}

        {error && <div style={styles.error}>{error}</div>}

        <button style={styles.btn} onClick={() => handleConnect(tab)} disabled={loading}>
          {loading ? '⏳ Menghubungkan…' : tab === 'join' ? '🚀 Gabung Sekarang' : '🎮 Buat Room'}
        </button>

        <p style={styles.hint}>
          {tab === 'join'
            ? 'Minta kode room dari host untuk bergabung'
            : 'Kamu akan menjadi host dan bisa memulai game'}
        </p>
      </div>
    </div>
  );
}

const styles = {
  page: { minHeight:'100vh', display:'flex', alignItems:'center', justifyContent:'center',
    background:'linear-gradient(135deg,#0a0e1a 0%,#0f172a 50%,#0a0e1a 100%)',
    padding:'20px', fontFamily:'system-ui,sans-serif' },
  card: { width:'100%', maxWidth:'420px', background:'rgba(15,23,42,0.95)',
    borderRadius:'20px', padding:'32px', border:'1px solid rgba(255,255,255,0.08)',
    boxShadow:'0 25px 50px rgba(0,0,0,0.5)' },
  header: { textAlign:'center', marginBottom:'28px' },
  logo: { fontSize:'3rem', marginBottom:'8px' },
  title: { fontSize:'1.8rem', fontWeight:900, color:'#EDF2FF', margin:'0 0 4px' },
  sub: { color:'#64748B', fontSize:'0.9rem', margin:0 },
  tabs: { display:'flex', gap:'8px', marginBottom:'24px' },
  tab: { flex:1, padding:'10px', border:'1px solid rgba(255,255,255,0.1)', borderRadius:'10px',
    background:'transparent', color:'#64748B', cursor:'pointer', fontWeight:600, fontSize:'0.85rem',
    transition:'all 0.2s' },
  tabActive: { background:'rgba(59,130,246,0.15)', border:'1px solid rgba(59,130,246,0.4)',
    color:'#60A5FA' },
  label: { display:'block', color:'#94A3B8', fontSize:'0.8rem', fontWeight:600,
    marginBottom:'6px', textTransform:'uppercase', letterSpacing:'0.05em' },
  input: { width:'100%', padding:'12px 14px', borderRadius:'10px',
    border:'1px solid rgba(255,255,255,0.1)', background:'rgba(255,255,255,0.05)',
    color:'#EDF2FF', fontSize:'1rem', marginBottom:'18px', boxSizing:'border-box',
    outline:'none', fontFamily:'inherit' },
  grid: { display:'grid', gridTemplateColumns:'repeat(6,1fr)', gap:'8px', marginBottom:'20px' },
  qBtn: { padding:'10px 0', border:'1px solid rgba(255,255,255,0.1)', borderRadius:'8px',
    background:'transparent', color:'#64748B', cursor:'pointer', fontWeight:700, fontSize:'0.85rem' },
  qBtnActive: { background:'rgba(139,92,246,0.2)', border:'1px solid rgba(139,92,246,0.5)',
    color:'#A78BFA' },
  error: { color:'#F87171', fontSize:'0.85rem', marginBottom:'14px',
    padding:'10px 14px', background:'rgba(239,68,68,0.1)', borderRadius:'8px' },
  btn: { width:'100%', padding:'14px', borderRadius:'12px', border:'none',
    background:'linear-gradient(135deg,#3B82F6,#8B5CF6)', color:'#fff',
    fontSize:'1rem', fontWeight:800, cursor:'pointer', marginBottom:'14px',
    boxShadow:'0 8px 25px rgba(59,130,246,0.3)', transition:'transform 0.15s' },
  hint: { textAlign:'center', color:'#475569', fontSize:'0.78rem', margin:0 },
};
