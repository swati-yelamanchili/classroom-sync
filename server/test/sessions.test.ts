import type { Socket } from 'socket.io-client';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { newerSnapshot, type StudentSnapshot, type TeacherSnapshot } from '@classroom/shared';
import { createSession, delay, joinStudent, nextEvent, createTestServer, resetDb, type TestServer } from './helpers';

let t: TestServer;
beforeAll(async () => {
  t = await createTestServer();
});
afterAll(() => t.close());
beforeEach(() => resetDb(t.db));

const TOPICS = ['Addition', 'Subtraction', 'Multiplication'];
const topicCall = (id: string, body: object) => t.teacher.post(`/api/sessions/${id}/topic`, body);

function connected(socket: Socket): Promise<void> {
  return socket.connected ? Promise.resolve() : new Promise((resolve) => socket.once('connect', () => resolve()));
}

describe('session lifecycle', () => {
  it('walks created -> active -> paused -> active -> ended', async () => {
    const { session } = await createSession(t, TOPICS);
    expect(session).toMatchObject({ status: 'created', revision: 1, currentTopicIndex: 0, totalTopics: 3 });
    expect(session.sessionCode).toMatch(/^[A-HJ-NP-Z2-9]{6}$/);
    const started = (await t.teacher.post(`/api/sessions/${session.id}/start`)).body.data as TeacherSnapshot;
    expect(started).toMatchObject({ status: 'active', revision: 2 });
    expect((await t.teacher.post(`/api/sessions/${session.id}/pause`)).body.data.status).toBe('paused');
    expect((await t.teacher.post(`/api/sessions/${session.id}/resume`)).body.data.status).toBe('active');
    expect((await t.teacher.post(`/api/sessions/${session.id}/end`)).body.data.status).toBe('ended');
  });

  it('rejects invalid transitions', async () => {
    const { session } = await createSession(t, TOPICS);
    expect((await t.teacher.post(`/api/sessions/${session.id}/pause`)).status).toBe(409);
    expect((await t.teacher.post(`/api/sessions/${session.id}/resume`)).status).toBe(409);
    await t.teacher.post(`/api/sessions/${session.id}/start`);
    expect((await t.teacher.post(`/api/sessions/${session.id}/start`)).status).toBe(409);
    expect((await t.teacher.post(`/api/sessions/${session.id}/resume`)).status).toBe(409);
  });

  it('cannot restart or change an ended session', async () => {
    const { session } = await createSession(t, TOPICS);
    await t.teacher.post(`/api/sessions/${session.id}/start`);
    await t.teacher.post(`/api/sessions/${session.id}/end`);
    for (const action of ['start', 'pause', 'resume', 'end']) {
      const res = await t.teacher.post(`/api/sessions/${session.id}/${action}`);
      expect(res.status, action).toBe(409);
      expect(res.body.error.code).toBe('session_ended');
    }
    const res = await topicCall(session.id, { action: 'goto', index: 1 });
    expect(res.status).toBe(409);
    expect(res.body.error.code).toBe('session_ended');
    expect((await t.teacher.post(`/api/sessions/${session.id}/mode`, { syncMode: 'timestamp' })).status).toBe(409);
  });

  it('records basic session history without any transcript', async () => {
    const { session } = await createSession(t, TOPICS);
    await t.teacher.post(`/api/sessions/${session.id}/start`);
    await topicCall(session.id, { action: 'goto', index: 2, source: 'voice' });
    await t.teacher.post(`/api/sessions/${session.id}/end`);
    const events = (await t.teacher.get(`/api/sessions/${session.id}/events`)).body.data;
    expect(events.map((e: { type: string }) => e.type)).toEqual(['started', 'topic_changed', 'ended']);
    expect(events[1]).toMatchObject({ source: 'voice', toIndex: 2, topicTitle: 'Multiplication' });
    expect(JSON.stringify(events)).not.toContain('transcript');
  });
});

describe('topic changes', () => {
  it('rejects changes before the session starts', async () => {
    const { session } = await createSession(t, TOPICS);
    const res = await topicCall(session.id, { action: 'goto', index: 1 });
    expect(res.status).toBe(409);
    expect(res.body.error.code).toBe('session_not_started');
  });

  it.each([[-1], [3], [99], [1.5]])('rejects invalid index %d', async (index) => {
    const { session } = await createSession(t, TOPICS);
    await t.teacher.post(`/api/sessions/${session.id}/start`);
    const res = await topicCall(session.id, { action: 'goto', index });
    expect([400, 422]).toContain(res.status);
    const state = (await t.teacher.get(`/api/sessions/${session.id}`)).body.data;
    expect(state.currentTopicIndex).toBe(0);
    expect(state.revision).toBe(2);
  });

  it('moves next and previous and refuses to pass either end', async () => {
    const { session } = await createSession(t, TOPICS);
    await t.teacher.post(`/api/sessions/${session.id}/start`);
    expect((await topicCall(session.id, { action: 'previous' })).status).toBe(422);
    expect((await topicCall(session.id, { action: 'next' })).body.data.session.currentTopicIndex).toBe(1);
    expect((await topicCall(session.id, { action: 'next' })).body.data.session.currentTopicIndex).toBe(2);
    expect((await topicCall(session.id, { action: 'next' })).status).toBe(422);
    expect((await topicCall(session.id, { action: 'previous' })).body.data.session.currentTopicIndex).toBe(1);
  });

  it('applies a repeated commandId exactly once', async () => {
    const { session } = await createSession(t, TOPICS);
    await t.teacher.post(`/api/sessions/${session.id}/start`);
    const body = { action: 'next', commandId: 'command-1234' };
    const first = (await topicCall(session.id, body)).body.data;
    const second = (await topicCall(session.id, body)).body.data;
    expect(first).toMatchObject({ changed: true, session: { currentTopicIndex: 1 } });
    expect(second).toMatchObject({ changed: false, session: { currentTopicIndex: 1, revision: first.session.revision } });
  });

  it('does not bump the revision when the topic is already current', async () => {
    const { session } = await createSession(t, TOPICS);
    await t.teacher.post(`/api/sessions/${session.id}/start`);
    const res = (await topicCall(session.id, { action: 'goto', index: 0 })).body.data;
    expect(res).toMatchObject({ changed: false, session: { revision: 2 } });
  });

  it('serialises concurrent commands so none is lost', async () => {
    const { session } = await createSession(t, ['T1', 'T2', 'T3', 'T4', 'T5']);
    await t.teacher.post(`/api/sessions/${session.id}/start`);
    const results = await Promise.all(Array.from({ length: 4 }, () => topicCall(session.id, { action: 'next' })));
    expect(results.every((r) => r.status === 200)).toBe(true);
    const state = (await t.teacher.get(`/api/sessions/${session.id}`)).body.data;
    expect(state).toMatchObject({ currentTopicIndex: 4, revision: 6 });
  });

  it('rejects voice-sourced commands in Timestamp mode, but allows manual override', async () => {
    const { session } = await createSession(t, TOPICS, 'timestamp', [100, 100, 100]);
    await t.teacher.post(`/api/sessions/${session.id}/start`);
    const voice = await topicCall(session.id, { action: 'next', source: 'voice' });
    expect(voice.status).toBe(409);
    expect(voice.body.error.code).toBe('voice_disabled');
    expect((await topicCall(session.id, { action: 'next' })).status).toBe(200);
    await t.teacher.post(`/api/sessions/${session.id}/end`);
  });
});

describe('student access', () => {
  it('hides content until start and returns no teacher-only fields', async () => {
    const { session } = await createSession(t, TOPICS);
    const before = await fetch(`${t.url}/api/student/session/${session.sessionCode}`).then((r) => r.json());
    expect(before.data).toMatchObject({ status: 'created', currentTopic: null });
    expect(before.data.id).toBeUndefined();
    expect(before.data.topics).toBeUndefined();
    expect(before.data.connectedStudents).toBeUndefined();
  });
  it('accepts codes case-insensitively and with separators, and 404s on unknown ones', async () => {
    const { session } = await createSession(t, TOPICS);
    const lower = `${session.sessionCode.slice(0, 3)}-${session.sessionCode.slice(3)}`.toLowerCase();
    expect((await fetch(`${t.url}/api/student/session/${lower}`)).status).toBe(200);
    expect((await fetch(`${t.url}/api/student/session/ZZZZZZ`)).status).toBe(404);
  });
  it('rate limits session-code lookups', async () => {
    const limited = await createTestServer({ ...(await import('./helpers')).testConfig, rateLimits: { api: 10000, login: 100, studentLookup: 3 } });
    const statuses: number[] = [];
    for (let i = 0; i < 5; i += 1) statuses.push((await fetch(`${limited.url}/api/student/session/ZZZZZZ`)).status);
    expect(statuses).toEqual([404, 404, 404, 429, 429]);
    await limited.close();
  });
});

describe('real-time synchronisation', () => {
  it('sends a joining student the current state and pushes topic changes', async () => {
    const { session } = await createSession(t, TOPICS);
    await t.teacher.post(`/api/sessions/${session.id}/start`);
    await topicCall(session.id, { action: 'goto', index: 1 });

    const student = t.socket();
    await connected(student);
    const initial = await joinStudent(student, session.sessionCode);
    expect(initial).toMatchObject({ status: 'active', currentTopicIndex: 1, currentTopic: { displayTitle: 'Subtraction', number: 2 } });
    expect(initial.currentTopic!.resource!.scriptText).toBe('Script for Subtraction\n\nSecond paragraph.');
    expect(initial.currentTopic!.resource!.videoUrl).toBe('https://example.com/Subtraction');

    const pushed = nextEvent(student, 'topic:changed');
    await topicCall(session.id, { action: 'goto', index: 2 });
    const update = await pushed;
    expect(update).toMatchObject({ currentTopicIndex: 2, currentTopic: { displayTitle: 'Multiplication', number: 3 } });
    expect(update.revision).toBeGreaterThan(initial.revision);
  });

  it('delivers one teacher command to every connected student', async () => {
    const { session } = await createSession(t, TOPICS);
    await t.teacher.post(`/api/sessions/${session.id}/start`);
    const students = [t.socket(), t.socket(), t.socket()];
    await Promise.all(students.map(connected));
    await Promise.all(students.map((s) => joinStudent(s, session.sessionCode)));
    const pushes = Promise.all(students.map((s) => nextEvent(s, 'topic:changed')));
    await topicCall(session.id, { action: 'next' });
    expect((await pushes).map((s) => s.currentTopicIndex)).toEqual([1, 1, 1]);
  });

  it('does not leak updates between sessions', async () => {
    const a = await createSession(t, ['A1', 'A2']);
    const b = await createSession(t, ['B1', 'B2']);
    await t.teacher.post(`/api/sessions/${a.session.id}/start`);
    await t.teacher.post(`/api/sessions/${b.session.id}/start`);
    const student = t.socket();
    await connected(student);
    await joinStudent(student, a.session.sessionCode);
    let received = 0;
    student.on('topic:changed', () => (received += 1));
    await topicCall(b.session.id, { action: 'next' });
    await delay(150);
    expect(received).toBe(0);
  });

  it('resynchronises a reconnecting student to changes it missed', async () => {
    const { session } = await createSession(t, TOPICS);
    await t.teacher.post(`/api/sessions/${session.id}/start`);
    const student = t.socket();
    await connected(student);
    const first = await joinStudent(student, session.sessionCode);
    student.disconnect();
    await topicCall(session.id, { action: 'goto', index: 2 });
    student.connect();
    await connected(student);
    const rejoined = await joinStudent(student, session.sessionCode);
    expect(rejoined.currentTopicIndex).toBe(2);
    expect(newerSnapshot(first, rejoined)).toBe(rejoined);
  });

  it('broadcasts lifecycle events, including ended', async () => {
    const { session } = await createSession(t, TOPICS);
    const student = t.socket();
    await connected(student);
    const waiting = await joinStudent(student, session.sessionCode);
    expect(waiting).toMatchObject({ status: 'created', currentTopic: null });

    let next = nextEvent(student, 'session:started');
    await t.teacher.post(`/api/sessions/${session.id}/start`);
    expect(await next).toMatchObject({ status: 'active', currentTopic: { number: 1 } });

    next = nextEvent(student, 'session:paused');
    await t.teacher.post(`/api/sessions/${session.id}/pause`);
    expect((await next).status).toBe('paused');

    next = nextEvent(student, 'session:resumed');
    await t.teacher.post(`/api/sessions/${session.id}/resume`);
    expect((await next).status).toBe('active');

    next = nextEvent(student, 'session:ended');
    await t.teacher.post(`/api/sessions/${session.id}/end`);
    expect(await next).toMatchObject({ status: 'ended', currentTopic: null });
  });

  it('reports the real number of connected students to the teacher', async () => {
    const { session } = await createSession(t, TOPICS);
    const teacher = t.socket({ Cookie: t.cookie });
    await connected(teacher);
    const watched = await new Promise<{ ok: boolean; data: TeacherSnapshot }>((resolve) =>
      teacher.emit('session:watch', { sessionId: session.id }, resolve),
    );
    expect(watched.data.connectedStudents).toBe(0);

    const student = t.socket();
    await connected(student);
    let presence = nextEvent<{ connectedStudents: number }>(teacher, 'session:presence');
    await joinStudent(student, session.sessionCode);
    expect((await presence).connectedStudents).toBe(1);

    presence = nextEvent(teacher, 'session:presence');
    student.disconnect();
    expect((await presence).connectedStudents).toBe(0);
  });

  it('gives teacher sockets the full sequence and student sockets only the current topic', async () => {
    const { session } = await createSession(t, TOPICS);
    await t.teacher.post(`/api/sessions/${session.id}/start`);
    const teacher = t.socket({ Cookie: t.cookie });
    const student = t.socket();
    await Promise.all([connected(teacher), connected(student)]);
    await new Promise((resolve) => teacher.emit('session:watch', { sessionId: session.id }, resolve));
    await joinStudent(student, session.sessionCode);
    const teacherPush = nextEvent<TeacherSnapshot>(teacher, 'topic:changed');
    const studentPush = nextEvent<StudentSnapshot>(student, 'topic:changed');
    await topicCall(session.id, { action: 'next' });
    expect((await teacherPush).topics).toHaveLength(3);
    expect(await studentPush).not.toHaveProperty('topics');
  });

  it('refuses to let a socket without the teacher cookie watch a session', async () => {
    const { session } = await createSession(t, TOPICS);
    const anon = t.socket();
    await connected(anon);
    const result = await new Promise<{ ok: boolean; error?: string }>((resolve) =>
      anon.emit('session:watch', { sessionId: session.id }, resolve),
    );
    expect(result).toEqual({ ok: false, error: 'Teacher sign-in required.' });
  });

  it('gives a student socket no way to change state', async () => {
    const { session } = await createSession(t, TOPICS);
    await t.teacher.post(`/api/sessions/${session.id}/start`);
    const student = t.socket();
    await connected(student);
    await joinStudent(student, session.sessionCode);
    // Events the server does not listen for from clients are simply dropped.
    student.emit('topic:changed' as never, { currentTopicIndex: 2 } as never);
    student.emit('session:ended' as never, {} as never);
    await delay(100);
    const state = (await t.teacher.get(`/api/sessions/${session.id}`)).body.data;
    expect(state).toMatchObject({ status: 'active', currentTopicIndex: 0 });
  });

  it('rejects an unknown code and malformed payloads on join', async () => {
    const student = t.socket();
    await connected(student);
    await expect(joinStudent(student, 'ZZZZZZ')).rejects.toThrow('No session found');
    const bad = await new Promise<{ ok: boolean }>((resolve) => student.emit('session:join', { code: 42 } as never, resolve));
    expect(bad.ok).toBe(false);
  });
});

describe('timestamp mode', () => {
  it('advances on the backend at each boundary and pushes every transition', async () => {
    const { session } = await createSession(t, TOPICS, 'timestamp', [1, 1, 100]);
    const student = t.socket();
    await connected(student);
    await joinStudent(student, session.sessionCode);
    const seen: { index: number; source: string }[] = [];
    student.on('topic:changed', (s: StudentSnapshot) => seen.push({ index: s.currentTopicIndex, source: 'push' }));
    const startedAt = Date.now();
    await t.teacher.post(`/api/sessions/${session.id}/start`);
    await delay(2400);
    expect(seen.map((s) => s.index)).toEqual([1, 2]);
    const elapsed = (Date.now() - startedAt) / 1000;
    const state = (await t.teacher.get(`/api/sessions/${session.id}`)).body.data as TeacherSnapshot;
    expect(state.elapsedActiveSeconds).toBeGreaterThan(2);
    expect(state.elapsedActiveSeconds).toBeLessThanOrEqual(elapsed + 0.1);
    const history = (await t.teacher.get(`/api/sessions/${session.id}/events`)).body.data;
    expect(history.filter((e: { source: string }) => e.source === 'timer')).toHaveLength(2);
    await t.teacher.post(`/api/sessions/${session.id}/end`);
  });

  it('stops at the final topic instead of ending or wrapping', async () => {
    const { session } = await createSession(t, ['T1', 'T2'], 'timestamp', [1, 1]);
    await t.teacher.post(`/api/sessions/${session.id}/start`);
    await delay(2300);
    const state = (await t.teacher.get(`/api/sessions/${session.id}`)).body.data;
    expect(state).toMatchObject({ currentTopicIndex: 1, status: 'active' });
    await t.teacher.post(`/api/sessions/${session.id}/end`);
  });

  it('does not advance or accumulate time while paused, and continues correctly on resume', async () => {
    const { session } = await createSession(t, TOPICS, 'timestamp', [2, 100, 100]);
    await t.teacher.post(`/api/sessions/${session.id}/start`);
    await delay(1000);
    const paused = (await t.teacher.post(`/api/sessions/${session.id}/pause`)).body.data as TeacherSnapshot;
    expect(paused.elapsedActiveSeconds).toBeGreaterThanOrEqual(1);
    await delay(1500);
    const during = (await t.teacher.get(`/api/sessions/${session.id}`)).body.data as TeacherSnapshot;
    expect(during.currentTopicIndex).toBe(0);
    expect(during.elapsedActiveSeconds).toBeCloseTo(paused.elapsedActiveSeconds, 3);
    await t.teacher.post(`/api/sessions/${session.id}/resume`);
    await delay(600);
    expect((await t.teacher.get(`/api/sessions/${session.id}`)).body.data.currentTopicIndex).toBe(0);
    await delay(800);
    expect((await t.teacher.get(`/api/sessions/${session.id}`)).body.data.currentTopicIndex).toBe(1);
    await t.teacher.post(`/api/sessions/${session.id}/end`);
  });

  it('manual override restarts the clock for the chosen topic', async () => {
    const { session } = await createSession(t, TOPICS, 'timestamp', [100, 2, 100]);
    await t.teacher.post(`/api/sessions/${session.id}/start`);
    await delay(500);
    await topicCall(session.id, { action: 'goto', index: 1 });
    await delay(1000);
    expect((await t.teacher.get(`/api/sessions/${session.id}`)).body.data.currentTopicIndex).toBe(1);
    await delay(1300);
    expect((await t.teacher.get(`/api/sessions/${session.id}`)).body.data.currentTopicIndex).toBe(2);
    await t.teacher.post(`/api/sessions/${session.id}/end`);
  });

  it('ending the session stops progression', async () => {
    const { session } = await createSession(t, TOPICS, 'timestamp', [1, 1, 1]);
    await t.teacher.post(`/api/sessions/${session.id}/start`);
    await t.teacher.post(`/api/sessions/${session.id}/end`);
    await delay(1300);
    const state = (await t.teacher.get(`/api/sessions/${session.id}`)).body.data;
    expect(state).toMatchObject({ status: 'ended', currentTopicIndex: 0 });
  });

  it('never advances automatically in voice mode', async () => {
    const { session } = await createSession(t, TOPICS, 'voice', [1, 1, 1]);
    await t.teacher.post(`/api/sessions/${session.id}/start`);
    await delay(1300);
    expect((await t.teacher.get(`/api/sessions/${session.id}`)).body.data.currentTopicIndex).toBe(0);
    await t.teacher.post(`/api/sessions/${session.id}/end`);
  });

  it('refuses a mode switch while running and honours it while paused', async () => {
    const { session } = await createSession(t, TOPICS, 'timestamp', [1, 1, 1]);
    await t.teacher.post(`/api/sessions/${session.id}/start`);
    const running = await t.teacher.post(`/api/sessions/${session.id}/mode`, { syncMode: 'voice' });
    expect(running.status).toBe(409);
    await t.teacher.post(`/api/sessions/${session.id}/pause`);
    const switched = await t.teacher.post(`/api/sessions/${session.id}/mode`, { syncMode: 'voice' });
    expect(switched.body.data.syncMode).toBe('voice');
    await t.teacher.post(`/api/sessions/${session.id}/resume`);
    await delay(1300);
    expect((await t.teacher.get(`/api/sessions/${session.id}`)).body.data.currentTopicIndex).toBe(0);
    await t.teacher.post(`/api/sessions/${session.id}/end`);
  });

  it('re-arms running timers after a server restart', async () => {
    const { session } = await createSession(t, TOPICS, 'timestamp', [1, 100, 100]);
    await t.teacher.post(`/api/sessions/${session.id}/start`);
    t.server.sessions.shutdown();
    await delay(1200);
    expect((await t.teacher.get(`/api/sessions/${session.id}`)).body.data.currentTopicIndex).toBe(0);
    await t.server.sessions.recover();
    expect((await t.teacher.get(`/api/sessions/${session.id}`)).body.data.currentTopicIndex).toBe(1);
    await t.teacher.post(`/api/sessions/${session.id}/end`);
  });
});
