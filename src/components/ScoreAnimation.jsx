import { useEffect, useState } from 'react';

export default function ScoreAnimation({ points, rank }) {
  const [visible, setVisible] = useState(true);

  useEffect(() => {
    const t = setTimeout(() => setVisible(false), 1600);
    return () => clearTimeout(t);
  }, []);

  if (!visible) return null;

  return (
    <div style={S.overlay}>
      <div style={S.box}>
        <div style={S.pts}>+{points}</div>
        {rank <= 3 && <div style={S.rank}>🏅 Ranking #{rank} Tercepat!</div>}
      </div>
    </div>
  );
}

const S = {
  overlay: { position:'fixed', top:0, left:0, right:0, bottom:0,
    display:'flex', alignItems:'center', justifyContent:'center',
    pointerEvents:'none', zIndex:1000 },
  box: { textAlign:'center', animation:'popIn 0.3s ease' },
  pts: { fontSize:'4rem', fontWeight:900, color:'#4ADE80',
    textShadow:'0 0 30px rgba(74,222,128,0.6)',
    animation:'floatUp 1.5s ease forwards' },
  rank: { color:'#F9A8D4', fontWeight:700, fontSize:'1rem', marginTop:'8px' },
};
