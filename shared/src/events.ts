import type { StudentSnapshot, TeacherSnapshot } from './types';

/**
 * Typed Socket.IO contract. Every state event carries a complete snapshot with its revision, so
 * clients never apply deltas and a single missed event cannot leave them inconsistent.
 * Students can only join and read; all changes go through authenticated REST endpoints.
 */
export const SESSION_EVENTS = {
  join: 'session:join',
  watch: 'session:watch',
  leave: 'session:leave',
  started: 'session:started',
  paused: 'session:paused',
  resumed: 'session:resumed',
  ended: 'session:ended',
  topicChanged: 'topic:changed',
  modeChanged: 'session:mode-changed',
  presence: 'session:presence',
} as const;

export type SessionStateEvent =
  | typeof SESSION_EVENTS.started
  | typeof SESSION_EVENTS.paused
  | typeof SESSION_EVENTS.resumed
  | typeof SESSION_EVENTS.ended
  | typeof SESSION_EVENTS.topicChanged
  | typeof SESSION_EVENTS.modeChanged;

export const SESSION_STATE_EVENTS: readonly SessionStateEvent[] = [
  SESSION_EVENTS.started,
  SESSION_EVENTS.paused,
  SESSION_EVENTS.resumed,
  SESSION_EVENTS.ended,
  SESSION_EVENTS.topicChanged,
  SESSION_EVENTS.modeChanged,
];

export type SocketAck<T> = { ok: true; data: T } | { ok: false; error: string };

export interface PresencePayload {
  connectedStudents: number;
}

type StateListener<S> = (snapshot: S) => void;

export interface ServerToClientEvents<S = StudentSnapshot | TeacherSnapshot> {
  'session:started': StateListener<S>;
  'session:paused': StateListener<S>;
  'session:resumed': StateListener<S>;
  'session:ended': StateListener<S>;
  'session:mode-changed': StateListener<S>;
  'topic:changed': StateListener<S>;
  'session:presence': (payload: PresencePayload) => void;
}

export interface ClientToServerEvents {
  /** Student: join by code. The acknowledgement carries the authoritative current state. */
  'session:join': (payload: { code: string }, ack: (result: SocketAck<StudentSnapshot>) => void) => void;
  /** Teacher (requires the auth cookie): watch a session. */
  'session:watch': (payload: { sessionId: string }, ack: (result: SocketAck<TeacherSnapshot>) => void) => void;
  'session:leave': () => void;
}
