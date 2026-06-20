import { io } from 'socket.io-client';

const URL = import.meta.env.VITE_BACKEND_URL || 'http://localhost:4000';

export const socket = io(URL, {
  autoConnect: false,
  transports: ['websocket', 'polling'],
  reconnection: true,
  reconnectionAttempts: 10,
  reconnectionDelay: 1000,
  reconnectionDelayMax: 5000,
  timeout: 10_000,
});

// Session token persistence
// Pakai sessionStorage (bukan localStorage) supaya tiap TAB browser punya
// identitas/session sendiri-sendiri. localStorage dibagikan ke semua tab
// di origin yang sama, jadi kalau dipakai untuk testing multi-pemain di
// satu browser, token pemain bisa saling menimpa dan socket "tertukar".
export function saveSession(token, playerId, roomCode = null) {
  sessionStorage.setItem('cc_session', token);
  sessionStorage.setItem('cc_player', playerId);
  if (roomCode) sessionStorage.setItem('cc_room', roomCode);
}

export function loadSession() {
  return {
    sessionToken: sessionStorage.getItem('cc_session'),
    playerId: sessionStorage.getItem('cc_player'),
    roomCode: sessionStorage.getItem('cc_room'),
  };
}

export function clearSession() {
  sessionStorage.removeItem('cc_session');
  sessionStorage.removeItem('cc_player');
  sessionStorage.removeItem('cc_room');
}

// Generic emit with callback (promisified)
export function emitAsync(event, data, timeoutMs = 8000) {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error(`Timeout: ${event}`)), timeoutMs);
    socket.emit(event, data, (response) => {
      clearTimeout(timer);
      resolve(response);
    });
  });
}
