import request from 'supertest';
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { loadConfig } from '../src/config';
import { TranscriptError, type FetchTranscript } from '../src/services/transcripts';
import { createTestServer, resetDb, testConfig, type TestServer } from './helpers';

const segments = [
  { start: 1.5, duration: 2, text: 'சிவப்பு என்றால்' },
  { start: 65, duration: 3, text: 'நிறுத்து' },
];

describe('configuration', () => {
  it('finds the transcript helper next to the server, and picks a Python command', () => {
    const config = loadConfig({ TEACHER_PASSCODE: 'x' });
    expect(config.transcripts.transcriptScript).toMatch(/scripts[\\/]youtube_transcript\.py$/);
    expect(loadConfig({ TEACHER_PASSCODE: 'x', PYTHON_BIN: '/usr/bin/python3.12' }).transcripts.pythonBin).toBe('/usr/bin/python3.12');
  });
});

describe('transcripts', () => {
  let t: TestServer;
  const fetchTranscript = vi.fn<FetchTranscript>();

  beforeAll(async () => {
    t = await createTestServer(testConfig, fetchTranscript);
  });
  afterAll(() => t.close());
  beforeEach(async () => {
    await t.server.transcripts.idle();
    await resetDb(t.db);
    fetchTranscript.mockReset().mockResolvedValue({ language: 'ta', generated: true, segments });
  });

  const addResource = async (title: string, videoUrl: string | null) =>
    (await t.teacher.post('/api/resources', { title, videoUrl, language: 'ta', scriptText: videoUrl ? undefined : 'Script' })).body.data as { id: string };

  const confirmedLesson = async (topics: string[]) => {
    const lesson = (await t.teacher.post('/api/lessons', { topics })).body.data;
    await t.teacher.post(`/api/lessons/${lesson.id}/confirm`);
    return lesson as { id: string };
  };

  it('downloads a transcript in the background when a lesson selects the video, once', async () => {
    const resource = await addResource('Traffic Rules', 'https://www.youtube.com/watch?v=abcdef12345');
    await t.teacher.post('/api/lessons', { topics: ['Traffic Rules'] });
    await t.server.transcripts.idle();
    expect(fetchTranscript).toHaveBeenCalledWith('abcdef12345', 'ta');

    const transcript = (await t.teacher.get(`/api/resources/${resource.id}/transcript`)).body.data;
    expect(transcript).toEqual({ status: 'ready', language: 'ta', generated: true, segments, error: null });

    await t.teacher.post('/api/lessons', { topics: ['Traffic Rules'] });
    await t.server.transcripts.idle();
    await t.teacher.get(`/api/resources/${resource.id}/transcript`);
    expect(fetchTranscript).toHaveBeenCalledTimes(1);
  });

  it('downloads on first request if nothing fetched it earlier, and shares one download between requests', async () => {
    const resource = await addResource('Air', 'https://youtu.be/abcdef12345');
    const [a, b] = await Promise.all([
      t.teacher.get(`/api/resources/${resource.id}/transcript`),
      t.teacher.get(`/api/resources/${resource.id}/transcript`),
    ]);
    expect(a.body.data.segments).toEqual(segments);
    expect(b.body.data.segments).toEqual(segments);
    expect(fetchTranscript).toHaveBeenCalledTimes(1);
  });

  it('keeps a failure with its reason, and Fetch again tries once more', async () => {
    const resource = await addResource('Air', 'https://youtu.be/abcdef12345');
    fetchTranscript.mockRejectedValueOnce(new TranscriptError('This video has no transcript.'));
    const failed = (await t.teacher.get(`/api/resources/${resource.id}/transcript`)).body.data;
    expect(failed).toMatchObject({ status: 'failed', error: 'This video has no transcript.', segments: [] });
    expect((await t.teacher.get(`/api/resources/${resource.id}/transcript`)).body.data.status).toBe('failed');
    expect(fetchTranscript).toHaveBeenCalledTimes(1);

    expect((await t.teacher.post(`/api/resources/${resource.id}/transcript`)).body.data.status).toBe('ready');
  });

  it('hides unexpected errors behind a plain message', async () => {
    const resource = await addResource('Air', 'https://youtu.be/abcdef12345');
    fetchTranscript.mockRejectedValueOnce(new Error('socket hang up at internal.js:42'));
    const error = vi.spyOn(console, 'error').mockImplementation(() => undefined);
    const failed = (await t.teacher.get(`/api/resources/${resource.id}/transcript`)).body.data;
    error.mockRestore();
    expect(failed.error).toBe("The video's transcript could not be fetched. Try again later.");
  });

  it('has no transcript for resources without a YouTube video, and is teacher-only by resource', async () => {
    const resource = await addResource('Fractions', null);
    expect((await t.teacher.get(`/api/resources/${resource.id}/transcript`)).status).toBe(409);
    expect((await request(t.url).get(`/api/resources/${resource.id}/transcript`)).status).toBe(401);
    expect(fetchTranscript).not.toHaveBeenCalled();
  });

  it('lets students browse confirmed lessons and read each topic’s transcript without signing in', async () => {
    await addResource('Traffic Rules', 'https://www.youtube.com/watch?v=abcdef12345');
    await addResource('Fractions', null);
    const draft = (await t.teacher.post('/api/lessons', { topics: ['Fractions'], title: 'Draft lesson' })).body.data;
    const lesson = await confirmedLesson(['Traffic Rules', 'Fractions']);

    const list = (await request(t.url).get('/api/student/lessons')).body.data;
    expect(list).toEqual([{ id: lesson.id, title: 'Traffic Rules, Fractions', topicCount: 2 }]);
    const view = (await request(t.url).get(`/api/student/lessons/${lesson.id}`)).body.data;
    expect(view.topics[0]).toMatchObject({ number: 1, displayTitle: 'Traffic Rules', resource: { videoUrl: 'https://www.youtube.com/watch?v=abcdef12345' } });
    expect((await request(t.url).get(`/api/student/lessons/${draft.id}`)).status).toBe(404);

    const transcript = await request(t.url).get(`/api/student/lessons/${lesson.id}/topics/1/transcript`);
    expect(transcript.body.data.segments).toEqual(segments);
    expect((await request(t.url).get(`/api/student/lessons/${lesson.id}/topics/2/transcript`)).status).toBe(409);
    expect((await request(t.url).get(`/api/student/lessons/${lesson.id}/topics/3/transcript`)).status).toBe(404);
    expect((await request(t.url).get(`/api/student/lessons/${lesson.id}/topics/0/transcript`)).status).toBe(400);
  });

  it('gives students in a live session the current topic’s transcript by session code', async () => {
    await addResource('Traffic Rules', 'https://www.youtube.com/watch?v=abcdef12345');
    const lesson = await confirmedLesson(['Traffic Rules']);
    const session = (await t.teacher.post('/api/sessions', { lessonId: lesson.id })).body.data;
    const res = await request(t.url).get(`/api/student/session/${session.sessionCode.toLowerCase()}/topics/1/transcript`);
    expect(res.body.data).toMatchObject({ status: 'ready', segments });
    expect((await request(t.url).get('/api/student/session/ZZZZZZ/topics/1/transcript')).status).toBe(404);
  });
});
