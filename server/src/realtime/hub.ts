import type { Server as HttpServer } from 'node:http';
import { Server, type Socket } from 'socket.io';
import { z } from 'zod';
import {
  SESSION_EVENTS,
  type ClientToServerEvents,
  type ServerToClientEvents,
  type SessionStateEvent,
  type StudentSnapshot,
  type TeacherSnapshot,
} from '@classroom/shared';
import type { AppConfig } from '../config';
import { isTeacherCookieHeader } from '../lib/auth';
import { ApiError } from '../lib/errors';
import type { SessionPublisher, SessionService } from '../services/sessions';

interface SocketData {
  sessionId?: string;
  role?: 'student' | 'teacher';
  joinAttempts: number;
}

type AppSocket = Socket<ClientToServerEvents, ServerToClientEvents, Record<string, never>, SocketData>;

const studentRoom = (sessionId: string) => `students:${sessionId}`;
const teacherRoom = (sessionId: string) => `teachers:${sessionId}`;

const MAX_JOIN_ATTEMPTS_PER_CONNECTION = 30;
const joinPayload = z.object({ code: z.string().min(1).max(20) });
const watchPayload = z.object({ sessionId: z.string().min(1).max(64) });

const errorMessage = (error: unknown, fallback: string) => (error instanceof ApiError ? error.message : fallback);

export function createRealtime(httpServer: HttpServer, config: AppConfig, sessions: SessionService) {
  const io = new Server<ClientToServerEvents, ServerToClientEvents, Record<string, never>, SocketData>(httpServer, {
    cors: config.clientOrigins.length ? { origin: config.clientOrigins, credentials: true } : undefined,
    // Notice a silently dropped connection within about ten seconds rather than the default 45,
    // so the student's "connection lost" warning and the teacher's device count stay honest.
    pingInterval: 5000,
    pingTimeout: 5000,
  });

  const connectedStudents = (sessionId: string) => io.sockets.adapter.rooms.get(studentRoom(sessionId))?.size ?? 0;

  const emitPresence = (sessionId: string) => {
    // Counts are for the teacher dashboard only; students have no need of them.
    io.to(teacherRoom(sessionId)).emit(SESSION_EVENTS.presence, { connectedStudents: connectedStudents(sessionId) });
  };

  const leaveCurrent = async (socket: AppSocket) => {
    const { sessionId, role } = socket.data;
    if (!sessionId) return;
    await socket.leave(role === 'teacher' ? teacherRoom(sessionId) : studentRoom(sessionId));
    socket.data.sessionId = undefined;
    socket.data.role = undefined;
    if (role === 'student') emitPresence(sessionId);
  };

  io.on('connection', (socket: AppSocket) => {
    socket.data.joinAttempts = 0;

    socket.on(SESSION_EVENTS.join, async (payload, ack) => {
      if (typeof ack !== 'function') return;
      socket.data.joinAttempts += 1;
      if (socket.data.joinAttempts > MAX_JOIN_ATTEMPTS_PER_CONNECTION) {
        ack({ ok: false, error: 'Too many attempts. Please reload and try again.' });
        return;
      }
      const parsed = joinPayload.safeParse(payload);
      if (!parsed.success) {
        ack({ ok: false, error: 'That session code is not valid.' });
        return;
      }
      try {
        const session = await sessions.findByCode(parsed.data.code);
        await leaveCurrent(socket);
        await socket.join(studentRoom(session.id));
        socket.data.sessionId = session.id;
        socket.data.role = 'student';
        // Read after joining so no change can fall between this snapshot and the broadcasts.
        const fresh = await sessions.findByCode(parsed.data.code);
        ack({ ok: true, data: sessions.studentSnapshot(fresh) });
        emitPresence(session.id);
      } catch (error) {
        ack({ ok: false, error: error instanceof ApiError && error.status === 404 ? 'No session found with that code.' : errorMessage(error, 'Could not join the session.') });
      }
    });

    socket.on(SESSION_EVENTS.watch, async (payload, ack) => {
      if (typeof ack !== 'function') return;
      if (!isTeacherCookieHeader(config, socket.handshake.headers.cookie)) {
        ack({ ok: false, error: 'Teacher sign-in required.' });
        return;
      }
      const parsed = watchPayload.safeParse(payload);
      if (!parsed.success) {
        ack({ ok: false, error: 'Invalid session.' });
        return;
      }
      try {
        await sessions.getTeacher(parsed.data.sessionId);
        await leaveCurrent(socket);
        await socket.join(teacherRoom(parsed.data.sessionId));
        socket.data.sessionId = parsed.data.sessionId;
        socket.data.role = 'teacher';
        ack({ ok: true, data: await sessions.getTeacher(parsed.data.sessionId) });
      } catch (error) {
        ack({ ok: false, error: errorMessage(error, 'Could not open the session.') });
      }
    });

    socket.on(SESSION_EVENTS.leave, () => {
      void leaveCurrent(socket);
    });

    socket.on('disconnect', () => {
      const { sessionId, role } = socket.data;
      if (sessionId && role === 'student') emitPresence(sessionId);
    });
  });

  const publisher: SessionPublisher = {
    publish(event: SessionStateEvent, sessionId: string, student: StudentSnapshot, teacher: TeacherSnapshot) {
      io.to(studentRoom(sessionId)).emit(event, student);
      io.to(teacherRoom(sessionId)).emit(event, teacher);
    },
    connectedStudents,
  };
  sessions.setPublisher(publisher);

  return io;
}
