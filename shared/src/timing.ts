export interface ElapsedState {
  elapsedActiveSeconds: number;
  /** Epoch milliseconds of the current running stretch, or null when not running. */
  activeSinceMs: number | null;
}

export function computeElapsedSeconds(state: ElapsedState, nowMs: number): number {
  if (state.activeSinceMs === null) return state.elapsedActiveSeconds;
  return state.elapsedActiveSeconds + Math.max(0, nowMs - state.activeSinceMs) / 1000;
}

export interface TimerState {
  currentTopicIndex: number;
  topicStartedElapsedSeconds: number;
  durationsSeconds: readonly number[];
}

export interface TimerAdvance {
  toIndex: number;
  topicStartedElapsedSeconds: number;
}

/**
 * Which topic changes are due at this elapsed time. Each topic runs for its own configured duration
 * from the moment it became current, so a manual jump restarts the clock for the topic jumped to.
 * More than one advance is returned only when catching up (for example after a server restart).
 * The final topic never advances; the session stays on it until the teacher ends the lesson.
 */
export function computeTimerAdvances(state: TimerState, elapsedSeconds: number): TimerAdvance[] {
  const advances: TimerAdvance[] = [];
  let index = state.currentTopicIndex;
  let startedAt = state.topicStartedElapsedSeconds;
  while (index < state.durationsSeconds.length - 1) {
    const endsAt = startedAt + (state.durationsSeconds[index] ?? 0);
    if (elapsedSeconds + 1e-6 < endsAt) break;
    index += 1;
    startedAt = endsAt;
    advances.push({ toIndex: index, topicStartedElapsedSeconds: startedAt });
  }
  return advances;
}

/** Seconds until the next automatic advance, or null if there is none (final topic). */
export function secondsUntilNextAdvance(state: TimerState, elapsedSeconds: number): number | null {
  if (state.currentTopicIndex >= state.durationsSeconds.length - 1) return null;
  const endsAt = state.topicStartedElapsedSeconds + (state.durationsSeconds[state.currentTopicIndex] ?? 0);
  return Math.max(0, endsAt - elapsedSeconds);
}

export function formatClock(totalSeconds: number): string {
  const seconds = Math.max(0, Math.floor(totalSeconds));
  const h = Math.floor(seconds / 3600);
  const m = Math.floor((seconds % 3600) / 60);
  const s = seconds % 60;
  const pad = (n: number) => String(n).padStart(2, '0');
  return h > 0 ? `${h}:${pad(m)}:${pad(s)}` : `${pad(m)}:${pad(s)}`;
}
