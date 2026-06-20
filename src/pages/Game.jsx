import { useState, useEffect, useRef, useCallback, useMemo } from 'react';
import { useNavigate, useParams, useLocation } from 'react-router-dom';
import { socket, loadSession, saveSession } from '../socket/socket';
import Timer from '../components/Timer';
import Leaderboard from '../components/Leaderboard';
import ScoreAnimation from '../components/ScoreAnimation';

const LABELS = ['A', 'B', 'C', 'D'];
const OPT_COLORS = ['#3B82F6', '#8B5CF6', '#10B981', '#F59E0B'];
const ROLE_LABELS = {
  moderator: 'Moderator',
  team1: 'Tim 1',
  team2: 'Tim 2',
};

function saveGameState(code, data) {
  sessionStorage.setItem(`game_${code}`, JSON.stringify(data));
}

function loadGameState(code) {
  const raw = sessionStorage.getItem(`game_${code}`);
  return raw ? JSON.parse(raw) : null;
}

function isTeamRole(role) {
  return role === 'team1' || role === 'team2';
}

function defaultTimerForMode(gameMode) {
  return gameMode === 'team' ? 120 : 30;
}

function answerLabel(question, idx) {
  if (idx === null || idx === undefined || Number.isNaN(idx)) return '-';
  if (question?.type === 'tf') return idx === 0 ? 'BENAR' : 'SALAH';
  return LABELS[idx] ?? '-';
}

function optionText(question, idx) {
  if (question?.type === 'tf') return idx === 0 ? 'BENAR' : 'SALAH';
  return question?.opts?.[idx] ?? '';
}

function fullSpeechText(question) {
  if (!question) return '';
  if (question.type === 'tf') {
    return `${question.q}. Jawab benar atau salah.`;
  }
  const choices = (question.opts ?? [])
    .map((opt, idx) => `Pilihan ${LABELS[idx]}, ${opt}.`)
    .join(' ');
  return `${question.q}. ${choices}`;
}

function questionSpeechText(question) {
  if (!question) return '';
  return question.q;
}

function answerSpeechText(question) {
  if (!question) return '';
  if (question.type === 'tf') return 'Pilihan jawaban: benar atau salah.';
  const choices = (question.opts ?? [])
    .map((opt, idx) => `Pilihan ${LABELS[idx]}, ${opt}.`)
    .join(' ');
  return `Pilihan jawaban. ${choices}`;
}

function findIndonesianVoice(voices = []) {
  return voices.find((voice) => {
    const lang = voice.lang?.toLowerCase() ?? '';
    const name = voice.name?.toLowerCase() ?? '';
    return lang.startsWith('id') || name.includes('indonesia') || name.includes('bahasa');
  });
}

function speakIndonesian(text, voices) {
  if (typeof window === 'undefined' || !window.speechSynthesis || !text) return false;
  const idVoice = findIndonesianVoice(voices);
  if (!idVoice) return false;

  const synth = window.speechSynthesis;
  synth.cancel();

  const utter = new SpeechSynthesisUtterance(text);
  utter.lang = idVoice.lang || 'id-ID';
  utter.voice = idVoice;
  utter.rate = 0.95;
  utter.pitch = 1;

  synth.speak(utter);
  return true;
}

function speakQuestion(question, voices) {
  return speakIndonesian(fullSpeechText(question), voices);
}

function QuestionPanel({ question, interactive, selectedIdx, feedback, revealCorrect, onSelect }) {
  if (!question) return null;
  const optionIndexes = question.type === 'tf' ? [0, 1] : (question.opts ?? []).map((_, idx) => idx);

  function optStyle(idx) {
    let bg = 'rgba(255,255,255,0.04)';
    let border = 'rgba(255,255,255,0.08)';
    let color = '#CBD5E1';

    if (selectedIdx === idx && interactive) {
      bg = `rgba(${OPT_COLORS[idx].replace('#', '').match(/.{2}/g).map(x => parseInt(x, 16)).join(',')},0.2)`;
      border = OPT_COLORS[idx];
      color = '#EDF2FF';
    }

    if (feedback?.chosenIdx === idx && !feedback.isCorrect) {
      bg = 'rgba(248,113,113,0.12)';
      border = 'rgba(248,113,113,0.4)';
      color = '#F87171';
    }

    if (revealCorrect && feedback?.correctIdx === idx) {
      bg = 'rgba(74,222,128,0.12)';
      border = 'rgba(74,222,128,0.5)';
      color = '#4ADE80';
    }

    return {
      ...S.opt,
      background: bg,
      borderColor: border,
      color,
      cursor: interactive ? 'pointer' : 'default',
      opacity: interactive ? 1 : 0.92,
    };
  }

  return (
    <div style={S.questionCard}>
      <div style={S.catBadge}>{question.cat}</div>
      <p style={S.qText}>{question.q}</p>
      <div className={question.type === 'tf' ? 'tf-grid' : 'mc-grid'}>
        {optionIndexes.map((idx) => (
          <button
            key={idx}
            type="button"
            style={optStyle(idx)}
            disabled={!interactive}
            onClick={() => interactive && onSelect?.(idx)}
          >
            <span style={{ ...S.optLabel, background: OPT_COLORS[idx] }}>
              {question.type === 'tf' ? (idx === 0 ? 'B' : 'S') : answerLabel(question, idx)}
            </span>
            <span style={S.optText}>{optionText(question, idx)}</span>
          </button>
        ))}
      </div>
    </div>
  );
}

export default function Game() {
  const { code } = useParams();
  const location = useLocation();
  const nav = useNavigate();
  const savedState = loadGameState(code);
  const initialState = location.state ?? savedState ?? {};
  const initialGameMode = initialState.gameMode
    ?? initialState.state?.gameMode
    ?? (initialState.players?.some((p) => p.role) ? 'team' : 'classic');

  const { isHost = false, playerId } = initialState;
  const [players, setPlayers] = useState(initialState.players ?? initialState.state?.players ?? []);
  const [gameMode, setGameMode] = useState(initialGameMode);
  const [phase, setPhase] = useState('waiting');
  const [question, setQuestion] = useState(null);
  const [qNo, setQNo] = useState(0);
  const [total, setTotal] = useState(0);
  const [timer, setTimer] = useState(defaultTimerForMode(initialGameMode));
  const [timerTotal, setTimerTotal] = useState(defaultTimerForMode(initialGameMode));
  const [currentBuzz, setCurrentBuzz] = useState(null);
  const [attemptedIds, setAttemptedIds] = useState([]);
  const [lastAttempt, setLastAttempt] = useState(null);
  const [classicAnswered, setClassicAnswered] = useState(false);
  const [classicFeedback, setClassicFeedback] = useState(null);
  const [resultData, setResultData] = useState(null);
  const [leaderboard, setLeaderboard] = useState([]);
  const [scoreAnim, setScoreAnim] = useState(null);
  const [selectedIdx, setSelectedIdx] = useState(null);
  const [busy, setBusy] = useState(false);
  const [actionError, setActionError] = useState('');
  const [voiceWarning, setVoiceWarning] = useState('');
  const [voices, setVoices] = useState([]);
  const spokenRef = useRef('');

  useEffect(() => {
    if (location.state?.playerId) {
      saveGameState(code, location.state);
    }
  }, [code, location.state]);

  const myPlayer = useMemo(
    () => players.find((p) => p.id === playerId),
    [players, playerId]
  );
  const myRole = myPlayer?.role ?? null;
  const isTeamMode = gameMode === 'team';
  const roleLabel = isTeamMode
    ? (ROLE_LABELS[myRole] ?? (myPlayer?.isSpectator ? 'Penonton' : 'Belum ada role'))
    : 'Mode: Klasik';
  const isModerator = myRole === 'moderator';
  const isTeam = isTeamMode && isTeamRole(myRole);
  const hasAttempted = attemptedIds.includes(playerId);
  const isMyBuzz = currentBuzz?.playerId === playerId;

  useEffect(() => {
    if (!playerId) {
      nav('/');
    }
  }, [playerId, nav]);

  useEffect(() => {
    if (typeof window === 'undefined' || !window.speechSynthesis) return;
    const synth = window.speechSynthesis;
    const updateVoices = () => setVoices(synth.getVoices?.() ?? []);

    updateVoices();
    synth.addEventListener?.('voiceschanged', updateVoices);
    synth.onvoiceschanged = updateVoices;

    return () => {
      synth.removeEventListener?.('voiceschanged', updateVoices);
      if (synth.onvoiceschanged === updateVoices) synth.onvoiceschanged = null;
    };
  }, []);

  useEffect(() => {
    if (!isTeamMode || !isModerator || phase !== 'question' || !question) return;
    const key = `${qNo}:${question.q}`;
    if (spokenRef.current === key) return;
    const ok = speakQuestion(question, voices);
    if (!ok) {
      setVoiceWarning('Suara Bahasa Indonesia tidak tersedia di browser moderator.');
      return;
    }
    setVoiceWarning('');
    spokenRef.current = key;
  }, [isModerator, isTeamMode, phase, qNo, question, voices]);

  useEffect(() => {
    return () => {
      if (typeof window !== 'undefined' && window.speechSynthesis) {
        window.speechSynthesis.cancel();
      }
    };
  }, []);

  useEffect(() => {
    if (!playerId) return;

    function isCurrentRoomEvent(data) {
      return !data?.roomCode || data.roomCode === code;
    }

    function mergePlayer(nextPlayer) {
      setPlayers(prev => {
        if (prev.find(p => p.id === nextPlayer.id)) {
          return prev.map(p => p.id === nextPlayer.id ? { ...p, ...nextPlayer, connected: true } : p);
        }
        return [...prev, { ...nextPlayer, connected: true }];
      });
    }

    function onGameStarted(data = {}) {
      if (!isCurrentRoomEvent(data)) return;
      setTotal(data.totalQuestions ?? 0);
      setGameMode(data.gameMode ?? 'classic');
      if (data.players) setPlayers(data.players);
      setPhase('waiting');
    }

    function onQuestionStart(data = {}) {
      if (!isCurrentRoomEvent(data)) return;
      setQuestion(data.question);
      setQNo(data.no);
      setTotal(data.total);
      setGameMode(data.gameMode ?? 'classic');
      setTimerTotal(Math.round(data.duration / 1000));
      setTimer(Math.round(data.duration / 1000));
      setCurrentBuzz(data.currentBuzz ?? null);
      setAttemptedIds(data.attemptedPlayerIds ?? []);
      setLastAttempt(null);
      setClassicAnswered(false);
      setClassicFeedback(null);
      setResultData(null);
      setSelectedIdx(null);
      setBusy(false);
      setActionError('');
      setVoiceWarning('');
      setPhase('question');
    }

    function onTimerTick(data = {}) {
      if (!isCurrentRoomEvent(data)) return;
      setTimer(data.remaining);
    }

    function onBuzzLocked(data = {}) {
      if (!isCurrentRoomEvent(data)) return;
      setCurrentBuzz(data);
      setAttemptedIds(data.attemptedPlayerIds ?? []);
      setActionError('');
    }

    function onBuzzOpen(data = {}) {
      if (!isCurrentRoomEvent(data)) return;
      setCurrentBuzz(null);
      setAttemptedIds(data.attemptedPlayerIds ?? []);
      if (data.lastAttempt) setLastAttempt(data.lastAttempt);
      setSelectedIdx(null);
    }

    function onAnswerResult(data = {}) {
      if (!isCurrentRoomEvent(data)) return;
      if (!data.teamRole) {
        setClassicFeedback(data);
        setClassicAnswered(true);
        setBusy(false);
        if (data.points > 0) {
          setScoreAnim({ points: data.points, rank: data.rank ?? 1 });
          setTimeout(() => setScoreAnim(null), 1800);
        }
        return;
      }

      setLastAttempt(data);
      setAttemptedIds(data.attemptedPlayerIds ?? []);
      if (data.points > 0) {
        setScoreAnim({ points: data.points, rank: data.rank ?? 1 });
        setTimeout(() => setScoreAnim(null), 1800);
      }
    }

    function onQuestionEnd(data = {}) {
      if (!isCurrentRoomEvent(data)) return;
      setResultData(data);
      setCurrentBuzz(null);
      setAttemptedIds([]);
      setSelectedIdx(null);
      setClassicAnswered(false);
      setPhase('result');
    }

    function onLeaderboardUpdate(data = {}) {
      if (!isCurrentRoomEvent(data)) return;
      setLeaderboard(data.leaderboard ?? []);
    }

    function onGameFinished(data = {}) {
      if (!isCurrentRoomEvent(data)) return;
      const { leaderboard, gameId } = data;
      nav(`/result/${code}`, { state: { leaderboard, gameId, playerId } });
    }

    function onGameCancelled(data = {}) {
      if (!isCurrentRoomEvent(data)) return;
      nav('/');
    }

    function onPlayerJoined({ player }) {
      mergePlayer(player);
    }

    function onPlayerLeft({ playerId: leftPlayerId }) {
      setPlayers(prev => prev.map(p => p.id === leftPlayerId ? { ...p, connected: false } : p));
    }

    socket.on('game-started', onGameStarted);
    socket.on('question-start', onQuestionStart);
    socket.on('timer-tick', onTimerTick);
    socket.on('buzz-locked', onBuzzLocked);
    socket.on('buzz-open', onBuzzOpen);
    socket.on('answer-result', onAnswerResult);
    socket.on('question-end', onQuestionEnd);
    socket.on('leaderboard-update', onLeaderboardUpdate);
    socket.on('game-finished', onGameFinished);
    socket.on('game-cancelled', onGameCancelled);
    socket.on('player-joined', onPlayerJoined);
    socket.on('player-left', onPlayerLeft);

    function doJoinRoom() {
      const { sessionToken } = loadSession();
      if (!sessionToken) {
        nav('/');
        return;
      }
      socket.emit('join-room', { code, playerName: '', sessionToken }, (res) => {
        if (!res?.ok) return;
        saveSession(res.sessionToken, res.playerId, code);
        setGameMode(res.state?.gameMode ?? 'classic');
        if (res.state?.players) setPlayers(res.state.players);
        if (res.state?.status === 'playing') {
          socket.emit('get-current-question', {}, (data) => {
            if (data?.question && isCurrentRoomEvent(data)) {
              setQuestion(data.question);
              setQNo(data.no);
              setTotal(data.total);
              setGameMode(data.gameMode ?? res.state?.gameMode ?? 'classic');
              setTimerTotal(Math.round((data.duration ?? 120_000) / 1000));
              setTimer(data.remaining);
              setCurrentBuzz(data.currentBuzz ?? null);
              setAttemptedIds(data.attemptedPlayerIds ?? []);
              setLastAttempt(data.lastAttempt ?? null);
              setPhase('question');
            }
          });
        }
      });
    }

    socket.on('connect', doJoinRoom);

    if (!socket.connected) {
      socket.connect();
    } else {
      doJoinRoom();
    }

    return () => {
      socket.off('connect', doJoinRoom);
      socket.off('game-started', onGameStarted);
      socket.off('question-start', onQuestionStart);
      socket.off('timer-tick', onTimerTick);
      socket.off('buzz-locked', onBuzzLocked);
      socket.off('buzz-open', onBuzzOpen);
      socket.off('answer-result', onAnswerResult);
      socket.off('question-end', onQuestionEnd);
      socket.off('leaderboard-update', onLeaderboardUpdate);
      socket.off('game-finished', onGameFinished);
      socket.off('game-cancelled', onGameCancelled);
      socket.off('player-joined', onPlayerJoined);
      socket.off('player-left', onPlayerLeft);
    };
  }, [code, playerId, nav]);

  const handleBuzz = useCallback(() => {
    if (!isTeam || phase !== 'question' || currentBuzz || hasAttempted || busy) return;
    setBusy(true);
    setActionError('');
    socket.emit('buzz-in', {}, (res) => {
      setBusy(false);
      if (!res?.ok) setActionError(res?.error ?? 'Gagal menekan tombol');
    });
  }, [isTeam, phase, currentBuzz, hasAttempted, busy]);

  const handleModeratorAnswer = useCallback((idx) => {
    if (!isModerator || !currentBuzz || phase !== 'question' || busy) return;
    setSelectedIdx(idx);
    setBusy(true);
    setActionError('');
    socket.emit('moderator-submit-answer', { chosenIdx: idx }, (res) => {
      setBusy(false);
      if (!res?.ok) {
        setActionError(res?.error ?? 'Gagal menyimpan jawaban');
        setSelectedIdx(null);
      }
    });
  }, [isModerator, currentBuzz, phase, busy]);

  const handleClassicAnswer = useCallback((idx) => {
    if (isTeamMode || myPlayer?.isSpectator || classicAnswered || phase !== 'question' || busy) return;
    setSelectedIdx(idx);
    setBusy(true);
    setActionError('');
    socket.emit('submit-answer', { chosenIdx: idx });
  }, [busy, classicAnswered, isTeamMode, myPlayer?.isSpectator, phase]);

  const handleReadQuestion = useCallback(() => {
    if (!isModerator || !question) return;
    const ok = speakIndonesian(questionSpeechText(question), voices);
    setVoiceWarning(ok ? '' : 'Suara Bahasa Indonesia tidak tersedia di browser moderator.');
  }, [isModerator, question, voices]);

  const handleReadAnswers = useCallback(() => {
    if (!isModerator || !question) return;
    const ok = speakIndonesian(answerSpeechText(question), voices);
    setVoiceWarning(ok ? '' : 'Suara Bahasa Indonesia tidak tersedia di browser moderator.');
  }, [isModerator, question, voices]);

  const handleSkipQuestion = useCallback(() => {
    if (!isModerator || phase !== 'question' || busy) return;
    setBusy(true);
    setActionError('');
    socket.emit('moderator-skip-question', {}, (res) => {
      setBusy(false);
      if (!res?.ok) setActionError(res?.error ?? 'Gagal skip soal');
    });
  }, [busy, isModerator, phase]);

  const visibleAttempt = resultData?.lastAttempt ?? lastAttempt;
  const revealCorrect = phase === 'result';
  const teamQuestionFeedback = revealCorrect && resultData
    ? { chosenIdx: visibleAttempt?.chosenIdx, isCorrect: visibleAttempt?.isCorrect, correctIdx: resultData.correctIdx }
    : lastAttempt;
  const classicQuestionFeedback = revealCorrect && resultData
    ? { chosenIdx: classicFeedback?.chosenIdx, isCorrect: classicFeedback?.isCorrect ?? true, correctIdx: resultData.correctIdx }
    : classicFeedback;

  return (
    <div className="game-layout">
      <div className="game-main">
        <div style={S.progress}>
          <span style={S.progressText}>Soal {qNo}/{total}</span>
          <div style={S.progressBar}>
            <div style={{ ...S.progressFill, width: `${total > 0 ? (qNo / total) * 100 : 0}%` }} />
          </div>
          <span style={S.roomCode}>#{code}</span>
        </div>

        <div style={S.roleBar}>
          <span style={S.roleText}>{isTeamMode ? `Role: ${roleLabel}` : roleLabel}</span>
          {isHost && <span style={S.hostBadge}>Host</span>}
        </div>

        {phase === 'question' && <Timer seconds={timer} total={timerTotal} />}

        {phase === 'question' && isTeamMode && isTeam && (
          <div style={S.teamStage}>
            <div style={S.teamStatus}>
              <p style={S.controlTitle}>{ROLE_LABELS[myRole]}</p>
              <p style={S.teamStatusText}>
                {isMyBuzz
                  ? 'Giliran tim kamu menjawab.'
                  : currentBuzz
                    ? `${currentBuzz.teamName} mendapat giliran.`
                    : hasAttempted
                      ? 'Tim kamu sudah mencoba soal ini.'
                      : 'Tekan tombol paling cepat untuk mendapat giliran.'}
              </p>
            </div>
            <button
              type="button"
              style={{
                ...S.buzzBtn,
                opacity: (!currentBuzz && !hasAttempted && !busy) || isMyBuzz ? 1 : 0.48,
              }}
              disabled={Boolean(currentBuzz) || hasAttempted || busy}
              onClick={handleBuzz}
            >
              {isMyBuzz ? 'GILIRAN TIM KAMU' : hasAttempted ? 'SUDAH MENCOBA' : busy ? 'MENGIRIM...' : 'TEKAN TOMBOL'}
            </button>
            <p style={S.controlHelp}>
              {isMyBuzz
                ? 'Ucapkan jawabanmu. Moderator akan memilih opsi yang kamu sebutkan.'
                : currentBuzz
                  ? 'Tunggu moderator menilai jawaban.'
                  : hasAttempted
                    ? 'Tunggu soal berikutnya atau hasil dari moderator.'
                    : 'Tombol akan terkunci untuk tim yang paling dulu sampai ke server.'}
            </p>
          </div>
        )}

        {phase === 'question' && isTeamMode && !isModerator && !isTeam && (
          <div style={S.controlCard}>
            <p style={S.controlTitle}>Menunggu Role</p>
            <p style={S.controlHelp}>Role kamu belum bisa dipakai untuk menjawab soal ini.</p>
          </div>
        )}

        {phase === 'question' && question && (!isTeamMode || isModerator) && (
          <>
            <QuestionPanel
              question={question}
              interactive={isTeamMode
                ? isModerator && Boolean(currentBuzz) && !busy
                : !myPlayer?.isSpectator && !classicAnswered && !busy}
              selectedIdx={selectedIdx}
              feedback={isTeamMode ? teamQuestionFeedback : classicQuestionFeedback}
              revealCorrect={!isTeamMode && classicAnswered}
              onSelect={isTeamMode ? handleModeratorAnswer : handleClassicAnswer}
            />

            {isTeamMode && isModerator && (
              <div style={S.controlCard}>
                <p style={S.controlTitle}>Panel Moderator</p>
                <div style={S.voiceActions}>
                  <button type="button" style={S.voiceBtn} onClick={handleReadQuestion}>
                    Bacakan Soal
                  </button>
                  <button type="button" style={S.voiceBtn} onClick={handleReadAnswers}>
                    Bacakan Pilihan
                  </button>
                  <button
                    type="button"
                    style={{ ...S.skipBtn, opacity: busy ? 0.55 : 1 }}
                    disabled={busy}
                    onClick={handleSkipQuestion}
                  >
                    Skip Soal
                  </button>
                </div>
                {currentBuzz ? (
                  <>
                    <p style={S.controlMain}>
                      Giliran {ROLE_LABELS[currentBuzz.teamRole] ?? 'Tim'} - {currentBuzz.teamName}
                    </p>
                    <p style={S.controlHelp}>
                      Setelah tim menyebut jawaban, klik opsi yang mereka pilih di kartu soal.
                    </p>
                  </>
                ) : (
                  <p style={S.controlHelp}>Menunggu Tim 1 atau Tim 2 menekan tombol.</p>
                )}
              </div>
            )}

            {isTeamMode && isModerator && voiceWarning && (
              <div style={S.voiceWarning}>{voiceWarning}</div>
            )}

            {!isTeamMode && classicAnswered && classicFeedback && (
              <div style={{
                ...S.attemptNotice,
                ...(classicFeedback.isCorrect ? S.attemptCorrect : S.attemptWrong),
              }}>
                <span style={S.attemptTeam}>{classicFeedback.isCorrect ? 'Benar' : 'Salah'}</span>
                <span style={S.attemptText}>
                  {classicFeedback.isCorrect
                    ? `+${classicFeedback.points} poin.`
                    : 'Tunggu soal berikutnya.'}
                </span>
              </div>
            )}

            {isTeamMode && lastAttempt && (
              <AttemptNotice attempt={lastAttempt} question={question} />
            )}
          </>
        )}

        {phase === 'result' && resultData && isTeamMode && isTeam && (
          <div style={S.teamStage}>
            <div style={S.teamStatus}>
              <p style={S.controlTitle}>Soal {resultData.no} Selesai</p>
              <p style={S.teamStatusText}>
                {resultData.skipped && !visibleAttempt
                  ? 'Moderator melewati soal ini.'
                  : visibleAttempt
                  ? `${visibleAttempt.teamName} ${visibleAttempt.isCorrect ? 'menjawab benar' : 'menjawab salah'}.`
                  : 'Tidak ada tim yang menjawab benar.'}
              </p>
              <p style={S.controlHelp}>Menunggu soal berikutnya...</p>
            </div>
          </div>
        )}

        {phase === 'result' && resultData && question && (!isTeamMode || isModerator) && (
          <div style={S.resultCard}>
            <div style={S.resultTitle}>Soal {resultData.no} Selesai</div>
            <QuestionPanel
              question={question}
              interactive={false}
              selectedIdx={null}
              feedback={isTeamMode ? teamQuestionFeedback : classicQuestionFeedback}
              revealCorrect
            />
            <div style={S.correctAnswer}>
              Jawaban Benar: <strong style={{ color:'#4ADE80' }}>{resultData.correctLabel}</strong>
            </div>

            {isTeamMode ? (
              resultData.skipped && !visibleAttempt ? (
                <div style={S.emptyResult}>Soal ini dilewati oleh moderator.</div>
              ) : visibleAttempt ? (
                <AttemptNotice attempt={visibleAttempt} question={question} compact />
              ) : (
                <div style={S.emptyResult}>Tidak ada tim yang menjawab benar pada soal ini.</div>
              )
            ) : resultData.fastestCorrect?.length > 0 ? (
              <div style={S.rankList}>
                <p style={S.rankTitle}>Ranking Tercepat</p>
                {resultData.fastestCorrect.map((r) => (
                  <div key={`${r.rank}-${r.name}`} style={S.rankRow}>
                    <span style={S.rankNum}>#{r.rank}</span>
                    <span style={S.rankName}>{r.name}</span>
                    <span style={S.rankPts}>+{r.points}</span>
                    <span style={S.rankMs}>{(r.ms / 1000).toFixed(1)}s</span>
                  </div>
                ))}
              </div>
            ) : (
              <div style={S.emptyResult}>Belum ada jawaban benar pada soal ini.</div>
            )}

            <div style={S.nextHint}>Soal berikutnya dalam beberapa detik...</div>
          </div>
        )}

        {phase === 'waiting' && (
          <div style={S.waiting}>
            <div style={S.waitSpinner} />
            <p style={{ color:'#64748B' }}>Menunggu soal pertama...</p>
          </div>
        )}

        {actionError && <div style={S.error}>{actionError}</div>}

        <div className="mobile-lb">
          <Leaderboard entries={leaderboard} myId={playerId} />
        </div>
      </div>

      <div className="game-sidebar">
        <Leaderboard entries={leaderboard} myId={playerId} />
      </div>

      {scoreAnim && <ScoreAnimation points={scoreAnim.points} rank={scoreAnim.rank} />}
    </div>
  );
}

function AttemptNotice({ attempt, question, compact = false }) {
  return (
    <div style={{
      ...S.attemptNotice,
      ...(attempt.isCorrect ? S.attemptCorrect : S.attemptWrong),
      ...(compact ? { marginBottom:'14px' } : {}),
    }}>
      <span style={S.attemptTeam}>{ROLE_LABELS[attempt.teamRole] ?? 'Tim'} - {attempt.teamName}</span>
      <span style={S.attemptText}>
        memilih {answerLabel(question, attempt.chosenIdx)}. {attempt.isCorrect ? `Benar, +${attempt.points} poin.` : 'Salah.'}
      </span>
    </div>
  );
}

const S = {
  progress: { display:'flex', alignItems:'center', gap:'12px', marginBottom:'12px' },
  progressText: { color:'#64748B', fontSize:'0.82rem', fontWeight:700, whiteSpace:'nowrap' },
  progressBar: { flex:1, height:'6px', background:'rgba(255,255,255,0.06)', borderRadius:'3px',
    overflow:'hidden' },
  progressFill: { height:'100%', background:'linear-gradient(90deg,#3B82F6,#10B981)',
    borderRadius:'3px', transition:'width 0.4s ease' },
  roomCode: { color:'#475569', fontSize:'0.75rem', fontWeight:700 },
  roleBar: { display:'flex', alignItems:'center', justifyContent:'space-between',
    gap:'10px', background:'rgba(15,23,42,0.78)', border:'1px solid rgba(255,255,255,0.08)',
    borderRadius:'10px', padding:'10px 12px', marginBottom:'14px' },
  roleText: { color:'#CBD5E1', fontWeight:800, fontSize:'0.85rem' },
  hostBadge: { color:'#FBBF24', background:'rgba(251,191,36,0.12)',
    border:'1px solid rgba(251,191,36,0.25)', borderRadius:'999px',
    padding:'4px 8px', fontSize:'0.7rem', fontWeight:900 },
  questionCard: { background:'rgba(15,23,42,0.95)', borderRadius:'14px',
    border:'1px solid rgba(255,255,255,0.08)', padding:'20px', marginBottom:'14px' },
  catBadge: { display:'inline-block', padding:'4px 10px', borderRadius:'6px',
    background:'rgba(16,185,129,0.12)', border:'1px solid rgba(16,185,129,0.28)',
    color:'#6EE7B7', fontSize:'0.72rem', fontWeight:800, textTransform:'uppercase',
    letterSpacing:'0.08em', marginBottom:'14px' },
  qText: { fontSize:'1.08rem', color:'#EDF2FF', fontWeight:650, lineHeight:1.55,
    margin:'0 0 18px' },
  opt: { display:'flex', alignItems:'center', gap:'12px', minHeight:'56px',
    padding:'13px 14px', border:'1px solid', borderRadius:'10px', textAlign:'left',
    transition:'all 0.15s' },
  optLabel: { minWidth:'30px', height:'28px', borderRadius:'7px', display:'flex',
    alignItems:'center', justifyContent:'center', fontWeight:900, fontSize:'0.78rem',
    color:'#fff', flexShrink:0, padding:'0 7px' },
  optText: { fontSize:'0.88rem', fontWeight:650, lineHeight:1.35 },
  controlCard: { background:'rgba(15,23,42,0.95)', border:'1px solid rgba(255,255,255,0.08)',
    borderRadius:'14px', padding:'18px', marginBottom:'14px' },
  controlTitle: { color:'#94A3B8', fontSize:'0.72rem', fontWeight:800, textTransform:'uppercase',
    letterSpacing:'0.1em', margin:'0 0 10px' },
  controlMain: { color:'#EDF2FF', fontSize:'1rem', fontWeight:900, margin:'0 0 6px' },
  controlHelp: { color:'#64748B', fontSize:'0.86rem', lineHeight:1.45, margin:0 },
  teamStage: { background:'rgba(15,23,42,0.95)', border:'1px solid rgba(255,255,255,0.08)',
    borderRadius:'14px', padding:'18px', marginBottom:'16px', display:'flex',
    flexDirection:'column', gap:'14px' },
  teamStatus: { minHeight:'86px', display:'flex', flexDirection:'column',
    justifyContent:'center', gap:'8px' },
  teamStatusText: { color:'#EDF2FF', fontSize:'1rem', fontWeight:900,
    lineHeight:1.45, margin:0 },
  voiceActions: { display:'grid', gridTemplateColumns:'repeat(auto-fit,minmax(120px,1fr))', gap:'10px',
    margin:'0 0 14px' },
  voiceBtn: { minHeight:'44px', border:'1px solid rgba(59,130,246,0.35)',
    borderRadius:'10px', background:'rgba(59,130,246,0.12)', color:'#93C5FD',
    fontSize:'0.84rem', fontWeight:900, cursor:'pointer' },
  skipBtn: { minHeight:'44px', border:'1px solid rgba(245,158,11,0.36)',
    borderRadius:'10px', background:'rgba(245,158,11,0.12)', color:'#FBBF24',
    fontSize:'0.84rem', fontWeight:900, cursor:'pointer' },
  voiceWarning: { background:'rgba(245,158,11,0.1)', border:'1px solid rgba(245,158,11,0.28)',
    color:'#FBBF24', borderRadius:'10px', padding:'10px 12px', marginBottom:'14px',
    fontSize:'0.82rem', fontWeight:700, lineHeight:1.4 },
  buzzBtn: { width:'100%', minHeight:'112px', border:'none', borderRadius:'14px',
    background:'linear-gradient(135deg,#F97316,#EF4444)', color:'#fff',
    fontSize:'1.15rem', fontWeight:950, cursor:'pointer',
    marginBottom:'0', boxShadow:'0 14px 35px rgba(239,68,68,0.24)',
    letterSpacing:'0.03em', overflowWrap:'anywhere' },
  attemptNotice: { display:'flex', alignItems:'center', gap:'8px', flexWrap:'wrap',
    borderRadius:'12px', padding:'12px 14px', marginBottom:'14px',
    border:'1px solid rgba(255,255,255,0.1)' },
  attemptCorrect: { background:'rgba(34,197,94,0.12)', borderColor:'rgba(34,197,94,0.32)' },
  attemptWrong: { background:'rgba(239,68,68,0.11)', borderColor:'rgba(239,68,68,0.28)' },
  attemptTeam: { color:'#EDF2FF', fontWeight:900, fontSize:'0.86rem' },
  attemptText: { color:'#CBD5E1', fontWeight:650, fontSize:'0.86rem' },
  resultCard: { marginBottom:'16px' },
  resultTitle: { color:'#94A3B8', fontSize:'0.78rem', fontWeight:800,
    textTransform:'uppercase', letterSpacing:'0.1em', marginBottom:'12px' },
  correctAnswer: { fontSize:'1rem', color:'#CBD5E1', marginBottom:'14px' },
  rankList: { marginBottom:'14px' },
  rankTitle: { color:'#94A3B8', fontWeight:800, fontSize:'0.76rem',
    textTransform:'uppercase', letterSpacing:'0.08em', margin:'0 0 8px' },
  rankRow: { display:'flex', alignItems:'center', gap:'10px', padding:'8px 0',
    borderBottom:'1px solid rgba(255,255,255,0.05)' },
  rankNum: { color:'#64748B', fontWeight:800, width:'30px', fontSize:'0.82rem' },
  rankName: { flex:1, color:'#CBD5E1', fontWeight:700, fontSize:'0.9rem',
    overflow:'hidden', textOverflow:'ellipsis', whiteSpace:'nowrap' },
  rankPts: { color:'#4ADE80', fontWeight:900, fontSize:'0.9rem' },
  rankMs: { color:'#64748B', fontSize:'0.78rem', width:'44px', textAlign:'right' },
  emptyResult: { padding:'12px 14px', borderRadius:'10px',
    background:'rgba(255,255,255,0.04)', border:'1px solid rgba(255,255,255,0.08)',
    color:'#94A3B8', fontSize:'0.86rem', marginBottom:'14px' },
  nextHint: { color:'#475569', fontSize:'0.8rem', textAlign:'center' },
  waiting: { display:'flex', flexDirection:'column', alignItems:'center',
    justifyContent:'center', minHeight:'300px', gap:'16px' },
  waitSpinner: { width:'40px', height:'40px', border:'4px solid rgba(255,255,255,0.1)',
    borderTopColor:'#3B82F6', borderRadius:'50%',
    animation:'spin 0.8s linear infinite' },
  error: { position:'fixed', left:'50%', bottom:'18px', transform:'translateX(-50%)',
    maxWidth:'min(520px, calc(100vw - 32px))', background:'rgba(127,29,29,0.96)',
    border:'1px solid rgba(248,113,113,0.35)', color:'#FECACA',
    borderRadius:'10px', padding:'10px 14px', fontSize:'0.84rem', fontWeight:700,
    zIndex:20 },
};
