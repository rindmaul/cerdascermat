import { useState, useEffect, useRef, useCallback } from 'react';
import { useNavigate, useParams, useLocation } from 'react-router-dom';
import { socket, loadSession } from '../socket/socket';
import Timer from '../components/Timer';
import QuestionCard from '../components/QuestionCard';
import Leaderboard from '../components/Leaderboard';
import ScoreAnimation from '../components/ScoreAnimation';

// Simpan game state ke sessionStorage supaya reload bisa recover
function saveGameState(code, data) {
  sessionStorage.setItem(`game_${code}`, JSON.stringify(data));
}
function loadGameState(code) {
  const raw = sessionStorage.getItem(`game_${code}`);
  return raw ? JSON.parse(raw) : null;
}

export default function Game() {
  const { code } = useParams();
  const location = useLocation();
  const nav = useNavigate();
  const savedState = loadGameState(code);
  
  const { isHost, playerId, rejoined } = location.state ?? savedState ?? {};
  if (location.state?.playerId) {
    sessionStorage.setItem(`game_${code}`, JSON.stringify(location.state));
  }

// Simpan ke sessionStorage supaya reload bisa recover
  if (location.state?.playerId) {
    sessionStorage.setItem(`game_${code}`, JSON.stringify(location.state));
  }

  const [phase, setPhase]           = useState('waiting');   // waiting | question | result | finished
  const [question, setQuestion]     = useState(null);
  const [qNo, setQNo]               = useState(0);
  const [total, setTotal]           = useState(0);
  const [timer, setTimer]           = useState(30);
  const [selected, setSelected]     = useState(null);         // chosen index
  const [answered, setAnswered]     = useState(false);
  const [feedback, setFeedback]     = useState(null);         // { isCorrect, points, rank, correctIdx }
  const [resultData, setResultData] = useState(null);
  const [leaderboard, setLeaderboard] = useState([]);
  const [scoreAnim, setScoreAnim]   = useState(null);
  const [isSpectator] = useState(false); // could be passed via state
  const questionStartRef = useRef(null);

useEffect(() => {
  if (!playerId) return;

  function onGameStarted({ totalQuestions }) {
    setTotal(totalQuestions);
    setPhase('waiting');
  }

  function onQuestionStart({ no, total, question, duration }) {
  setQuestion(question);
  setQNo(no);
  setTotal(total);
  setSelected(null);
  setAnswered(false);
  setFeedback(null);
  setResultData(null);
  setPhase('question');
  setTimer(Math.round(duration / 1000)); // langsung 30, tanpa elapsed
  questionStartRef.current = Date.now();
  }

  function onTimerTick({ remaining }) {
    setTimer(remaining);
  }

  function onAnswerResult(data) {
    setFeedback(data);
    setAnswered(true);
    if (data.points > 0) {
      setScoreAnim({ points: data.points, rank: data.rank });
      setTimeout(() => setScoreAnim(null), 1800);
    }
  }

  function onQuestionEnd(data) {
    setResultData(data);
    setPhase('result');
  }

  function onLeaderboardUpdate({ leaderboard }) {
    setLeaderboard(leaderboard);
  }

  function onGameFinished({ leaderboard, gameId }) {
    nav(`/result/${code}`, { state: { leaderboard, gameId, playerId } });
  }

  socket.on('game-started', onGameStarted);
  socket.on('question-start', onQuestionStart);
  socket.on('timer-tick', onTimerTick);
  socket.on('answer-result', onAnswerResult);
  socket.on('question-end', onQuestionEnd);
  socket.on('leaderboard-update', onLeaderboardUpdate);
  socket.on('game-finished', onGameFinished);

  // Reconnect jika reload
  const { sessionToken } = loadSession();
  if (!socket.connected) socket.connect();
  socket.emit('join-room', { code, playerName: '', sessionToken }, (res) => {
    if (res?.ok && res.state?.status === 'playing') {
      socket.emit('get-current-question', {}, (data) => {
        if (data?.question) {
          setQuestion(data.question);
          setQNo(data.no);
          setTotal(data.total);
          setTimer(data.remaining);
          setPhase('question');
        }
      });
    }
  });

  return () => {
    socket.off('game-started', onGameStarted);
    socket.off('question-start', onQuestionStart);
    socket.off('timer-tick', onTimerTick);
    socket.off('answer-result', onAnswerResult);
    socket.off('question-end', onQuestionEnd);
    socket.off('leaderboard-update', onLeaderboardUpdate);
    socket.off('game-finished', onGameFinished);
  };
}, [code, playerId, nav]);

  const handleAnswer = useCallback((idx) => {
    if (answered || isSpectator || phase !== 'question') return;
    setSelected(idx);
    socket.emit('submit-answer', { chosenIdx: idx });
  }, [answered, isSpectator, phase]);

  return (
  <div className="game-layout">
    <div className="game-main">
        {/* Progress */}
        <div style={S.progress}>
          <span style={S.progressText}>Soal {qNo}/{total}</span>
          <div style={S.progressBar}>
            <div style={{ ...S.progressFill, width: `${total > 0 ? (qNo/total)*100 : 0}%` }} />
          </div>
          <span style={S.roomCode}>#{code}</span>
        </div>

        {/* Timer */}
        {phase === 'question' && <Timer seconds={timer} total={30} />}

        {/* Question */}
        {phase === 'question' && question && (
          <QuestionCard
            question={question}
            selected={selected}
            answered={answered}
            feedback={feedback}
            onAnswer={handleAnswer}
            isSpectator={isSpectator}
          />
        )}

        {/* Per-question result */}
        {phase === 'result' && resultData && (
          <div style={S.resultCard}>
            <div style={S.resultTitle}>Soal {resultData.no} Selesai</div>
            <div style={S.correctAnswer}>
              Jawaban Benar: <strong style={{ color:'#4ADE80' }}>{resultData.correctLabel}</strong>
            </div>

            {resultData.fastestCorrect.length > 0 && (
              <div style={S.rankList}>
                <p style={S.rankTitle}>⚡ Ranking Tercepat</p>
                {resultData.fastestCorrect.map((r) => (
                  <div key={r.rank} style={S.rankRow}>
                    <span style={S.rankNum}>#{r.rank}</span>
                    <span style={S.rankName}>{r.name}</span>
                    <span style={S.rankPts}>+{r.points}</span>
                    <span style={S.rankMs}>{(r.ms/1000).toFixed(1)}s</span>
                  </div>
                ))}
              </div>
            )}

            {/* Personal feedback */}
            {feedback && (
              <div style={{ ...S.myFeedback, borderColor: feedback.isCorrect ? 'rgba(74,222,128,0.4)' : 'rgba(248,113,113,0.3)' }}>
                {feedback.isCorrect
                  ? `✨ Benar! +${feedback.points} poin (Ranking #${feedback.rank})`
                  : '❌ Salah. Tetap semangat!'}
              </div>
            )}

            <div style={S.nextHint}>⏳ Soal berikutnya dalam beberapa detik…</div>
          </div>
        )}

        {phase === 'waiting' && (
          <div style={S.waiting}>
            <div style={S.waitSpinner} />
            <p style={{ color:'#64748B' }}>Menunggu soal pertama…</p>
          </div>
        )}

        {/* Spectator badge */}
        {isSpectator && (
          <div style={S.specBadge}>👀 Mode Penonton</div>
        )}
      {/* Mobile leaderboard */}
      <div className="mobile-lb">
        <Leaderboard entries={leaderboard} myId={playerId} />
      </div>

      </div>

      {/* Desktop sidebar leaderboard */}
      <div className="game-sidebar">
        <Leaderboard entries={leaderboard} myId={playerId} />
      </div>

      {/* Score animation overlay */}
      {scoreAnim && <ScoreAnimation points={scoreAnim.points} rank={scoreAnim.rank} />}
    </div>
  );
}

const S = {
  page: { display:'flex', minHeight:'100vh', background:'#0a0e1a',
    fontFamily:'system-ui,sans-serif', gap:'0' },
  main: { flex:1, padding:'20px', maxWidth:'700px', margin:'0 auto', position:'relative' },
  sidebar: { width:'280px', flexShrink:0, padding:'16px 16px 16px 0',
    '@media(max-width:768px)': { display:'none' } },
  progress: { display:'flex', alignItems:'center', gap:'12px', marginBottom:'16px' },
  progressText: { color:'#64748B', fontSize:'0.82rem', fontWeight:700, whiteSpace:'nowrap' },
  progressBar: { flex:1, height:'6px', background:'rgba(255,255,255,0.06)', borderRadius:'3px',
    overflow:'hidden' },
  progressFill: { height:'100%', background:'linear-gradient(90deg,#3B82F6,#8B5CF6)',
    borderRadius:'3px', transition:'width 0.4s ease' },
  roomCode: { color:'#475569', fontSize:'0.75rem', fontWeight:700 },
  resultCard: { background:'rgba(15,23,42,0.95)', borderRadius:'16px',
    border:'1px solid rgba(255,255,255,0.08)', padding:'24px' },
  resultTitle: { color:'#94A3B8', fontSize:'0.8rem', fontWeight:700,
    textTransform:'uppercase', letterSpacing:'0.1em', marginBottom:'12px' },
  correctAnswer: { fontSize:'1.1rem', color:'#CBD5E1', marginBottom:'20px' },
  rankList: { marginBottom:'16px' },
  rankTitle: { color:'#F9A8D4', fontWeight:700, fontSize:'0.82rem',
    textTransform:'uppercase', margin:'0 0 10px' },
  rankRow: { display:'flex', alignItems:'center', gap:'10px', padding:'8px 0',
    borderBottom:'1px solid rgba(255,255,255,0.04)' },
  rankNum: { color:'#64748B', fontWeight:700, width:'28px', fontSize:'0.82rem' },
  rankName: { flex:1, color:'#CBD5E1', fontWeight:600, fontSize:'0.9rem' },
  rankPts: { color:'#4ADE80', fontWeight:800, fontSize:'0.9rem' },
  rankMs: { color:'#475569', fontSize:'0.78rem', width:'36px', textAlign:'right' },
  myFeedback: { padding:'12px 16px', borderRadius:'10px',
    border:'1px solid rgba(255,255,255,0.1)',
    background:'rgba(255,255,255,0.04)', color:'#CBD5E1',
    fontSize:'0.9rem', fontWeight:600, marginBottom:'14px' },
  nextHint: { color:'#475569', fontSize:'0.8rem', textAlign:'center' },
  waiting: { display:'flex', flexDirection:'column', alignItems:'center',
    justifyContent:'center', minHeight:'300px', gap:'16px' },
  waitSpinner: { width:'40px', height:'40px', border:'4px solid rgba(255,255,255,0.1)',
    borderTopColor:'#3B82F6', borderRadius:'50%',
    animation:'spin 0.8s linear infinite' },
  specBadge: { position:'fixed', bottom:'16px', right:'16px',
    background:'rgba(139,92,246,0.2)', border:'1px solid rgba(139,92,246,0.4)',
    color:'#A78BFA', padding:'8px 16px', borderRadius:'20px', fontWeight:700,
    fontSize:'0.82rem' },
};
