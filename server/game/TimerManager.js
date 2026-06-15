/**
 * TimerManager
 * Manages server-side timers for each active game.
 * All timing is authoritative on the server — client never controls this.
 */
export class TimerManager {
  constructor() {
    // Map<roomCode, { interval, timeout, startedAt, duration }>
    this.timers = new Map();
  }

  /**
   * Start a question timer.
   * @param roomCode    - unique key
   * @param durationMs  - total duration in ms (default 30s)
   * @param onTick      - called every second with remaining seconds
   * @param onExpire    - called when timer reaches 0
   */
  startTimer(roomCode, durationMs = 30000, onTick, onExpire) {
    this.clearTimer(roomCode);

    const startedAt = Date.now();
    let remaining = Math.ceil(durationMs / 1000);

    // Tick every second
    const interval = setInterval(() => {
      remaining--;
      if (onTick) onTick(remaining);
      if (remaining <= 0) {
        this.clearTimer(roomCode);
        if (onExpire) onExpire();
      }
    }, 1000);

    this.timers.set(roomCode, { interval, startedAt, durationMs });
  }

  /**
   * Cancel timer for a room.
   */
  clearTimer(roomCode) {
    const t = this.timers.get(roomCode);
    if (t) {
      clearInterval(t.interval);
      this.timers.delete(roomCode);
    }
  }

  /**
   * How many ms have elapsed since the timer started.
   */
  elapsed(roomCode) {
    const t = this.timers.get(roomCode);
    if (!t) return 0;
    return Date.now() - t.startedAt;
  }

  /**
   * Clear all timers (on server shutdown).
   */
  clearAll() {
    for (const [code] of this.timers) {
      this.clearTimer(code);
    }
  }
}
