import { useEffect, useState } from 'react';

/** Display only: extrapolates the server's elapsed time between snapshots. It never moves a topic. */
export function useLiveElapsed(snapshot: { elapsedActiveSeconds: number; status: string; revision: number } | null): number {
  const [elapsed, setElapsed] = useState(snapshot?.elapsedActiveSeconds ?? 0);
  const base = snapshot?.elapsedActiveSeconds ?? 0;
  const running = snapshot?.status === 'active';
  const revision = snapshot?.revision;

  useEffect(() => {
    setElapsed(base);
    if (!running) return undefined;
    const receivedAt = Date.now();
    const timer = setInterval(() => setElapsed(base + (Date.now() - receivedAt) / 1000), 500);
    return () => clearInterval(timer);
  }, [base, running, revision]);

  return elapsed;
}
