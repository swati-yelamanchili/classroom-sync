import { existsSync } from 'node:fs';
import { createServer } from 'node:http';
import { networkInterfaces } from 'node:os';
import path from 'node:path';
import type { PrismaClient } from '@prisma/client';
import cors from 'cors';
import express, { Router, type ErrorRequestHandler, type Request } from 'express';
import rateLimit from 'express-rate-limit';
import helmet from 'helmet';
import { z } from 'zod';
import { SYNC_MODES } from '@classroom/shared';
import type { AppConfig } from './config';
import { AUTH_COOKIE, AUTH_TTL_MS, checkPasscode, isTeacherCookieHeader, issueTeacherToken, requireTeacher } from './lib/auth';
import { ApiError } from './lib/errors';
import { parseBody } from './lib/validate';
import { createRealtime } from './realtime/hub';
import { createLessonSchema, LessonService, patchLessonSchema } from './services/lessons';
import { resourceInputSchema } from './services/resourceSchema';
import { ResourceService } from './services/resources';
import { SessionService } from './services/sessions';
import { createTopicRecognitionProvider } from './services/topicRecognition';

const MINUTE = 60_000;

const limiter = (windowMs: number, limit: number) =>
  rateLimit({
    windowMs,
    limit,
    standardHeaders: 'draft-7',
    legacyHeaders: false,
    handler: (_req, res) => {
      res.status(429).json({ error: { code: 'rate_limited', message: 'Too many requests. Please wait a moment and try again.' } });
    },
  });

const idParam = (req: Request) => String(req.params.id);

const importSchema = z.object({
  format: z.enum(['csv', 'json']),
  content: z.string().min(1, 'The file is empty.'),
  dryRun: z.boolean().default(false),
});

const changeTopicSchema = z
  .object({
    action: z.enum(['goto', 'next', 'previous']),
    index: z.number().int().optional(),
    source: z.enum(['manual', 'voice']).default('manual'),
    commandId: z.string().min(8).max(64).optional(),
  })
  .refine((v) => v.action !== 'goto' || v.index !== undefined, { message: 'A topic position is required.', path: ['index'] });

const sourceSchema = z.object({ source: z.enum(['manual', 'voice']).default('manual') });

export function createApp(db: PrismaClient, config: AppConfig) {
  const resources = new ResourceService(db);
  const lessons = new LessonService(db);
  const sessions = new SessionService(db);
  const topicRecognition = createTopicRecognitionProvider(config.topicRecognitionProvider);

  const app = express();
  app.disable('x-powered-by');
  app.use(
    helmet({
      contentSecurityPolicy: {
        useDefaults: true,
        directives: {
          'media-src': ["'self'", 'https:', 'http:'],
          'frame-src': ['https://www.youtube-nocookie.com', 'https://player.vimeo.com'],
          'connect-src': ["'self'", 'ws:', 'wss:'],
          // Classrooms often reach the app by LAN IP over plain http.
          'upgrade-insecure-requests': null,
        },
      },
      strictTransportSecurity: config.cookieSecure,
      crossOriginOpenerPolicy: false,
      originAgentCluster: false,
    }),
  );
  if (config.clientOrigins.length) app.use(cors({ origin: config.clientOrigins, credentials: true }));

  app.use('/api', limiter(MINUTE, config.rateLimits.api));
  app.use('/api/resources/import', express.json({ limit: '6mb' }));
  app.use(express.json({ limit: '512kb' }));

  const api = Router();
  const teacher = requireTeacher(config);

  api.get('/health', (_req, res) => {
    res.json({ data: { status: 'ok' } });
  });

  // Where a student's device can reach this app, for building the joining link.
  api.get('/network', teacher, (_req, res) => {
    const lanAddresses = Object.values(networkInterfaces())
      .flat()
      .filter((address) => address && address.family === 'IPv4' && !address.internal)
      .map((address) => address!.address);
    res.json({ data: { publicBaseUrl: config.publicBaseUrl, lanAddresses } });
  });

  // Teacher sign-in
  api.post('/auth/login', limiter(15 * MINUTE, config.rateLimits.login), (req, res) => {
    const { passcode } = parseBody(z.object({ passcode: z.string().min(1, 'Enter the passcode.').max(200) }), req.body);
    if (!checkPasscode(config, passcode)) throw new ApiError(401, 'invalid_passcode', 'That passcode is not correct.');
    res.cookie(AUTH_COOKIE, issueTeacherToken(config), {
      httpOnly: true,
      sameSite: 'strict',
      secure: config.cookieSecure,
      maxAge: AUTH_TTL_MS,
      path: '/',
    });
    res.json({ data: { authenticated: true } });
  });
  api.post('/auth/logout', (_req, res) => {
    res.clearCookie(AUTH_COOKIE, { path: '/' });
    res.json({ data: { authenticated: false } });
  });
  api.get('/auth/me', (req, res) => {
    res.json({ data: { authenticated: isTeacherCookieHeader(config, req.headers.cookie) } });
  });

  // Resource library
  api.get('/resources', teacher, async (req, res) => {
    res.json({ data: await resources.list(typeof req.query.q === 'string' ? req.query.q : undefined) });
  });
  api.get('/resources/stats', teacher, async (_req, res) => {
    res.json({ data: await resources.stats() });
  });
  api.post('/resources/import', teacher, async (req, res) => {
    const { format, content, dryRun } = parseBody(importSchema, req.body);
    res.json({ data: await resources.importResources(format, content, dryRun) });
  });
  api.post('/resources', teacher, async (req, res) => {
    res.status(201).json({ data: await resources.create(parseBody(resourceInputSchema, req.body)) });
  });
  api.get('/resources/:id', teacher, async (req, res) => {
    res.json({ data: await resources.get(idParam(req)) });
  });
  api.patch('/resources/:id', teacher, async (req, res) => {
    res.json({ data: await resources.update(idParam(req), parseBody(resourceInputSchema, req.body)) });
  });
  api.delete('/resources/:id', teacher, async (req, res) => {
    await resources.remove(idParam(req));
    res.status(204).end();
  });

  // Lessons
  api.get('/lessons', teacher, async (_req, res) => {
    res.json({ data: await lessons.list() });
  });
  api.post('/lessons', teacher, async (req, res) => {
    res.status(201).json({ data: await lessons.create(parseBody(createLessonSchema, req.body)) });
  });
  api.get('/lessons/:id', teacher, async (req, res) => {
    res.json({ data: await lessons.get(idParam(req)) });
  });
  api.patch('/lessons/:id', teacher, async (req, res) => {
    res.json({ data: await lessons.patch(idParam(req), parseBody(patchLessonSchema, req.body)) });
  });
  api.delete('/lessons/:id', teacher, async (req, res) => {
    await lessons.remove(idParam(req));
    res.status(204).end();
  });
  api.post('/lessons/:id/match-resources', teacher, async (req, res) => {
    res.json({ data: await lessons.rematch(idParam(req)) });
  });
  api.post('/lessons/:id/confirm', teacher, async (req, res) => {
    res.json({ data: await lessons.confirm(idParam(req)) });
  });
  api.post('/lessons/:id/duplicate', teacher, async (req, res) => {
    res.status(201).json({ data: await lessons.duplicate(idParam(req)) });
  });

  // Classroom sessions: all state changes are teacher-only
  api.get('/sessions', teacher, async (req, res) => {
    res.json({ data: await sessions.list(req.query.open === 'true') });
  });
  api.post('/sessions', teacher, async (req, res) => {
    const body = parseBody(z.object({ lessonId: z.string().min(1), syncMode: z.enum(SYNC_MODES).default('voice') }), req.body);
    res.status(201).json({ data: await sessions.create(body.lessonId, body.syncMode) });
  });
  api.get('/sessions/:id', teacher, async (req, res) => {
    res.json({ data: await sessions.getTeacher(idParam(req)) });
  });
  api.get('/sessions/:id/events', teacher, async (req, res) => {
    res.json({ data: await sessions.events(idParam(req)) });
  });
  api.post('/sessions/:id/start', teacher, async (req, res) => {
    res.json({ data: await sessions.start(idParam(req)) });
  });
  api.post('/sessions/:id/pause', teacher, async (req, res) => {
    res.json({ data: await sessions.pause(idParam(req), parseBody(sourceSchema, req.body ?? {}).source) });
  });
  api.post('/sessions/:id/resume', teacher, async (req, res) => {
    res.json({ data: await sessions.resume(idParam(req), parseBody(sourceSchema, req.body ?? {}).source) });
  });
  api.post('/sessions/:id/end', teacher, async (req, res) => {
    res.json({ data: await sessions.end(idParam(req)) });
  });
  api.post('/sessions/:id/topic', teacher, async (req, res) => {
    res.json({ data: await sessions.changeTopic(idParam(req), parseBody(changeTopicSchema, req.body)) });
  });
  api.post('/sessions/:id/mode', teacher, async (req, res) => {
    const { syncMode } = parseBody(z.object({ syncMode: z.enum(SYNC_MODES) }), req.body);
    res.json({ data: await sessions.setMode(idParam(req), syncMode) });
  });

  // Student read-only view: no account, just the code
  api.get('/student/session/:code', limiter(MINUTE, config.rateLimits.studentLookup), async (req, res) => {
    res.json({ data: await sessions.getStudent(String(req.params.code)) });
  });

  api.use((_req, _res, next) => {
    next(new ApiError(404, 'not_found', 'No such API endpoint.'));
  });
  app.use('/api', api);

  if (config.clientDistDir && existsSync(config.clientDistDir)) {
    const dist = config.clientDistDir;
    app.use(express.static(dist));
    app.get('/{*path}', (_req, res) => {
      res.sendFile(path.join(dist, 'index.html'));
    });
  }

  const onError: ErrorRequestHandler = (error, _req, res, _next) => {
    if (error instanceof ApiError) {
      res.status(error.status).json({ error: { code: error.code, message: error.message, details: error.details } });
      return;
    }
    const status = (error as { status?: number }).status;
    if (status && status >= 400 && status < 500) {
      res.status(status).json({ error: { code: 'bad_request', message: 'The request could not be read.' } });
      return;
    }
    console.error(error);
    res.status(500).json({ error: { code: 'internal_error', message: 'Something went wrong on the server.' } });
  };
  app.use(onError);

  const httpServer = createServer(app);
  const io = createRealtime(httpServer, config, sessions);

  return {
    app,
    httpServer,
    io,
    sessions,
    topicRecognition,
    async close() {
      sessions.shutdown();
      await io.close();
    },
  };
}
