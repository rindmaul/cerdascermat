import { useLocation, useNavigate } from 'react-router-dom';
import { socket } from '../socket/socket';

const MEDALS = ['🥇','🥈','🥉'];
const RANK_COLORS = ['#F5C518','#94A3B8','#CD7C3A'];

export default function Result() {
  const location = useLocation();
  const nav = useNavigate();
  const { leaderboard = [], playerId } = location.state ?? {};

  const myResult = leaderboard.find(p => p.id === playerId);

  return (
    <div style={S.page}>
      <div style={S.container}>
        <div style={S.header}>
          <div style={S.trophy}>🏆</div>
          <h1 style={S.title}>Game Selesai!</h1>
        </div>

        {/* Top 3 Podium */}
        {leaderboard.length >= 3 && (
          <div style={S.podium}>
            {/* 2nd */}
            <div style={{ ...S.podiumSlot, marginTop:'30px' }}>
              <div style={S.podiumAvatar}>{leaderboard[1]?.name[0]?.toUpperCase()}</div>
              <div style={{ ...S.podiumMedal, color: RANK_COLORS[1] }}>🥈</div>
              <div style={S.podiumName}>{leaderboard[1]?.name}</div>
              <div style={{ ...S.podiumScore, color: RANK_COLORS[1] }}>{leaderboard[1]?.score}</div>
            </div>
            {/* 1st */}
            <div style={S.podiumSlot}>
              <div style={{ ...S.podiumAvatar, background:'rgba(245,197,24,0.2)', border:'2px solid rgba(245,197,24,0.6)', transform:'scale(1.1)' }}>
                {leaderboard[0]?.name[0]?.toUpperCase()}
              </div>
              <div style={{ ...S.podiumMedal, color: RANK_COLORS[0] }}>🥇</div>
              <div style={S.podiumName}>{leaderboard[0]?.name}</div>
              <div style={{ ...S.podiumScore, color: RANK_COLORS[0] }}>{leaderboard[0]?.score}</div>
            </div>
            {/* 3rd */}
            <div style={{ ...S.podiumSlot, marginTop:'55px' }}>
              <div style={S.podiumAvatar}>{leaderboard[2]?.name[0]?.toUpperCase()}</div>
              <div style={{ ...S.podiumMedal, color: RANK_COLORS[2] }}>🥉</div>
              <div style={S.podiumName}>{leaderboard[2]?.name}</div>
              <div style={{ ...S.podiumScore, color: RANK_COLORS[2] }}>{leaderboard[2]?.score}</div>
            </div>
          </div>
        )}

        {/* My Result */}
        {myResult && (
          <div style={S.myResult}>
            <p style={S.myResultLabel}>Hasil Kamu</p>
            <div style={S.myGrid}>
              <div style={S.myStat}><span style={S.myN}>#{myResult.rank}</span><span style={S.myL}>Peringkat</span></div>
              <div style={S.myStat}><span style={S.myN}>{myResult.score}</span><span style={S.myL}>Poin</span></div>
              <div style={S.myStat}><span style={S.myN}>{myResult.accuracy}%</span><span style={S.myL}>Akurasi</span></div>
              <div style={S.myStat}><span style={S.myN}>{(myResult.avgMs/1000).toFixed(1)}s</span><span style={S.myL}>Rata-rata</span></div>
            </div>
          </div>
        )}

        {/* Full Leaderboard */}
        <div style={S.lbCard}>
          <p style={S.lbTitle}>Final Leaderboard</p>
          {leaderboard.map((p, i) => (
            <div key={p.id} style={{
              ...S.lbRow,
              background: p.id === playerId ? 'rgba(59,130,246,0.1)' : 'transparent',
              border: p.id === playerId ? '1px solid rgba(59,130,246,0.3)' : '1px solid transparent',
            }}>
              <span style={{ ...S.lbRank, color: RANK_COLORS[i] ?? '#475569' }}>
                {MEDALS[i] ?? `#${p.rank}`}
              </span>
              <span style={S.lbName}>{p.name}</span>
              <div style={S.lbStats}>
                <span style={S.lbPts}>{p.score}pts</span>
                <span style={S.lbAcc}>{p.accuracy}%</span>
                <span style={S.lbCorrect}>{p.correct}✓</span>
              </div>
            </div>
          ))}
        </div>

        <div style={S.actions}>
          <button style={S.homeBtn} onClick={() => {
            socket.disconnect();
            nav('/');
          }}>🏠 Kembali ke Menu</button>
        </div>
      </div>
    </div>
  );
}

const S = {
  page: { minHeight:'100vh', background:'#0a0e1a', padding:'20px',
    fontFamily:'system-ui,sans-serif', display:'flex', justifyContent:'center' },
  container: { width:'100%', maxWidth:'500px' },
  header: { textAlign:'center', padding:'20px 0 10px' },
  trophy: { fontSize:'3rem', marginBottom:'8px' },
  title: { fontSize:'1.8rem', fontWeight:900, color:'#EDF2FF', margin:0 },
  podium: { display:'flex', alignItems:'flex-end', justifyContent:'center',
    gap:'12px', marginBottom:'24px', padding:'20px 0' },
  podiumSlot: { display:'flex', flexDirection:'column', alignItems:'center', gap:'6px' },
  podiumAvatar: { width:'52px', height:'52px', borderRadius:'50%',
    background:'rgba(255,255,255,0.08)', border:'2px solid rgba(255,255,255,0.15)',
    display:'flex', alignItems:'center', justifyContent:'center',
    fontSize:'1.4rem', fontWeight:900, color:'#EDF2FF' },
  podiumMedal: { fontSize:'1.5rem' },
  podiumName: { color:'#CBD5E1', fontWeight:700, fontSize:'0.82rem', textAlign:'center', maxWidth:'80px',
    overflow:'hidden', textOverflow:'ellipsis', whiteSpace:'nowrap' },
  podiumScore: { fontWeight:900, fontSize:'1rem' },
  myResult: { background:'rgba(59,130,246,0.08)', border:'1px solid rgba(59,130,246,0.3)',
    borderRadius:'14px', padding:'18px', marginBottom:'16px' },
  myResultLabel: { color:'#60A5FA', fontSize:'0.75rem', fontWeight:700, textTransform:'uppercase',
    margin:'0 0 12px', letterSpacing:'0.1em' },
  myGrid: { display:'grid', gridTemplateColumns:'repeat(4,1fr)', gap:'8px' },
  myStat: { display:'flex', flexDirection:'column', gap:'3px', textAlign:'center' },
  myN: { fontSize:'1.3rem', fontWeight:900, color:'#EDF2FF' },
  myL: { fontSize:'0.68rem', color:'#64748B', textTransform:'uppercase', fontWeight:600 },
  lbCard: { background:'rgba(15,23,42,0.95)', borderRadius:'14px',
    border:'1px solid rgba(255,255,255,0.08)', padding:'16px', marginBottom:'16px' },
  lbTitle: { color:'#94A3B8', fontSize:'0.75rem', fontWeight:700, textTransform:'uppercase',
    letterSpacing:'0.1em', margin:'0 0 12px' },
  lbRow: { display:'flex', alignItems:'center', gap:'10px', padding:'10px 10px',
    borderRadius:'8px', marginBottom:'4px', transition:'all 0.15s' },
  lbRank: { width:'32px', fontSize:'1rem', textAlign:'center' },
  lbName: { flex:1, color:'#CBD5E1', fontWeight:600, fontSize:'0.9rem' },
  lbStats: { display:'flex', gap:'10px', alignItems:'center' },
  lbPts: { color:'#EDF2FF', fontWeight:800, fontSize:'0.88rem' },
  lbAcc: { color:'#64748B', fontSize:'0.78rem' },
  lbCorrect: { color:'#4ADE80', fontSize:'0.78rem' },
  actions: { display:'flex', gap:'10px', marginBottom:'30px' },
  homeBtn: { flex:1, padding:'14px', border:'none', borderRadius:'12px',
    background:'linear-gradient(135deg,#3B82F6,#8B5CF6)', color:'#fff',
    fontSize:'1rem', fontWeight:800, cursor:'pointer' },
};
