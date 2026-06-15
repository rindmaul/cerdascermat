export default function Timer({ seconds, total = 30 }) {
  const pct = (seconds / total) * 100;
  const color = seconds > 10 ? '#3B82F6' : seconds > 5 ? '#F59E0B' : '#EF4444';

  return (
    <div style={S.wrap}>
      <div style={{ ...S.circle, borderColor: color }}>
        <span style={{ ...S.num, color }}>{seconds}</span>
      </div>
      <div style={S.bar}>
        <div style={{ ...S.fill, width: `${pct}%`, background: color }} />
      </div>
    </div>
  );
}

const S = {
  wrap: { display:'flex', alignItems:'center', gap:'14px', marginBottom:'18px' },
  circle: { width:'52px', height:'52px', borderRadius:'50%', border:'3px solid',
    display:'flex', alignItems:'center', justifyContent:'center', flexShrink:0,
    transition:'border-color 0.3s' },
  num: { fontSize:'1.3rem', fontWeight:900, transition:'color 0.3s' },
  bar: { flex:1, height:'8px', background:'rgba(255,255,255,0.06)', borderRadius:'4px', overflow:'hidden' },
  fill: { height:'100%', borderRadius:'4px', transition:'width 1s linear, background 0.3s' },
};
