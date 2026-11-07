import { randomInt } from 'node:crypto';
import type { ClassroomSession, Lesson, LessonTopic, PrismaClient, Resource } from '@prisma/client';
import {
  canChangeTopic,
  canTransition,
  computeElapsedSeconds,
  computeTimerAdvances,
  secondsUntilNextAdvance,
  SESSION_EVENTS,
  type ChangeTopicRequest,
  type ChangeTopicResponse,
  type CommandSource,
  type Provenance,
  type SessionEventDTO,
  type SessionStateEvent,
  type SessionStatus,
  type SessionSummary,
  type StudentSnapshot,
  type SyncMode,
  type TeacherSnapshot,
  type TimerState,
  type TopicView,
} from '@classroom/shared';
import { ApiError, conflict, notFound } from '../lib/errors';
import { toSessionSummary } from './lessons';

type LoadedSession = ClassroomSession & {
  lesson: Lesson & { topics: (LessonTopic & { resource: Resource | null })[] };
};

const sessionInclude = {
  lesson: { include: { topics: { orderBy: { position: 'asc' }, include: { resource: true } } } },
} as const;

/** No 0/O or 1/I, so a code read aloud or from a board is hard to get wrong. */
const CODE_ALPHABET = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
const CODE_LENGTH = 6;

export function normalizeSessionCode(code: string): string {
  return code.replace(/[^a-z0-9]/gi, '').toUpperCase();
}

function toTopicView(topic: LoadedSession['lesson']['topics'][number], index: number): TopicView {
  const r = topic.resource;
  return {
    index,
    number: index + 1,
    displayTitle: topic.displayTitle,
    estimatedDurationSeconds: topic.estimatedDurationSeconds,
    resource: r && {
      title: r.title,
      videoUrl: r.videoUrl,
      scriptText: r.scriptText,
      language: r.language,
      provenance: r.provenance as Provenance,
      sourceOrganisation: r.sourceOrganisation,
      sourceReference: r.sourceReference,
    },
  };
}

function elapsedOf(s: ClassroomSession, nowMs: number): number {
  return computeElapsedSeconds(
    { elapsedActiveSeconds: s.elapsedActiveSeconds, activeSinceMs: s.activeSince?.getTime() ?? null },
    nowMs,
  );
}

function timerStateOf(s: LoadedSession): TimerState {
  return {
    currentTopicIndex: s.currentTopicIndex,
    topicStartedElapsedSeconds: s.topicStartedElapsedSeconds,
    durationsSeconds: s.lesson.topics.map((t) => t.estimatedDurationSeconds),
  };
}

export interface SessionPublisher {
  publish(event: SessionStateEvent, sessionId: string, student: StudentSnapshot, teacher: TeacherSnapshot): void;
  connectedStudents(sessionId: string): number;
}

interface Mutation {
  data: Partial<ClassroomSession>;
  event: SessionStateEvent;
  type: string;
  source: CommandSource;
  commandId?: string;
  fromIndex?: number;
  toIndex?: number;
}

export class SessionService {
  private readonly queues = new Map<string, Promise<unknown>>();
  private readonly timers = new Map<string, NodeJS.Timeout>();
  private publisher: SessionPublisher | null = null;

  constructor(private readonly db: PrismaClient) {}

  setPublisher(publisher: SessionPublisher): void {
    this.publisher = publisher;
  }

  /** Serialises all changes per session, so concurrent commands cannot interleave. */
  private exclusive<T>(sessionId: string, task: () => Promise<T>): Promise<T> {
    const run = (this.queues.get(sessionId) ?? Promise.resolve()).then(task, task);
    const settled = run.catch(() => undefined);
    this.queues.set(sessionId, settled);
    void settled.then(() => {
      if (this.queues.get(sessionId) === settled) this.queues.delete(sessionId);
    });
    return run;
  }

  private async load(id: string): Promise<LoadedSession> {
    const session = await this.db.classroomSession.findUnique({ where: { id }, include: sessionInclude });
    if (!session) throw notFound('Session');
    return session;
  }

  studentSnapshot(s: LoadedSession, nowMs = Date.now()): StudentSnapshot {
    const showContent = s.status === 'active' || s.status === 'paused';
    const topic = s.lesson.topics[s.currentTopicIndex];
    return {
      sessionCode: s.sessionCode,
      lessonTitle: s.lesson.title,
      revision: s.revision,
      status: s.status as SessionStatus,
      syncMode: s.syncMode as SyncMode,
      currentTopicIndex: s.currentTopicIndex,
      totalTopics: s.lesson.topics.length,
      elapsedActiveSeconds: elapsedOf(s, nowMs),
      topicStartedElapsedSeconds: s.topicStartedElapsedSeconds,
      serverTime: nowMs,
      currentTopic: showContent && topic ? toTopicView(topic, s.currentTopicIndex) : null,
    };
  }

  teacherSnapshot(s: LoadedSession, nowMs = Date.now()): TeacherSnapshot {
    const topics = s.lesson.topics.map(toTopicView);
    return {
      id: s.id,
      lessonId: s.lessonId,
      sessionCode: s.sessionCode,
      lessonTitle: s.lesson.title,
      revision: s.revision,
      status: s.status as SessionStatus,
      syncMode: s.syncMode as SyncMode,
      currentTopicIndex: s.currentTopicIndex,
      totalTopics: topics.length,
      elapsedActiveSeconds: elapsedOf(s, nowMs),
      topicStartedElapsedSeconds: s.topicStartedElapsedSeconds,
      serverTime: nowMs,
      currentTopic: topics[s.currentTopicIndex] ?? null,
      topics,
      connectedStudents: this.publisher?.connectedStudents(s.id) ?? 0,
      createdAt: s.createdAt.toISOString(),
      startedAt: s.startedAt?.toISOString() ?? null,
      pausedAt: s.pausedAt?.toISOString() ?? null,
      endedAt: s.endedAt?.toISOString() ?? null,
    };
  }

  /** Persist the change and its history row, then broadcast the resulting state. */
  private async apply(session: LoadedSession, mutation: Mutation, nowMs: number): Promise<LoadedSession> {
    const revision = session.revision + 1;
    const toIndex = mutation.toIndex ?? (mutation.data.currentTopicIndex as number | undefined) ?? session.currentTopicIndex;
    const [updated] = await this.db.$transaction([
      this.db.classroomSession.update({
        where: { id: session.id, revision: session.revision },
        data: { ...mutation.data, revision },
        include: sessionInclude,
      }),
      this.db.sessionEvent.create({
        data: {
          sessionId: session.id,
          type: mutation.type,
          source: mutation.source,
          commandId: mutation.commandId ?? null,
          fromIndex: mutation.fromIndex ?? null,
          toIndex: mutation.toIndex ?? null,
          topicTitle: session.lesson.topics[toIndex]?.displayTitle ?? null,
          revision,
        },
      }),
    ]);
    this.publisher?.publish(mutation.event, updated.id, this.studentSnapshot(updated, nowMs), this.teacherSnapshot(updated, nowMs));
    return updated;
  }

  private assertTransition(session: ClassroomSession, to: SessionStatus): void {
    if (!canTransition(session.status as SessionStatus, to)) {
      if (session.status === 'ended') throw conflict('session_ended', 'This session has ended and cannot be changed.');
      throw conflict('invalid_transition', `A session that is ${session.status} cannot become ${to}.`);
    }
  }

  async create(lessonId: string, syncMode: SyncMode): Promise<TeacherSnapshot> {
    const lesson = await this.db.lesson.findUnique({ where: { id: lessonId }, include: { topics: { select: { id: true } } } });
    if (!lesson) throw notFound('Lesson');
    if (lesson.status !== 'confirmed') throw conflict('lesson_not_confirmed', 'Confirm the teaching sequence before creating a session.');
    if (!lesson.topics.length) throw conflict('empty_lesson', 'This lesson has no topics.');
    const open = await this.db.classroomSession.findFirst({ where: { lessonId, status: { not: 'ended' } } });
    if (open) {
      throw new ApiError(409, 'session_open', `This lesson already has an open session (${open.sessionCode}).`, { sessionId: open.id });
    }
    for (let attempt = 0; attempt < 10; attempt += 1) {
      const sessionCode = Array.from({ length: CODE_LENGTH }, () => CODE_ALPHABET[randomInt(CODE_ALPHABET.length)]).join('');
      const taken = await this.db.classroomSession.findUnique({ where: { sessionCode } });
      if (taken) continue;
      const created = await this.db.classroomSession.create({ data: { lessonId, sessionCode, syncMode }, include: sessionInclude });
      return this.teacherSnapshot(created);
    }
    throw new ApiError(500, 'code_generation_failed', 'Could not generate a unique session code. Please try again.');
  }

  async list(openOnly: boolean): Promise<(SessionSummary & { lessonId: string; lessonTitle: string })[]> {
    const rows = await this.db.classroomSession.findMany({
      where: openOnly ? { status: { not: 'ended' } } : undefined,
      orderBy: { createdAt: 'desc' },
      include: { lesson: { select: { title: true } } },
      take: 100,
    });
    return rows.map((s) => ({ ...toSessionSummary(s), lessonId: s.lessonId, lessonTitle: s.lesson.title }));
  }

  async getTeacher(id: string): Promise<TeacherSnapshot> {
    return this.teacherSnapshot(await this.load(id));
  }

  /** Resolve a code to its session, for students. Throws not-found for unknown codes. */
  async findByCode(code: string): Promise<LoadedSession> {
    const session = await this.db.classroomSession.findUnique({
      where: { sessionCode: normalizeSessionCode(code) },
      include: sessionInclude,
    });
    if (!session) throw notFound('Session');
    return session;
  }

  async getStudent(code: string): Promise<StudentSnapshot> {
    return this.studentSnapshot(await this.findByCode(code));
  }

  async events(id: string): Promise<SessionEventDTO[]> {
    await this.load(id);
    const rows = await this.db.sessionEvent.findMany({ where: { sessionId: id }, orderBy: { revision: 'asc' } });
    return rows.map((e) => ({
      id: e.id,
      type: e.type,
      source: e.source as CommandSource,
      fromIndex: e.fromIndex,
      toIndex: e.toIndex,
      topicTitle: e.topicTitle,
      createdAt: e.createdAt.toISOString(),
    }));
  }

  start(id: string): Promise<TeacherSnapshot> {
    return this.exclusive(id, async () => {
      const session = await this.load(id);
      this.assertTransition(session, 'active');
      if (session.status !== 'created') throw conflict('invalid_transition', 'This session has already started.');
      const now = new Date();
      const updated = await this.apply(
        session,
        {
          data: { status: 'active', startedAt: now, activeSince: now, elapsedActiveSeconds: 0, topicStartedElapsedSeconds: 0, currentTopicIndex: 0 },
          event: SESSION_EVENTS.started,
          type: 'started',
          source: 'manual',
          toIndex: 0,
        },
        now.getTime(),
      );
      this.schedule(updated);
      return this.teacherSnapshot(updated);
    });
  }

  pause(id: string, source: 'manual' | 'voice' = 'manual'): Promise<TeacherSnapshot> {
    return this.exclusive(id, async () => {
      const session = await this.load(id);
      this.assertTransition(session, 'paused');
      const now = new Date();
      const updated = await this.apply(
        session,
        {
          data: { status: 'paused', pausedAt: now, activeSince: null, elapsedActiveSeconds: elapsedOf(session, now.getTime()) },
          event: SESSION_EVENTS.paused,
          type: 'paused',
          source,
        },
        now.getTime(),
      );
      this.clearTimer(id);
      return this.teacherSnapshot(updated);
    });
  }

  resume(id: string, source: 'manual' | 'voice' = 'manual'): Promise<TeacherSnapshot> {
    return this.exclusive(id, async () => {
      const session = await this.load(id);
      this.assertTransition(session, 'active');
      if (session.status !== 'paused') throw conflict('invalid_transition', 'Only a paused session can be resumed.');
      const now = new Date();
      const updated = await this.apply(
        session,
        { data: { status: 'active', pausedAt: null, activeSince: now }, event: SESSION_EVENTS.resumed, type: 'resumed', source },
        now.getTime(),
      );
      this.schedule(updated);
      return this.teacherSnapshot(updated);
    });
  }

  end(id: string): Promise<TeacherSnapshot> {
    return this.exclusive(id, async () => {
      const session = await this.load(id);
      this.assertTransition(session, 'ended');
      const now = new Date();
      const updated = await this.apply(
        session,
        {
          data: { status: 'ended', endedAt: now, activeSince: null, pausedAt: null, elapsedActiveSeconds: elapsedOf(session, now.getTime()) },
          event: SESSION_EVENTS.ended,
          type: 'ended',
          source: 'manual',
        },
        now.getTime(),
      );
      this.clearTimer(id);
      return this.teacherSnapshot(updated);
    });
  }

  /** Validated server-side regardless of what the teacher's device already checked. */
  changeTopic(id: string, request: ChangeTopicRequest): Promise<ChangeTopicResponse> {
    return this.exclusive(id, async () => {
      const session = await this.load(id);
      const source = request.source ?? 'manual';

      if (request.commandId) {
        const seen = await this.db.sessionEvent.findUnique({
          where: { sessionId_commandId: { sessionId: id, commandId: request.commandId } },
        });
        if (seen) return { session: this.teacherSnapshot(session), changed: false };
      }
      if (session.status === 'ended') throw conflict('session_ended', 'This session has ended and cannot be changed.');
      if (!canChangeTopic(session.status as SessionStatus)) {
        throw conflict('session_not_started', 'Start the session before changing topics.');
      }
      if (source === 'voice' && session.syncMode !== 'voice') {
        throw conflict('voice_disabled', 'Voice commands only work in Voice Trigger mode.');
      }

      const last = session.lesson.topics.length - 1;
      const target =
        request.action === 'goto'
          ? request.index
          : session.currentTopicIndex + (request.action === 'next' ? 1 : -1);
      if (target === undefined || !Number.isInteger(target) || target < 0 || target > last) {
        if (request.action === 'next') throw new ApiError(422, 'invalid_topic', 'Already on the last topic.');
        if (request.action === 'previous') throw new ApiError(422, 'invalid_topic', 'Already on the first topic.');
        throw new ApiError(422, 'invalid_topic', `There is no topic at that position. This lesson has ${last + 1} topics.`);
      }
      if (target === session.currentTopicIndex) {
        return { session: this.teacherSnapshot(session), changed: false };
      }

      const nowMs = Date.now();
      const updated = await this.apply(
        session,
        {
          data: { currentTopicIndex: target, topicStartedElapsedSeconds: elapsedOf(session, nowMs) },
          event: SESSION_EVENTS.topicChanged,
          type: 'topic_changed',
          source,
          commandId: request.commandId,
          fromIndex: session.currentTopicIndex,
          toIndex: target,
        },
        nowMs,
      );
      this.schedule(updated);
      return { session: this.teacherSnapshot(updated), changed: true };
    });
  }

  /** Only allowed before start or while paused, so nothing can change under a running timer. */
  setMode(id: string, syncMode: SyncMode): Promise<TeacherSnapshot> {
    return this.exclusive(id, async () => {
      const session = await this.load(id);
      if (session.status === 'ended') throw conflict('session_ended', 'This session has ended and cannot be changed.');
      if (session.status === 'active') throw conflict('session_running', 'Pause the session before switching mode.');
      if (session.syncMode === syncMode) return this.teacherSnapshot(session);
      const nowMs = Date.now();
      const updated = await this.apply(
        session,
        {
          data: { syncMode, topicStartedElapsedSeconds: elapsedOf(session, nowMs) },
          event: SESSION_EVENTS.modeChanged,
          type: 'mode_changed',
          source: 'manual',
        },
        nowMs,
      );
      return this.teacherSnapshot(updated);
    });
  }

  private clearTimer(id: string): void {
    const timer = this.timers.get(id);
    if (timer) clearTimeout(timer);
    this.timers.delete(id);
  }

  /** The only clock that moves topics in Timestamp mode: one server timer per running session. */
  private schedule(session: LoadedSession): void {
    this.clearTimer(session.id);
    if (session.status !== 'active' || session.syncMode !== 'timestamp') return;
    const remaining = secondsUntilNextAdvance(timerStateOf(session), elapsedOf(session, Date.now()));
    if (remaining === null) return;
    const timer = setTimeout(() => {
      this.timers.delete(session.id);
      this.tick(session.id).catch((error: unknown) => {
        console.error(`Timer advance failed for session ${session.id}:`, error);
      });
    }, Math.ceil(remaining * 1000));
    timer.unref?.();
    this.timers.set(session.id, timer);
  }

  private tick(id: string): Promise<void> {
    return this.exclusive(id, async () => {
      let session = await this.load(id);
      if (session.status !== 'active' || session.syncMode !== 'timestamp') return;
      const nowMs = Date.now();
      for (const advance of computeTimerAdvances(timerStateOf(session), elapsedOf(session, nowMs))) {
        session = await this.apply(
          session,
          {
            data: { currentTopicIndex: advance.toIndex, topicStartedElapsedSeconds: advance.topicStartedElapsedSeconds },
            event: SESSION_EVENTS.topicChanged,
            type: 'topic_changed',
            source: 'timer',
            fromIndex: session.currentTopicIndex,
            toIndex: advance.toIndex,
          },
          nowMs,
        );
      }
      this.schedule(session);
    });
  }

  /** After a restart, re-arm timers for sessions still running. */
  async recover(): Promise<void> {
    const running = await this.db.classroomSession.findMany({
      where: { status: 'active', syncMode: 'timestamp' },
      select: { id: true },
    });
    await Promise.all(running.map(({ id }) => this.tick(id)));
  }

  shutdown(): void {
    for (const id of [...this.timers.keys()]) this.clearTimer(id);
  }
}
