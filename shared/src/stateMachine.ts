import type { SessionStatus } from './types';

/** Every permitted session transition. "ended" is terminal: there is no way back. */
export const SESSION_TRANSITIONS: Record<SessionStatus, readonly SessionStatus[]> = {
  created: ['active', 'ended'],
  active: ['paused', 'ended'],
  paused: ['active', 'ended'],
  ended: [],
};

export function canTransition(from: SessionStatus, to: SessionStatus): boolean {
  return SESSION_TRANSITIONS[from].includes(to);
}

export function canChangeTopic(status: SessionStatus): boolean {
  return status === 'active' || status === 'paused';
}
