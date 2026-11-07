import type { AddressInfo } from 'node:net';
import { PrismaClient } from '@prisma/client';
import { io as connect, type Socket } from 'socket.io-client';
import request from 'supertest';
import type { StudentSnapshot, TeacherSnapshot } from '@classroom/shared';
import { createApp } from '../src/app';
import type { AppConfig } from '../src/config';

export const testConfig: AppConfig = {
  port: 0,
  teacherPasscode: 'test-passcode',
  authSecret: 'test-secret',
  clientOrigins: [],
  cookieSecure: false,
  clientDistDir: null,
  publicBaseUrl: null,
  rateLimits: { api: 100_000, login: 1000, studentLookup: 100_000 },
  topicRecognitionProvider: 'disabled',
};

export async function createTestServer(config: AppConfig = testConfig) {
  const db = new PrismaClient();
  const server = createApp(db, config);
  await new Promise<void>((resolve) => server.httpServer.listen(0, resolve));
  const port = (server.httpServer.address() as AddressInfo).port;
  const url = `http://127.0.0.1:${port}`;

  const login = await request(url).post('/api/auth/login').send({ passcode: config.teacherPasscode });
  const cookie = login.headers['set-cookie']![0]!.split(';')[0]!;

  const sockets: Socket[] = [];
  const teacher = {
    get: (path: string) => request(url).get(path).set('Cookie', cookie),
    post: (path: string, body?: object) => request(url).post(path).set('Cookie', cookie).send(body),
    patch: (path: string, body?: object) => request(url).patch(path).set('Cookie', cookie).send(body),
    delete: (path: string) => request(url).delete(path).set('Cookie', cookie),
  };

  return {
    db,
    url,
    cookie,
    teacher,
    server,
    socket(extraHeaders?: Record<string, string>) {
      const socket = connect(url, { transports: ['websocket'], extraHeaders, forceNew: true });
      sockets.push(socket);
      return socket;
    },
    async close() {
      sockets.forEach((s) => s.close());
      await server.close();
      await db.$disconnect();
    },
  };
}

export type TestServer = Awaited<ReturnType<typeof createTestServer>>;

export async function resetDb(db: PrismaClient) {
  await db.sessionEvent.deleteMany();
  await db.classroomSession.deleteMany();
  await db.lessonTopic.deleteMany();
  await db.lesson.deleteMany();
  await db.resource.deleteMany();
}

export async function seedResources(t: TestServer, titles: string[]) {
  const created: { id: string; title: string }[] = [];
  for (const title of titles) {
    const res = await t.teacher.post('/api/resources', { title, scriptText: `Script for ${title}\n\nSecond paragraph.`, videoUrl: `https://example.com/${encodeURIComponent(title)}` });
    created.push(res.body.data);
  }
  return created;
}

/** A confirmed lesson and a not-yet-started session. */
export async function createSession(t: TestServer, titles: string[], syncMode: 'voice' | 'timestamp' = 'voice', durations?: number[]) {
  await seedResources(t, titles);
  const lesson = (await t.teacher.post('/api/lessons', { topics: titles })).body.data;
  if (durations) {
    await t.teacher.patch(`/api/lessons/${lesson.id}`, {
      topics: lesson.topics.map((topic: { id: string }, i: number) => ({ id: topic.id, estimatedDurationSeconds: durations[i] })),
    });
  }
  await t.teacher.post(`/api/lessons/${lesson.id}/confirm`);
  const session: TeacherSnapshot = (await t.teacher.post('/api/sessions', { lessonId: lesson.id, syncMode })).body.data;
  return { lessonId: lesson.id as string, session };
}

export function joinStudent(socket: Socket, code: string): Promise<StudentSnapshot> {
  return new Promise((resolve, reject) => {
    socket.emit('session:join', { code }, (ack: { ok: boolean; data: StudentSnapshot; error?: string }) => {
      if (ack.ok) resolve(ack.data);
      else reject(new Error(ack.error));
    });
  });
}

export function nextEvent<T = StudentSnapshot>(socket: Socket, event: string, timeoutMs = 5000): Promise<T> {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error(`Timed out waiting for ${event}`)), timeoutMs);
    socket.once(event, (payload: T) => {
      clearTimeout(timer);
      resolve(payload);
    });
  });
}

export const delay = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));
