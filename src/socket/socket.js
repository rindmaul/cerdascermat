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
export function saveSession(token, playerId) {
  localStorage.setItem('cc_session', token);
  localStorage.setItem('cc_player', playerId);
}

export function loadSession() {
  return {
    sessionToken: localStorage.getItem('cc_session'),
    playerId: localStorage.getItem('cc_player'),
  };
}

export function clearSession() {
  localStorage.removeItem('cc_session');
  localStorage.removeItem('cc_player');
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
