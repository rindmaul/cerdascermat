const MEDALS = ['🥇','🥈','🥉'];

export default function Leaderboard({ entries = [], myId }) {
  return (
    <div style={S.card}>
      <p style={S.title}>🏆 Leaderboard</p>
      {entries.length === 0
        ? <p style={S.empty}>Belum ada skor</p>
        : entries.slice(0, 15).map((p, i) => (
            <div key={p.id} style={{
              ...S.row,
              background: p.id === myId ? 'rgba(59,130,246,0.12)' : 'transparent',
              border: p.id === myId ? '1px solid rgba(59,130,246,0.3)' : '1px solid transparent',
            }}>
              <span style={S.rank}>{MEDALS[i] ?? `#${p.rank}`}</span>
              <span style={S.name} title={p.name}>{p.name}</span>
              <span style={S.score}>{p.score}</span>
            </div>
          ))
      }
    </div>
  );
}

const S = {
  card: { background:'rgba(15,23,42,0.95)', border:'1px solid rgba(255,255,255,0.08)',
    borderRadius:'16px', padding:'16px', position:'sticky', top:'16px' },
  title: { color:'#94A3B8', fontSize:'0.72rem', fontWeight:700, textTransform:'uppercase',
    letterSpacing:'0.1em', margin:'0 0 12px' },
  empty: { color:'#475569', fontSize:'0.82rem', textAlign:'center', padding:'20px 0', margin:0 },
  row: { display:'flex', alignItems:'center', gap:'8px', padding:'8px 8px',
    borderRadius:'8px', marginBottom:'3px', transition:'background 0.2s' },
  rank: { width:'26px', fontSize:'0.9rem', textAlign:'center', flexShrink:0 },
  name: { flex:1, color:'#CBD5E1', fontWeight:600, fontSize:'0.82rem',
    overflow:'hidden', textOverflow:'ellipsis', whiteSpace:'nowrap' },
  score: { color:'#EDF2FF', fontWeight:900, fontSize:'0.9rem', flexShrink:0 },
};
