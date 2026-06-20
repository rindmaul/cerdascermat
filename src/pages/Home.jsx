// ini udah di patch otomatis oleh Antigravity 🚀
import { useState, useEffect, useMemo } from 'react';
import { useNavigate } from 'react-router-dom';
import { socket, emitAsync, saveSession, loadSession, clearSession } from '../socket/socket';

const BACKEND_URL = import.meta.env.VITE_BACKEND_URL || 'http://localhost:4000';

const GAME_MODES = [
  { code: 'classic', label: 'Klasik', help: 'Semua pemain menjawab sendiri-sendiri' },
  { code: 'team', label: 'Tim', help: '1 moderator dan 2 tim rebutan tombol' },
];

const CATEGORIES = [
  { code: 'ALL',  label: 'Semua',      emoji: '🌐' },
  { code: 'MTK',  label: 'Matematika', emoji: '📐' },
  { code: 'IPA',  label: 'IPA',        emoji: '🔬' },
  { code: 'IPS',  label: 'IPS',        emoji: '🌏' },
  { code: 'FIS',  label: 'Fisika',     emoji: '⚡' },
  { code: 'KIM',  label: 'Kimia',      emoji: '🧪' },
  { code: 'GEO',  label: 'Geografi',   emoji: '🗺️' },
  { code: 'SEJ',  label: 'Sejarah',    emoji: '📜' },
  { code: 'NEG',  label: 'Negara',     emoji: '🏳️' },
  { code: 'TRV',  label: 'Trivia',     emoji: '🎯' },
  { code: 'ADV',  label: 'Advanced',   emoji: '🔥' },
  { code: 'AKT',  label: 'Akuntansi',  emoji: '📊' },
  { code: 'FLM',  label: 'Film',       emoji: '🎬' },
  { code: 'HWN',  label: 'Hewan',      emoji: '🦁' },
];

const CATEGORY_ALIASES = {
  FLM: ['FLM', 'FIL'],
  HWN: ['HWN', 'HEW'],
};

function categoryCodesFor(code) {
  return CATEGORY_ALIASES[code] ?? [code];
}

function getCategoryCount(categoryCounts, code) {
  return categoryCodesFor(code).reduce((sum, cat) => sum + (categoryCounts[cat] || 0), 0);
}

function expandSelectedCategories(categories) {
  if (categories.includes('ALL')) return ['ALL'];
  return [...new Set(categories.flatMap(categoryCodesFor))];
}

/**
 * Generate pilihan jumlah soal berdasarkan total soal yang tersedia.
 * Aturan:
 *   - Mulai dari kelipatan 10: 10, 20, 30
 *   - Setelah 30, lompat ke kelipatan 50: 50, 100, 150, 200, ...
 *   - Batas atas: bulatkan ke bawah ke kelipatan 10 terdekat dari total
 *   - Jika total < 10, return array kosong
 */
function generateQuestionOptions(totalAvailable) {
  if (!totalAvailable || totalAvailable < 10) return [];

  // Batas atas: bulatkan ke bawah ke kelipatan 10
  const maxOption = Math.floor(totalAvailable / 10) * 10;
  const options = [];

  // Kelipatan 10: 10, 20, 30
  for (let n = 10; n <= 30 && n <= maxOption; n += 10) {
    options.push(n);
  }

  // Kelipatan 50: 50, 100, 150, ...
  for (let n = 50; n <= maxOption; n += 50) {
    options.push(n);
  }

  return options;
}

export default function Home() {
  const nav = useNavigate();
  const [tab, setTab] = useState('join');
  const [name, setName] = useState('');
  const [code, setCode] = useState('');
  const [gameMode, setGameMode] = useState(null);
  const [maxQ, setMaxQ] = useState(null);        // null = belum dipilih
  const [selectedCategories, setSelectedCategories] = useState([]); // array kosong = belum dipilih
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');

  // Per-category question counts from server
  const [categoryCounts, setCategoryCounts] = useState({}); // { MTK: 60, FIS: 18, ... }
  const [totalAllQuestions, setTotalAllQuestions] = useState(0);
  const [countsLoading, setCountsLoading] = useState(true);

  // Fetch question counts on mount
  useEffect(() => {
    async function fetchCounts() {
      try {
        const res = await fetch(`${BACKEND_URL}/api/questions/count-by-category`);
        const data = await res.json();
        const map = {};
        for (const row of data.categories) {
          map[row.category] = row.count;
        }
        setCategoryCounts(map);
        setTotalAllQuestions(data.total);
      } catch (e) {
        console.error('Failed to fetch question counts:', e);
      } finally {
        setCountsLoading(false);
      }
    }
    fetchCounts();
  }, []);

  // Jumlah soal tersedia untuk kategori yang dipilih
  const availableCount = useMemo(() => {
    if (selectedCategories.length === 0) return 0;
    if (selectedCategories.includes('ALL')) return totalAllQuestions;
    return selectedCategories.reduce((sum, cat) => sum + getCategoryCount(categoryCounts, cat), 0);
  }, [selectedCategories, categoryCounts, totalAllQuestions]);

  const visibleCategories = useMemo(() => (
    CATEGORIES.filter(c => c.code === 'ALL' || countsLoading || getCategoryCount(categoryCounts, c.code) > 0)
  ), [categoryCounts, countsLoading]);

  // Generate question options based on selected category
  const questionOptions = useMemo(() => {
    if (selectedCategories.length === 0) return [];
    return generateQuestionOptions(availableCount);
  }, [selectedCategories, availableCount]);

  // Reset maxQ when category changes (selected option mungkin tidak valid lagi)
  useEffect(() => {
    if (selectedCategories.length > 0 && questionOptions.length > 0) {
      // Jika maxQ saat ini tidak ada di options, pilih yang pertama
      if (!questionOptions.includes(maxQ)) {
        setMaxQ(questionOptions[0]);
      }
    } else {
      setMaxQ(null);
    }
  }, [selectedCategories, questionOptions]);

  async function handleConnect(action) {
    if (!name.trim()) return setError('Masukkan nama terlebih dahulu');
    if (action === 'join' && !code.trim()) return setError('Masukkan kode room');
    if (action === 'create' && !gameMode) return setError('Pilih mode permainan terlebih dahulu');
    if (action === 'create' && selectedCategories.length === 0) return setError('Pilih kategori terlebih dahulu');
    if (action === 'create' && !maxQ) return setError('Pilih jumlah soal terlebih dahulu');
    setError('');
    setLoading(true);

    try {
      if (!socket.connected) socket.connect();
      await new Promise((res, rej) => {
        socket.once('connect', res);
        socket.once('connect_error', rej);
        if (socket.connected) res();
      });

      const savedSession = loadSession();

      if (action === 'create') {
        const res = await emitAsync('create-room', {
          playerName: name.trim(),
          maxQuestions: maxQ,
          categories: expandSelectedCategories(selectedCategories),
          gameMode,
        });
        if (!res.ok) throw new Error(res.error);
        saveSession(res.sessionToken, res.playerId, res.code);

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
        const joinCode = code.toUpperCase().trim();
        const hasSavedRoom =
          savedSession.roomCode === joinCode ||
          Boolean(sessionStorage.getItem(`lobby_${joinCode}`)) ||
          Boolean(sessionStorage.getItem(`game_${joinCode}`));
        const sessionToken = hasSavedRoom ? savedSession.sessionToken : null;

        if (!hasSavedRoom) clearSession();

        const res = await emitAsync('join-room', {
          code: joinCode,
          playerName: name.trim(),
          sessionToken,
        });

        if (!res.ok) throw new Error(res.error);
        saveSession(res.sessionToken, res.playerId, joinCode);

        if (res.state?.status === 'playing') {
          nav(`/game/${joinCode}`, {
            state: { isHost: res.isHost, playerId: res.playerId, rejoined: true },
          });
        } else {
          nav(`/lobby/${joinCode}`, {
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
        <div style={styles.header}>
          <div style={styles.logo}>🧠</div>
          <h1 style={styles.title}>CerdasCermat</h1>
          <p style={styles.sub}>Multiplayer Quiz Realtime</p>
        </div>

        <div style={styles.tabs}>
          {['join','create'].map(t => (
            <button key={t} onClick={() => setTab(t)}
              style={{ ...styles.tab, ...(tab === t ? styles.tabActive : {}) }}>
              {t === 'join' ? '🚪 Gabung Room' : '🏠 Buat Room'}
            </button>
          ))}
        </div>

        <label style={styles.label}>Nama Kamu</label>
        <input
          style={styles.input}
          placeholder="Contoh: Budi123"
          maxLength={30}
          value={name}
          onChange={e => setName(e.target.value)}
          onKeyDown={e => e.key === 'Enter' && handleConnect(tab)}
        />

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

        {tab === 'create' && (
          <>
            {/* ── Kategori ── */}
            <label style={styles.label}>Mode Permainan</label>
            <div style={styles.modeGrid}>
              {GAME_MODES.map(mode => (
                <button
                  key={mode.code}
                  onClick={() => setGameMode(mode.code)}
                  style={{
                    ...styles.modeBtn,
                    ...(gameMode === mode.code ? styles.modeBtnActive : {}),
                  }}
                >
                  <span style={styles.modeLabel}>{mode.label}</span>
                  <span style={styles.modeHelp}>{mode.help}</span>
                </button>
              ))}
            </div>
            {!gameMode && (
              <div style={styles.selectCategoryHint}>
                Pilih mode permainan terlebih dahulu.
              </div>
            )}

            <label style={styles.label}>Kategori Pelajaran</label>
            <div style={styles.catGrid}>
              {visibleCategories.map(c => {
                const count = c.code === 'ALL'
                  ? totalAllQuestions
                  : getCategoryCount(categoryCounts, c.code);
                const isSelected = selectedCategories.includes(c.code);

                const toggleCategory = () => {
                  if (!gameMode) return;
                  if (c.code === 'ALL') {
                    setSelectedCategories(['ALL']);
                  } else {
                    setSelectedCategories(prev => {
                      let next = prev.filter(x => x !== 'ALL');
                      if (next.includes(c.code)) {
                        next = next.filter(x => x !== c.code);
                      } else {
                        next.push(c.code);
                      }
                      return next;
                    });
                  }
                };

                return (
                  <button key={c.code}
                    disabled={!gameMode}
                    onClick={toggleCategory}
                    style={{
                      ...styles.catBtn,
                      ...(!gameMode ? styles.disabledBtn : {}),
                      ...(isSelected ? styles.catBtnActive : {}),
                    }}>
                    <span style={styles.catEmoji}>{c.emoji}</span>
                    <span style={styles.catLabel}>{c.label}</span>
                    {!countsLoading && (
                      <span style={{
                        ...styles.catCount,
                        ...(isSelected ? styles.catCountActive : {}),
                      }}>
                        {count} soal
                      </span>
                    )}
                  </button>
                );
              })}
            </div>

            {/* ── Jumlah Soal (muncul setelah kategori dipilih) ── */}
            {selectedCategories.length > 0 && (
              <div style={styles.questionSection}>
                <label style={styles.label}>
                  Jumlah Soal
                  <span style={styles.availableInfo}>
                    ({availableCount} soal tersedia)
                  </span>
                </label>

                {questionOptions.length > 0 ? (
                  <div style={styles.qGrid}>
                    {questionOptions.map(n => (
                      <button key={n} onClick={() => setMaxQ(n)}
                        style={{ ...styles.qBtn, ...(maxQ === n ? styles.qBtnActive : {}) }}>
                        {n}
                      </button>
                    ))}
                  </div>
                ) : (
                  <div style={styles.noQuestions}>
                    ⚠️ Soal tidak cukup (minimal 10 soal diperlukan)
                  </div>
                )}
              </div>
            )}

            {selectedCategories.length === 0 && (
              <div style={styles.selectCategoryHint}>
                ☝️ Pilih kategori terlebih dahulu untuk melihat jumlah soal yang tersedia
              </div>
            )}
          </>
        )}

        {error && <div style={styles.error}>{error}</div>}

        <button
          style={{
            ...styles.btn,
            ...(tab === 'create' && (!gameMode || selectedCategories.length === 0 || !maxQ) ? { opacity: 0.5, cursor: 'not-allowed' } : {}),
          }}
          onClick={() => handleConnect(tab)}
          disabled={loading || (tab === 'create' && (!gameMode || selectedCategories.length === 0 || !maxQ))}
        >
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
  card: { width:'100%', maxWidth:'440px', background:'rgba(15,23,42,0.95)',
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
  label: { display:'flex', alignItems:'center', gap:'8px', color:'#94A3B8', fontSize:'0.8rem',
    fontWeight:600, marginBottom:'8px', textTransform:'uppercase', letterSpacing:'0.05em' },
  input: { width:'100%', padding:'12px 14px', borderRadius:'10px',
    border:'1px solid rgba(255,255,255,0.1)', background:'rgba(255,255,255,0.05)',
    color:'#EDF2FF', fontSize:'1rem', marginBottom:'18px', boxSizing:'border-box',
    outline:'none', fontFamily:'inherit' },
  modeGrid: { display:'grid', gridTemplateColumns:'1fr 1fr', gap:'8px', marginBottom:'20px' },
  modeBtn: { minHeight:'86px', padding:'12px', border:'1px solid rgba(255,255,255,0.1)',
    borderRadius:'10px', background:'transparent', color:'#64748B', cursor:'pointer',
    display:'flex', flexDirection:'column', justifyContent:'center', gap:'6px',
    textAlign:'left', transition:'all 0.2s' },
  modeBtnActive: { background:'rgba(16,185,129,0.12)', border:'1px solid rgba(16,185,129,0.42)',
    color:'#6EE7B7' },
  modeLabel: { color:'inherit', fontSize:'0.9rem', fontWeight:900 },
  modeHelp: { color:'#94A3B8', fontSize:'0.72rem', lineHeight:1.35, fontWeight:600 },
  catGrid: { display:'grid', gridTemplateColumns:'repeat(3,1fr)', gap:'8px', marginBottom:'20px' },
  catBtn: { padding:'10px 6px', border:'1px solid rgba(255,255,255,0.1)', borderRadius:'10px',
    background:'transparent', color:'#64748B', cursor:'pointer', fontWeight:600,
    fontSize:'0.78rem', display:'flex', flexDirection:'column', alignItems:'center', gap:'4px',
    transition:'all 0.2s' },
  disabledBtn: { opacity:0.45, cursor:'not-allowed' },
  catBtnActive: { background:'rgba(59,130,246,0.15)', border:'1px solid rgba(59,130,246,0.4)',
    color:'#60A5FA' },
  catEmoji: { fontSize:'1.2rem' },
  catLabel: { fontSize:'0.72rem', fontWeight:700 },
  catCount: { fontSize:'0.62rem', color:'#475569', fontWeight:500 },
  catCountActive: { color:'#60A5FA' },
  questionSection: {
    animation: 'fadeSlideIn 0.3s ease-out',
  },
  availableInfo: {
    fontSize:'0.72rem', color:'#60A5FA', fontWeight:500, textTransform:'none',
    letterSpacing:'normal',
  },
  qGrid: { display:'grid', gridTemplateColumns:'repeat(5,1fr)', gap:'8px', marginBottom:'20px' },
  qBtn: { padding:'10px 0', border:'1px solid rgba(255,255,255,0.1)', borderRadius:'8px',
    background:'transparent', color:'#64748B', cursor:'pointer', fontWeight:700, fontSize:'0.8rem',
    transition:'all 0.2s' },
  qBtnActive: { background:'rgba(139,92,246,0.2)', border:'1px solid rgba(139,92,246,0.5)',
    color:'#A78BFA' },
  noQuestions: {
    padding:'12px 16px', borderRadius:'10px',
    background:'rgba(245,158,11,0.1)', border:'1px solid rgba(245,158,11,0.3)',
    color:'#F59E0B', fontSize:'0.82rem', fontWeight:600, marginBottom:'20px',
    textAlign:'center',
  },
  selectCategoryHint: {
    padding:'14px 16px', borderRadius:'10px',
    background:'rgba(59,130,246,0.06)', border:'1px dashed rgba(59,130,246,0.25)',
    color:'#64748B', fontSize:'0.82rem', fontWeight:500, marginBottom:'20px',
    textAlign:'center',
  },
  error: { color:'#F87171', fontSize:'0.85rem', marginBottom:'14px',
    padding:'10px 14px', background:'rgba(239,68,68,0.1)', borderRadius:'8px' },
  btn: { width:'100%', padding:'14px', borderRadius:'12px', border:'none',
    background:'linear-gradient(135deg,#3B82F6,#8B5CF6)', color:'#fff',
    fontSize:'1rem', fontWeight:800, cursor:'pointer', marginBottom:'14px',
    boxShadow:'0 8px 25px rgba(59,130,246,0.3)', transition:'transform 0.15s' },
  hint: { textAlign:'center', color:'#475569', fontSize:'0.78rem', margin:0 },
};
