import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import request from 'supertest';
import { loadConfig } from '../src/config';
import { buildPlanPrompt, geminiWriter, PlanError, readPlanResponse, type LessonPlanDeps, type PlanRequest } from '../src/services/lessonPlans';
import { createTestServer, resetDb, testConfig, type TestServer } from './helpers';

const fiveParts = Array.from({ length: 5 }, (_, i) => ({ title: `Title ${i + 1}`, content: `- Teach thing ${i + 1}` }));
const reply = (body: object) => JSON.stringify(body);

describe('reading Gemini replies', () => {
  it('accepts exactly five parts', () => {
    expect(readPlanResponse(reply({ usable: true, parts: fiveParts }))).toEqual(fiveParts);
  });

  it('turns an unusable transcript into a clear message, never an invented plan', () => {
    expect(() => readPlanResponse(reply({ usable: false, reason: 'Mostly music', parts: [] }))).toThrow(
      "The video's automatic transcript is too unclear to make a plan from: Mostly music",
    );
  });

  it.each([
    ['four parts', reply({ usable: true, parts: fiveParts.slice(0, 4) })],
    ['not JSON', 'Here is your plan!'],
    ['wrong shape', reply({ plan: 'x' })],
  ])('rejects %s', (_label, text) => {
    expect(() => readPlanResponse(text)).toThrow(PlanError);
  });
});

describe('Gemini request', () => {
  const planRequest: PlanRequest = { title: 'Traffic Rules', subject: 'Grade 4 EVS', transcript: { language: 'ta', generated: true, segments: [{ start: 0, duration: 2, text: 'சிவப்பு என்றால்' }, { start: 2, duration: 2, text: 'நிறுத்து' }] } };

  it('asks for five English parts grounded in the transcript', () => {
    const prompt = buildPlanPrompt(planRequest);
    expect(prompt).toContain('"Traffic Rules" (Grade 4 EVS)');
    expect(prompt).toContain('lesson plan in English');
    expect(prompt).toContain('exactly 5 parts');
    expect(prompt).toContain('Do not add facts');
    expect(prompt).toContain('சிவப்பு என்றால் நிறுத்து');
  });

  it('sends the key in a header and reads the structured reply', async () => {
    const fetchImpl = vi.fn(async () => new Response(JSON.stringify({ candidates: [{ content: { parts: [{ text: reply({ usable: true, parts: fiveParts }) }] } }] })));
    const parts = await geminiWriter('secret-key', 'gemini-test', fetchImpl as typeof fetch).write(planRequest);
    expect(parts).toHaveLength(5);
    const [url, init] = fetchImpl.mock.calls[0] as unknown as [string, RequestInit];
    expect(url).toContain('/models/gemini-test:generateContent');
    expect(url).not.toContain('secret-key');
    expect((init.headers as Record<string, string>)['x-goog-api-key']).toBe('secret-key');
  });

  it('reports Gemini errors in words a teacher can act on', async () => {
    const fetchImpl = async () => new Response(JSON.stringify({ error: { message: 'API key not valid.' } }), { status: 400 });
    await expect(geminiWriter('bad', 'gemini-test', fetchImpl as typeof fetch).write(planRequest)).rejects.toThrow('Gemini returned an error (400): API key not valid.');
  });
});

describe('configuration', () => {
  it('reads the Gemini key and model, with a default model', () => {
    const config = loadConfig({ TEACHER_PASSCODE: 'x', GEMINI_API_KEY: 'k' });
    expect(config.lessonPlans).toMatchObject({ geminiApiKey: 'k', geminiModel: 'gemini-2.5-flash' });
    expect(config.lessonPlans.transcriptScript).toMatch(/scripts[\\/]youtube_transcript\.py$/);
    expect(loadConfig({ TEACHER_PASSCODE: 'x' }).lessonPlans.geminiApiKey).toBeNull();
  });
});

describe('lesson plans in the app', () => {
  let t: TestServer;
  const fetchTranscript = vi.fn<LessonPlanDeps['fetchTranscript']>();
  const write = vi.fn<(r: PlanRequest) => Promise<typeof fiveParts>>();
  const deps: LessonPlanDeps = { fetchTranscript, writer: { model: 'fake-model', write } };

  beforeAll(async () => {
    t = await createTestServer(testConfig, deps);
  });
  afterAll(() => t.close());
  beforeEach(async () => {
    await t.server.plans.idle();
    await resetDb(t.db);
    fetchTranscript.mockReset().mockResolvedValue({ language: 'ta', generated: true, segments: [{ start: 1.5, duration: 2, text: 'transcript' }, { start: 65, duration: 3, text: 'text' }] });
    write.mockReset().mockResolvedValue(fiveParts);
  });

  const addResource = async (title: string, videoUrl: string | null, language = 'ta') =>
    (await t.teacher.post('/api/resources', { title, videoUrl, language, scriptText: videoUrl ? undefined : 'Script' })).body.data as { id: string };

  it('makes a plan when a lesson selects a YouTube video, and reuses it', async () => {
    const resource = await addResource('Traffic Rules', 'https://www.youtube.com/watch?v=abcdef12345');
    await t.teacher.post('/api/lessons', { topics: ['Traffic Rules'] });
    await t.server.plans.idle();

    const plan = (await t.teacher.get(`/api/resources/${resource.id}/plan`)).body.data;
    expect(plan).toMatchObject({ status: 'ready', transcriptLanguage: 'ta', error: null });
    expect(plan.parts).toEqual(fiveParts);
    expect(fetchTranscript).toHaveBeenCalledWith('abcdef12345', 'ta');
    expect(write.mock.calls[0]![0]).toMatchObject({ title: 'Traffic Rules', transcript: { language: 'ta' } });

    await t.teacher.post('/api/lessons', { topics: ['Traffic Rules'] });
    await t.server.plans.idle();
    expect(write).toHaveBeenCalledTimes(1);
  });

  it('stores a failure with its reason, and Try again makes a new plan', async () => {
    const resource = await addResource('Air', 'https://youtu.be/abcdef12345');
    fetchTranscript.mockRejectedValueOnce(new PlanError('This video has no transcript.'));
    await t.teacher.post('/api/lessons', { topics: ['Air'] });
    await t.server.plans.idle();
    expect((await t.teacher.get(`/api/resources/${resource.id}/plan`)).body.data).toMatchObject({ status: 'failed', error: 'This video has no transcript.', parts: [] });

    expect((await t.teacher.post(`/api/resources/${resource.id}/plan`)).body.data.status).toBe('pending');
    await t.server.plans.idle();
    expect((await t.teacher.get(`/api/resources/${resource.id}/plan`)).body.data.status).toBe('ready');
  });

  it('has no plan for resources without a YouTube video', async () => {
    const resource = await addResource('Fractions', null);
    expect((await t.teacher.get(`/api/resources/${resource.id}/plan`)).body.data).toBeNull();
    expect((await t.teacher.post(`/api/resources/${resource.id}/plan`)).status).toBe(409);
    expect(fetchTranscript).not.toHaveBeenCalled();
  });

  it('is teacher-only for the plan endpoints', async () => {
    const resource = await addResource('Birds', 'https://youtu.be/abcdef12345');
    expect((await request(t.url).get(`/api/resources/${resource.id}/plan`)).status).toBe(401);
  });

  it('shows students confirmed lessons only, with each topic’s video and plan, without signing in', async () => {
    await addResource('Traffic Rules', 'https://www.youtube.com/watch?v=abcdef12345');
    await addResource('Fractions', null);
    const draft = (await t.teacher.post('/api/lessons', { topics: ['Fractions'], title: 'Draft lesson' })).body.data;
    const lesson = (await t.teacher.post('/api/lessons', { topics: ['Traffic Rules', 'Fractions'], title: 'Road safety' })).body.data;
    await t.teacher.post(`/api/lessons/${lesson.id}/confirm`);
    await t.server.plans.idle();

    const list = (await request(t.url).get('/api/student/lessons')).body.data;
    expect(list).toEqual([{ id: lesson.id, title: 'Road safety', topicCount: 2 }]);

    const view = (await request(t.url).get(`/api/student/lessons/${lesson.id}`)).body.data;
    expect(view.topics[0]).toMatchObject({ number: 1, displayTitle: 'Traffic Rules', resource: { videoUrl: 'https://www.youtube.com/watch?v=abcdef12345' }, plan: { status: 'ready' } });
    expect(view.topics[0].plan.parts).toHaveLength(5);
    expect(view.topics[1]).toMatchObject({ number: 2, displayTitle: 'Fractions', plan: null });
    expect((await request(t.url).get(`/api/student/lessons/${draft.id}`)).status).toBe(404);
  });

  it('gives students the timestamped transcript, downloaded once and reused for the plan', async () => {
    await addResource('Traffic Rules', 'https://www.youtube.com/watch?v=abcdef12345');
    await addResource('Fractions', null);
    const lesson = (await t.teacher.post('/api/lessons', { topics: ['Traffic Rules', 'Fractions'] })).body.data;
    await t.teacher.post(`/api/lessons/${lesson.id}/confirm`);
    await t.server.plans.idle();

    const first = await request(t.url).get(`/api/student/lessons/${lesson.id}/topics/1/transcript`);
    expect(first.body.data).toEqual({ language: 'ta', generated: true, segments: [{ start: 1.5, duration: 2, text: 'transcript' }, { start: 65, duration: 3, text: 'text' }] });
    await request(t.url).get(`/api/student/lessons/${lesson.id}/topics/1/transcript`);
    expect(fetchTranscript).toHaveBeenCalledTimes(1);

    expect((await request(t.url).get(`/api/student/lessons/${lesson.id}/topics/2/transcript`)).status).toBe(409);
    expect((await request(t.url).get(`/api/student/lessons/${lesson.id}/topics/3/transcript`)).status).toBe(404);
    expect((await request(t.url).get(`/api/student/lessons/${lesson.id}/topics/0/transcript`)).status).toBe(400);
  });

  it('explains when a transcript cannot be downloaded', async () => {
    const resource = await addResource('Air', 'https://youtu.be/abcdef12345');
    fetchTranscript.mockRejectedValue(new PlanError('This video has no transcript.'));
    const lesson = (await t.teacher.post('/api/lessons', { topics: ['Air'] })).body.data;
    await t.teacher.post(`/api/lessons/${lesson.id}/confirm`);
    await t.server.plans.idle();
    const res = await request(t.url).get(`/api/student/lessons/${lesson.id}/topics/1/transcript`);
    expect(res.status).toBe(409);
    expect(res.body.error.message).toBe('This video has no transcript.');
    expect((await t.teacher.get(`/api/resources/${resource.id}/plan`)).body.data.status).toBe('failed');
  });
});

describe('without a Gemini key', () => {
  let t: TestServer;
  beforeAll(async () => {
    t = await createTestServer(testConfig, { fetchTranscript: async () => ({ language: 'en', generated: true, segments: [{ start: 0, duration: 1, text: 'x' }] }), writer: null });
  });
  afterAll(() => t.close());

  it('says how to add the key', async () => {
    await resetDb(t.db);
    const resource = (await t.teacher.post('/api/resources', { title: 'Air', videoUrl: 'https://youtu.be/abcdef12345' })).body.data;
    await t.teacher.get(`/api/resources/${resource.id}/plan`);
    await t.server.plans.idle();
    const plan = (await t.teacher.get(`/api/resources/${resource.id}/plan`)).body.data;
    expect(plan.status).toBe('failed');
    expect(plan.error).toContain('GEMINI_API_KEY');
    expect(plan.transcriptLanguage).toBe('en');

    // After a restart with a key, the plan is made without anyone pressing Try again.
    const withKey = await createTestServer(testConfig, {
      fetchTranscript: async () => ({ language: 'en', generated: true, segments: [{ start: 0, duration: 1, text: 'x' }] }),
      writer: { model: 'fake', write: async () => fiveParts },
    });
    try {
      expect((await withKey.teacher.get(`/api/resources/${resource.id}/plan`)).body.data.status).toBe('pending');
      await withKey.server.plans.idle();
      expect((await withKey.teacher.get(`/api/resources/${resource.id}/plan`)).body.data.status).toBe('ready');
    } finally {
      await withKey.close();
    }
  });
});
