import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { createTestServer, resetDb, seedResources, type TestServer } from './helpers';

let t: TestServer;
beforeAll(async () => {
  t = await createTestServer();
});
afterAll(() => t.close());
beforeEach(() => resetDb(t.db));

const createLesson = async (topics: string[], title?: string) =>
  (await t.teacher.post('/api/lessons', { topics, title })).body.data;

const positions = (lesson: { topics: { position: number; displayTitle: string }[] }) =>
  lesson.topics.map((topic) => `${topic.position + 1}:${topic.displayTitle}`);

describe('lesson creation', () => {
  it('maps topics to library resources and keeps teacher order', async () => {
    await seedResources(t, ['Addition', 'Subtraction', 'Multiplication']);
    const lesson = await createLesson(['Multiplication', 'addition', 'Subtraction']);
    expect(positions(lesson)).toEqual(['1:Multiplication', '2:addition', '3:Subtraction']);
    expect(lesson.topics[0]).toMatchObject({ matchStatus: 'exact', resource: { title: 'Multiplication' } });
    expect(lesson.topics[1]).toMatchObject({ matchStatus: 'normalized', resource: { title: 'Addition' } });
    expect(lesson.status).toBe('draft');
  });

  it('does not invent a resource for an unmatched topic', async () => {
    await seedResources(t, ['Addition']);
    const lesson = await createLesson(['Volcanoes', 'Addition']);
    const unresolved = lesson.topics.find((topic: { displayTitle: string }) => topic.displayTitle === 'Volcanoes');
    expect(unresolved).toMatchObject({
      resource: null,
      matchStatus: 'unresolved',
      matchExplanation: 'No matching resource found in the current library.',
    });
    expect((await t.teacher.get('/api/resources')).body.data).toHaveLength(1);
  });

  it('drops repeated topics and says so', async () => {
    await seedResources(t, ['Addition']);
    const lesson = await createLesson(['Addition', ' addition ', '', 'Addition!']);
    expect(lesson.topics).toHaveLength(1);
    expect(lesson.notices).toHaveLength(2);
  });

  it('warns when two topics resolve to the same resource', async () => {
    await t.teacher.post('/api/resources', { title: 'Addition', aliases: ['Adding'], scriptText: 'x' });
    const lesson = await createLesson(['Addition', 'Adding']);
    expect(lesson.topics).toHaveLength(2);
    expect(lesson.notices[0]).toContain('both use');
  });

  it('rejects an empty topic list', async () => {
    expect((await t.teacher.post('/api/lessons', { topics: [] })).status).toBe(400);
    expect((await t.teacher.post('/api/lessons', { topics: ['  ', ''] })).status).toBe(400);
  });
});

describe('sequence editing', () => {
  it('reorders with correct final numbering, and persists', async () => {
    await seedResources(t, ['A1', 'B1', 'C1']);
    const lesson = await createLesson(['A1', 'B1', 'C1']);
    const [a, b, c] = lesson.topics;
    await t.teacher.patch(`/api/lessons/${lesson.id}`, { topics: [{ id: c.id }, { id: a.id }, { id: b.id }] });
    const stored = (await t.teacher.get(`/api/lessons/${lesson.id}`)).body.data;
    expect(positions(stored)).toEqual(['1:C1', '2:A1', '3:B1']);
    expect(stored.topics[0].resource.title).toBe('C1');
  });

  it('removes a topic and renumbers', async () => {
    await seedResources(t, ['A1', 'B1', 'C1']);
    const lesson = await createLesson(['A1', 'B1', 'C1']);
    const [a, , c] = lesson.topics;
    const patched = (await t.teacher.patch(`/api/lessons/${lesson.id}`, { topics: [{ id: a.id }, { id: c.id }] })).body.data;
    expect(positions(patched)).toEqual(['1:A1', '2:C1']);
  });

  it('replaces a resource with another existing one and records it as manual', async () => {
    const [, other] = await seedResources(t, ['A1', 'B1']);
    const lesson = await createLesson(['A1']);
    const patched = (await t.teacher.patch(`/api/lessons/${lesson.id}`, { topics: [{ id: lesson.topics[0].id, resourceId: other!.id }] })).body.data;
    expect(patched.topics[0]).toMatchObject({ matchStatus: 'manual', resource: { title: 'B1' } });
  });

  it('refuses a resource that does not exist', async () => {
    const lesson = await createLesson(['A1']);
    const res = await t.teacher.patch(`/api/lessons/${lesson.id}`, { topics: [{ id: lesson.topics[0].id, resourceId: 'made-up' }] });
    expect(res.status).toBe(422);
  });

  it('can leave a topic unresolved deliberately', async () => {
    await seedResources(t, ['A1']);
    const lesson = await createLesson(['A1']);
    const patched = (await t.teacher.patch(`/api/lessons/${lesson.id}`, { topics: [{ id: lesson.topics[0].id, resourceId: null }] })).body.data;
    expect(patched.topics[0]).toMatchObject({ resource: null, matchStatus: 'unresolved' });
  });

  it('matches a newly added topic', async () => {
    await seedResources(t, ['A1', 'B1']);
    const lesson = await createLesson(['A1']);
    const patched = (
      await t.teacher.patch(`/api/lessons/${lesson.id}`, { topics: [{ id: lesson.topics[0].id }, { requestedTopic: 'B1' }] })
    ).body.data;
    expect(patched.topics[1]).toMatchObject({ matchStatus: 'exact', resource: { title: 'B1' }, enteredPosition: 1 });
  });

  it('stores per-topic durations and validates them', async () => {
    const lesson = await createLesson(['A1']);
    const id = lesson.topics[0].id;
    expect(lesson.topics[0].estimatedDurationSeconds).toBe(60);
    const patched = (await t.teacher.patch(`/api/lessons/${lesson.id}`, { topics: [{ id, estimatedDurationSeconds: 90 }] })).body.data;
    expect(patched.topics[0].estimatedDurationSeconds).toBe(90);
    expect((await t.teacher.patch(`/api/lessons/${lesson.id}`, { topics: [{ id, estimatedDurationSeconds: 0 }] })).status).toBe(400);
  });

  it('returns a confirmed lesson to draft when the sequence changes', async () => {
    const lesson = await createLesson(['A1']);
    expect((await t.teacher.post(`/api/lessons/${lesson.id}/confirm`)).body.data.status).toBe('confirmed');
    const patched = (await t.teacher.patch(`/api/lessons/${lesson.id}`, { topics: [{ id: lesson.topics[0].id, estimatedDurationSeconds: 5 }] })).body.data;
    expect(patched.status).toBe('draft');
  });

  it('re-checks the library after new resources arrive, keeping manual choices', async () => {
    const [chosen] = await seedResources(t, ['Chosen']);
    const lesson = await createLesson(['Volcanoes', 'Rivers']);
    await t.teacher.patch(`/api/lessons/${lesson.id}`, {
      topics: [{ id: lesson.topics[0].id }, { id: lesson.topics[1].id, resourceId: chosen!.id }],
    });
    await seedResources(t, ['Volcanoes', 'Rivers']);
    const rematched = (await t.teacher.post(`/api/lessons/${lesson.id}/match-resources`)).body.data;
    expect(rematched.topics[0]).toMatchObject({ matchStatus: 'exact', resource: { title: 'Volcanoes' } });
    expect(rematched.topics[1]).toMatchObject({ matchStatus: 'manual', resource: { title: 'Chosen' } });
  });

  it('duplicates a lesson for reuse', async () => {
    await seedResources(t, ['A1']);
    const lesson = await createLesson(['A1'], 'Monday');
    const copy = (await t.teacher.post(`/api/lessons/${lesson.id}/duplicate`)).body.data;
    expect(copy).toMatchObject({ title: 'Monday (copy)', status: 'draft' });
    expect(copy.id).not.toBe(lesson.id);
    expect(copy.topics[0].resource.title).toBe('A1');
  });
});

describe('lesson and session guards', () => {
  it('needs confirmation before a session can be created', async () => {
    const lesson = await createLesson(['A1']);
    const res = await t.teacher.post('/api/sessions', { lessonId: lesson.id });
    expect(res.status).toBe(409);
    expect(res.body.error.code).toBe('lesson_not_confirmed');
  });

  it('locks the sequence while a session is open and unlocks it afterwards', async () => {
    const lesson = await createLesson(['A1']);
    await t.teacher.post(`/api/lessons/${lesson.id}/confirm`);
    const session = (await t.teacher.post('/api/sessions', { lessonId: lesson.id })).body.data;
    const update = { topics: [{ id: lesson.topics[0].id, estimatedDurationSeconds: 5 }] };
    expect((await t.teacher.patch(`/api/lessons/${lesson.id}`, update)).status).toBe(409);
    expect((await t.teacher.post('/api/sessions', { lessonId: lesson.id })).status).toBe(409);
    await t.teacher.post(`/api/sessions/${session.id}/end`);
    expect((await t.teacher.patch(`/api/lessons/${lesson.id}`, update)).status).toBe(200);
  });
});
