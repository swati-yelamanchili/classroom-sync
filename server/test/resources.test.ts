import request from 'supertest';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { createTestServer, resetDb, seedResources, type TestServer } from './helpers';

let t: TestServer;
beforeAll(async () => {
  t = await createTestServer();
});
afterAll(() => t.close());
beforeEach(() => resetDb(t.db));

const importResources = (format: 'csv' | 'json', content: string, dryRun = false) =>
  t.teacher.post('/api/resources/import', { format, content, dryRun });

describe('access control', () => {
  it('rejects anonymous access to every teacher endpoint', async () => {
    const cases: [('get' | 'post' | 'patch' | 'delete'), string][] = [
      ['get', '/api/resources'],
      ['post', '/api/resources'],
      ['post', '/api/resources/import'],
      ['get', '/api/lessons'],
      ['post', '/api/lessons'],
      ['patch', '/api/lessons/x'],
      ['post', '/api/sessions'],
      ['get', '/api/sessions/x'],
      ['post', '/api/sessions/x/start'],
      ['post', '/api/sessions/x/topic'],
      ['post', '/api/sessions/x/end'],
    ];
    for (const [method, path] of cases) {
      const res = await request(t.url)[method](path).send({});
      expect(res.status, `${method} ${path}`).toBe(401);
    }
  });
  it('rejects a wrong passcode and a forged cookie', async () => {
    expect((await request(t.url).post('/api/auth/login').send({ passcode: 'nope' })).status).toBe(401);
    const forged = Buffer.from(JSON.stringify({ role: 'teacher', exp: Date.now() + 1e6 })).toString('base64url');
    const res = await request(t.url).get('/api/lessons').set('Cookie', `aac_teacher=${forged}.AAAA`);
    expect(res.status).toBe(401);
  });
  it('sets an httpOnly, SameSite cookie', async () => {
    const res = await request(t.url).post('/api/auth/login').send({ passcode: 'test-passcode' });
    const header = res.headers['set-cookie']![0]!;
    expect(header).toContain('HttpOnly');
    expect(header).toContain('SameSite=Strict');
  });
});

describe('network information', () => {
  it('is teacher-only and lists no loopback address', async () => {
    expect((await request(t.url).get('/api/network')).status).toBe(401);
    const { data } = (await t.teacher.get('/api/network')).body;
    expect(data.publicBaseUrl).toBeNull();
    expect(data.lanAddresses).not.toContain('127.0.0.1');
  });
});

describe('manual resource entry', () => {
  it('stores a resource and returns it', async () => {
    const res = await t.teacher.post('/api/resources', { title: 'Rain', videoUrl: 'https://example.com/rain', keywords: ['water'] });
    expect(res.status).toBe(201);
    expect(res.body.data).toMatchObject({ title: 'Rain', keywords: ['water'], provenance: 'unverified' });
  });
  it.each([
    [{ title: '', videoUrl: 'https://example.com/a' }, 'Title'],
    [{ title: 'A', videoUrl: 'javascript:alert(1)' }, 'http'],
    [{ title: 'A' }, 'video URL or a script'],
    [{ title: 'A', scriptText: 'x', provenance: 'verified' }, 'source'],
    [{ title: 'A', scriptText: 'x', provenance: 'official' }, 'Provenance'],
  ])('rejects %j', async (body, message) => {
    const res = await t.teacher.post('/api/resources', body);
    expect(res.status).toBe(400);
    expect(res.body.error.message).toContain(message);
  });
  it('allows verified only with stated provenance', async () => {
    const res = await t.teacher.post('/api/resources', {
      title: 'A', scriptText: 'x', provenance: 'verified', sourceOrganisation: 'Org', sourceReference: 'Ref',
    });
    expect(res.status).toBe(201);
  });
  it('prevents duplicates by title and by video URL', async () => {
    await t.teacher.post('/api/resources', { title: 'Rain', videoUrl: 'https://example.com/rain' });
    expect((await t.teacher.post('/api/resources', { title: 'RAIN!', scriptText: 'x' })).status).toBe(409);
    expect((await t.teacher.post('/api/resources', { title: 'Other', videoUrl: 'https://example.com/rain' })).status).toBe(409);
  });
  it('searches the library', async () => {
    await seedResources(t, ['Addition', 'Subtraction']);
    const res = await t.teacher.get('/api/resources?q=addit');
    expect(res.body.data.map((r: { title: string }) => r.title)).toEqual(['Addition']);
  });
  it('blocks deleting a resource used by an open session, but detaches it otherwise', async () => {
    const [resource] = await seedResources(t, ['Addition']);
    const lesson = (await t.teacher.post('/api/lessons', { topics: ['Addition'] })).body.data;
    await t.teacher.post(`/api/lessons/${lesson.id}/confirm`);
    const session = (await t.teacher.post('/api/sessions', { lessonId: lesson.id })).body.data;
    expect((await t.teacher.delete(`/api/resources/${resource!.id}`)).status).toBe(409);
    await t.teacher.post(`/api/sessions/${session.id}/end`);
    expect((await t.teacher.delete(`/api/resources/${resource!.id}`)).status).toBe(204);
    const after = (await t.teacher.get(`/api/lessons/${lesson.id}`)).body.data;
    expect(after.topics[0]).toMatchObject({ resource: null, matchStatus: 'unresolved' });
  });
});

describe('import', () => {
  const script = 'Line one.\n\n  Indented line, with "quotes", commas and <b>markup</b>.\nTrailing spaces stay.   \n';

  it('imports JSON and preserves script text byte-for-byte', async () => {
    const res = await importResources('json', JSON.stringify([{ title: 'A', scriptText: script, keywords: ['k1', 'k2'] }]));
    expect(res.body.data).toMatchObject({ totalRows: 1, created: 1, errors: [], duplicates: [] });
    const [stored] = (await t.teacher.get('/api/resources')).body.data;
    expect(stored.scriptText).toBe(script);
    expect(stored.keywords).toEqual(['k1', 'k2']);
  });

  it('imports CSV with multiline quoted scripts and semicolon lists, ignoring a BOM', async () => {
    const quoted = script.replaceAll('"', '""');
    const csv = `﻿title,aliases,scriptText,curriculumOrder,provenance,subject\nA,one;two,"${quoted}",3,,\n`;
    const res = await importResources('csv', csv);
    expect(res.body.data).toMatchObject({ created: 1, errors: [] });
    const [stored] = (await t.teacher.get('/api/resources')).body.data;
    expect(stored.scriptText).toBe(script);
    expect(stored).toMatchObject({ aliases: ['one', 'two'], curriculumOrder: 3, provenance: 'unverified', subject: null });
  });

  it('imports the good rows and reports each bad row with its file row number', async () => {
    const csv = [
      'title,videoUrl,scriptText',
      'Good,https://example.com/good,',
      ',https://example.com/x,',
      'BadUrl,javascript:alert(1),',
      'NoContent,,',
    ].join('\n');
    const report = (await importResources('csv', csv)).body.data;
    expect(report.created).toBe(1);
    expect(report.errors.map((e: { row: number }) => e.row)).toEqual([3, 4, 5]);
  });

  it('skips duplicates within the file and against the library', async () => {
    await t.teacher.post('/api/resources', { title: 'Existing', scriptText: 'x' });
    const report = (
      await importResources('json', JSON.stringify([
        { title: 'Existing', scriptText: 'y' },
        { title: 'New', scriptText: 'y' },
        { title: 'new', scriptText: 'y' },
      ]))
    ).body.data;
    expect(report.created).toBe(1);
    expect(report.duplicates).toHaveLength(2);
    expect(report.duplicates[1].reason).toContain('row 2');
  });

  it('writes nothing on a dry run', async () => {
    const report = (await importResources('json', JSON.stringify([{ title: 'A', scriptText: 'x' }]), true)).body.data;
    expect(report).toMatchObject({ dryRun: true, created: 0, valid: [{ row: 1, title: 'A' }] });
    expect((await t.teacher.get('/api/resources')).body.data).toEqual([]);
  });

  it('never upgrades provenance on import', async () => {
    const report = (await importResources('json', JSON.stringify([{ title: 'A', scriptText: 'x', provenance: 'verified' }]))).body.data;
    expect(report.created).toBe(0);
    expect(report.errors[0].message).toContain('source');
  });

  it.each([
    ['json', 'not json'],
    ['json', '{"a":1}'],
    ['csv', 'name,video\nA,B'],
  ] as const)('rejects a malformed %s file', async (format, content) => {
    const res = await importResources(format, content);
    expect(res.status).toBe(400);
    expect(res.body.error.code).toBe('invalid_file');
  });
});
