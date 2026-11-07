import { useCallback, useEffect, useState } from 'react';
import { io, type Socket } from 'socket.io-client';
import {
  newerSnapshot,
  SESSION_EVENTS,
  SESSION_STATE_EVENTS,
  type ClientToServerEvents,
  type ServerToClientEvents,
  type SocketAck,
  type StudentSnapshot,
  type TeacherSnapshot,
} from '@classroom/shared';

export type ConnectionState = 'connecting' | 'synced' | 'disconnected';

type AnySocket = Socket<ServerToClientEvents<never>, ClientToServerEvents>;

/**
 * One subscription to a session. "synced" is only reported after the server has acknowledged the
 * join with its current state, so the UI can never claim to be in sync while it is not.
 * Reconnecting re-joins, which returns the authoritative state and repairs anything missed.
 */
function useChannel<S extends { revision: number }>(
  key: string | undefined,
  join: (socket: AnySocket, ack: (result: SocketAck<S>) => void) => void,
  onPresence?: (connectedStudents: number) => void,
  onAccepted?: (snapshot: S) => void,
) {
  const [snapshot, setSnapshot] = useState<S | null>(null);
  const [connection, setConnection] = useState<ConnectionState>('connecting');
  const [joinError, setJoinError] = useState<string | null>(null);

  const accept = useCallback(
    (incoming: S) => {
      setSnapshot((current) => newerSnapshot(current, incoming));
      onAccepted?.(incoming);
    },
    [onAccepted],
  );

  useEffect(() => {
    if (!key) return undefined;
    setSnapshot(null);
    setConnection('connecting');
    setJoinError(null);

    const socket: AnySocket = io({ withCredentials: true, reconnectionDelayMax: 4000 });

    socket.on('connect', () => {
      join(socket, (result) => {
        if (result.ok) {
          accept(result.data);
          setConnection('synced');
          setJoinError(null);
        } else {
          setJoinError(result.error);
        }
      });
    });
    socket.on('disconnect', (reason) => {
      setConnection('disconnected');
      if (reason === 'io server disconnect') socket.connect();
    });
    socket.on('connect_error', () => setConnection('disconnected'));

    const listen = socket as unknown as Socket<ServerToClientEvents<S>, ClientToServerEvents>;
    for (const event of SESSION_STATE_EVENTS) listen.on(event, accept as never);
    listen.on(SESSION_EVENTS.presence, ({ connectedStudents }) => onPresence?.(connectedStudents));

    return () => {
      socket.close();
    };
    // `join` and the callbacks are stable for a given key.
  }, [key]);

  return { snapshot, connection, joinError, accept };
}

export function useStudentSession(code: string | undefined) {
  const join = useCallback(
    (socket: AnySocket, ack: (result: SocketAck<StudentSnapshot>) => void) => {
      socket.emit(SESSION_EVENTS.join, { code: code! }, ack);
    },
    [code],
  );
  return useChannel<StudentSnapshot>(code, join);
}

export function useTeacherSession(sessionId: string | undefined) {
  const [connectedStudents, setConnectedStudents] = useState(0);
  const join = useCallback(
    (socket: AnySocket, ack: (result: SocketAck<TeacherSnapshot>) => void) => {
      socket.emit(SESSION_EVENTS.watch, { sessionId: sessionId! }, ack);
    },
    [sessionId],
  );
  const onAccepted = useCallback((snapshot: TeacherSnapshot) => setConnectedStudents(snapshot.connectedStudents), []);
  const channel = useChannel<TeacherSnapshot>(sessionId, join, setConnectedStudents, onAccepted);
  return { ...channel, connectedStudents };
}
