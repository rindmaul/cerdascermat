const LABELS = ['A','B','C','D'];
const OPT_COLORS = ['#3B82F6','#8B5CF6','#10B981','#F59E0B'];

export default function QuestionCard({ question, selected, answered, feedback, onAnswer, isSpectator }) {
  if (!question) return null;
  const isTF = question.type === 'tf';

  function optStyle(idx) {
    let bg = 'rgba(255,255,255,0.04)';
    let border = 'rgba(255,255,255,0.08)';
    let color = '#CBD5E1';
    if (selected === idx && !answered) {
      bg = `rgba(${OPT_COLORS[idx].replace('#','').match(/.{2}/g).map(x=>parseInt(x,16)).join(',')},0.2)`;
      border = OPT_COLORS[idx];
      color = '#EDF2FF';
    }
    if (answered && feedback) {
      if (idx === feedback.correctIdx) { bg='rgba(74,222,128,0.12)'; border='rgba(74,222,128,0.5)'; color='#4ADE80'; }
      else if (idx === selected && !feedback.isCorrect) { bg='rgba(248,113,113,0.12)'; border='rgba(248,113,113,0.4)'; color='#F87171'; }
    }
    return { ...S.opt, background:bg, borderColor:border, color, cursor: answered||isSpectator?'default':'pointer' };
  }

  const tfOpts = [
    { label:'✅ BENAR', idx:0 },
    { label:'❌ SALAH', idx:1 },
  ];

  return (
    <div style={S.card}>
      <div style={S.catBadge}>{question.cat}</div>
      <p style={S.qText}>{question.q}</p>
      <div className={isTF ? 'tf-grid' : 'mc-grid'}>
        {isTF
          ? tfOpts.map(({ label, idx }) => (
              <button key={idx} style={optStyle(idx)} onClick={() => !answered && !isSpectator && onAnswer(idx)}>
                <span style={S.label}>{label}</span>
              </button>
            ))
          : (question.opts ?? []).map((opt, idx) => (
              <button key={idx} style={optStyle(idx)} onClick={() => !answered && !isSpectator && onAnswer(idx)}>
                <span style={{ ...S.optLabel, background: OPT_COLORS[idx] }}>{LABELS[idx]}</span>
                <span style={S.optText}>{opt}</span>
              </button>
            ))
        }
      </div>
      {isSpectator && <p style={S.spec}>👀 Mode Penonton — tidak bisa menjawab</p>}
    </div>
  );
}

const S = {
  card: { background:'rgba(15,23,42,0.95)', borderRadius:'16px',
    border:'1px solid rgba(255,255,255,0.08)', padding:'24px', marginBottom:'16px' },
  catBadge: { display:'inline-block', padding:'4px 10px', borderRadius:'6px',
    background:'rgba(139,92,246,0.15)', border:'1px solid rgba(139,92,246,0.3)',
    color:'#A78BFA', fontSize:'0.72rem', fontWeight:700, textTransform:'uppercase',
    letterSpacing:'0.1em', marginBottom:'14px' },
  qText: { fontSize:'1.1rem', color:'#EDF2FF', fontWeight:600, lineHeight:1.55,
    marginBottom:'20px', margin:'0 0 20px' },
  mcGrid: { display:'grid', gridTemplateColumns:'1fr 1fr', gap:'10px' },
  tfGrid: { display:'grid', gridTemplateColumns:'1fr 1fr', gap:'10px' },
  opt: { display:'flex', alignItems:'center', gap:'12px', padding:'14px 16px',
    border:'1px solid', borderRadius:'12px', textAlign:'left',
    transition:'all 0.15s', background:'transparent' },
  optLabel: { width:'26px', height:'26px', borderRadius:'6px', display:'flex',
    alignItems:'center', justifyContent:'center', fontWeight:900, fontSize:'0.85rem',
    color:'#fff', flexShrink:0 },
  optText: { fontSize:'0.88rem', fontWeight:600, lineHeight:1.35 },
  label: { fontSize:'1rem', fontWeight:800 },
  spec: { color:'#475569', fontSize:'0.78rem', textAlign:'center', margin:'14px 0 0',
    padding:'8px', background:'rgba(255,255,255,0.03)', borderRadius:'8px' },
};
