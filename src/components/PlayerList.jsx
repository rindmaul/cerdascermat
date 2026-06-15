export default function PlayerList({ players = [], myId }) {
  return (
    <div style={S.card}>
      <p style={S.title}>👥 Pemain ({players.length})</p>
      <div style={S.list}>
        {players.map((p) => (
          <div key={p.id} style={{
            ...S.row,
            opacity: p.connected === false ? 0.4 : 1,
            border: p.id === myId ? '1px solid rgba(59,130,246,0.4)' : '1px solid rgba(255,255,255,0.05)',
            background: p.id === myId ? 'rgba(59,130,246,0.08)' : 'rgba(255,255,255,0.03)',
          }}>
            <div style={S.avatar}>{p.name[0]?.toUpperCase()}</div>
            <span style={S.name}>{p.name} {p.id === myId ? '(Kamu)' : ''}</span>
            <span style={{ ...S.dot, background: p.connected !== false ? '#4ADE80' : '#6B7280' }} />
          </div>
        ))}
        {players.length === 0 && <p style={S.empty}>Belum ada pemain</p>}
      </div>
    </div>
  );
}

const S = {
  card: { background:'rgba(15,23,42,0.95)', border:'1px solid rgba(255,255,255,0.08)',
    borderRadius:'14px', padding:'16px', marginBottom:'16px' },
  title: { color:'#94A3B8', fontSize:'0.72rem', fontWeight:700, textTransform:'uppercase',
    letterSpacing:'0.1em', margin:'0 0 12px' },
  list: { display:'flex', flexDirection:'column', gap:'6px', maxHeight:'220px', overflowY:'auto' },
  row: { display:'flex', alignItems:'center', gap:'10px', padding:'10px 12px',
    borderRadius:'10px', transition:'all 0.15s' },
  avatar: { width:'32px', height:'32px', borderRadius:'50%',
    background:'rgba(139,92,246,0.2)', border:'1px solid rgba(139,92,246,0.3)',
    display:'flex', alignItems:'center', justifyContent:'center',
    fontWeight:900, color:'#A78BFA', fontSize:'0.9rem', flexShrink:0 },
  name: { flex:1, color:'#CBD5E1', fontWeight:600, fontSize:'0.88rem' },
  dot: { width:'8px', height:'8px', borderRadius:'50%', flexShrink:0 },
  empty: { color:'#475569', fontSize:'0.82rem', textAlign:'center', padding:'16px 0', margin:0 },
};
