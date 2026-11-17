/**
 * Measurements for the evaluation report. Run with `npm run evaluate`; excluded from `npm run test:e2e`.
 * Writes evaluation/results.json, evaluation/results.md and screenshots under evaluation/screenshots.
 *
 * Phones, tablets and slow networks are EMULATED in desktop Chrome (viewport, touch, user agent and
 * Chrome DevTools network throttling). DevTools throttling does not slow WebSockets, so the same
 * latency is added to each socket message here. This is not a substitute for real devices; see EVALUATION.md.
 */
import fs from 'node:fs';
import path from 'node:path';
import { devices, expect, test, type Browser, type BrowserContextOptions, type Page } from '@playwright/test';
import { createLessonToLive, say, teacherContext } from './helpers';

const OUT = path.resolve(__dirname, '../evaluation');
const SHOTS = path.join(OUT, 'screenshots');
const TOPICS = ['Addition', 'Subtraction', 'Multiplication', 'Division', 'Fractions'];
const TRIALS = 20;

// Lighthouse's throttling presets, stated so the numbers can be reproduced.
const NETWORKS = {
  'Fast 3G': { latency: 150, downloadThroughput: (1.6 * 1024 * 1024) / 8, uploadThroughput: (750 * 1024) / 8 },
  'Slow 3G': { latency: 400, downloadThroughput: (400 * 1024) / 8, uploadThroughput: (400 * 1024) / 8 },
} as const;
type NetworkName = keyof typeof NETWORKS | 'No throttling';

const results: Record<string, unknown> = { date: new Date().toISOString(), trialsPerScenario: TRIALS, scenarios: [] as unknown[] };

test.describe.configure({ mode: 'serial' });
test.setTimeout(240_000);

test.beforeAll(() => fs.mkdirSync(SHOTS, { recursive: true }));

test.afterAll(() => {
  fs.writeFileSync(path.join(OUT, 'results.json'), `${JSON.stringify(results, null, 2)}\n`);
  fs.writeFileSync(path.join(OUT, 'results.md'), toMarkdown());
});

function stats(values: number[]) {
  const sorted = [...values].sort((a, b) => a - b);
  const pick = (q: number) => sorted[Math.min(sorted.length - 1, Math.ceil(q * sorted.length) - 1)]!;
  return { n: sorted.length, median: pick(0.5), p95: pick(0.95), max: sorted[sorted.length - 1]!, min: sorted[0]! };
}

/** Records, in the student's page, the wall-clock moment the topic title changes. */
async function openStudent(browser: Browser, code: string, options: BrowserContextOptions, network: NetworkName) {
  const context = await browser.newContext(options);
  await context.addInitScript(() => {
    const changes: Array<{ text: string; at: number }> = [];
    (window as unknown as { __changes: typeof changes }).__changes = changes;
    let last = '';
    new MutationObserver(() => {
      const text = document.querySelector('[data-testid="student-topic-title"]')?.textContent ?? '';
      if (text && text !== last) {
        last = text;
        changes.push({ text, at: Date.now() });
      }
    }).observe(document, { subtree: true, childList: true, characterData: true });
  });
  const page = await context.newPage();
  const cdp = await context.newCDPSession(page);
  await cdp.send('Network.enable');
  let bytes = 0;
  cdp.on('Network.loadingFinished', (event) => (bytes += event.encodedDataLength));
  if (network !== 'No throttling') {
    const { latency } = NETWORKS[network];
    await cdp.send('Network.emulateNetworkConditions', { offline: false, ...NETWORKS[network] });
    // Half the round trip each way; equal delays keep messages in order.
    await page.routeWebSocket(/socket\.io/, (ws) => {
      const server = ws.connectToServer();
      ws.onMessage((message) => setTimeout(() => server.send(message), latency / 2));
      server.onMessage((message) => setTimeout(() => ws.send(message), latency / 2));
    });
  }
  const started = Date.now();
  await page.goto(`/student/${code}`);
  await expect(page.getByTestId('student-topic-title')).toBeVisible({ timeout: 60_000 });
  return { context, page, cdp, loadMs: Date.now() - started, loadKb: Math.round(bytes / 1024) };
}

const changeCount = (page: Page) => page.evaluate(() => (window as unknown as { __changes: unknown[] }).__changes.length);

/** When the title first became `text` after the first `since` recorded changes. */
async function changeAfter(page: Page, since: number, text: string): Promise<number> {
  const find = () =>
    page.evaluate(
      ([from, t]) => (window as unknown as { __changes: Array<{ text: string; at: number }> }).__changes.slice(from as number).find((c) => c.text === t)?.at ?? null,
      [since, text] as const,
    );
  await expect.poll(find, { timeout: 30_000 }).not.toBeNull();
  return (await find())!;
}

/** Moves through the topics TRIALS times and returns how long each change took to show on the student page. */
async function measureChanges(teacher: Page, student: Page, trigger: (topicNumber: number) => Promise<void>) {
  const delays: number[] = [];
  let correct = 0;
  let current = Number((await teacher.getByTestId('current-topic-number').textContent())!.match(/Topic (\d+)/)![1]);
  for (let i = 0; i < TRIALS; i += 1) {
    const target = (current % TOPICS.length) + 1;
    const before = await changeCount(student);
    const sentAt = Date.now();
    await trigger(target);
    const shownAt = await changeAfter(student, before, TOPICS[target - 1]!);
    const after = await changeCount(student);
    if (after === before + 1) correct += 1;
    delays.push(shownAt - sentAt);
    current = target;
    await student.waitForTimeout(150);
  }
  return { delays, correct };
}

const STUDENT_SETUPS: Array<{ name: string; options: BrowserContextOptions; network: NetworkName; shot?: string }> = [
  { name: 'Desktop', options: { viewport: { width: 1366, height: 768 } }, network: 'No throttling', shot: 'student-desktop.png' },
  { name: 'Android phone (Pixel 7, emulated)', options: { ...devices['Pixel 7'] }, network: 'No throttling', shot: 'student-phone.png' },
  { name: 'Android tablet (Galaxy Tab S4, emulated)', options: { ...devices['Galaxy Tab S4'] }, network: 'No throttling', shot: 'student-tablet.png' },
  { name: 'Android phone on Fast 3G', options: { ...devices['Pixel 7'] }, network: 'Fast 3G' },
  { name: 'Android phone on Slow 3G', options: { ...devices['Pixel 7'] }, network: 'Slow 3G' },
];

for (const setup of STUDENT_SETUPS) {
  test(`sync delay: ${setup.name}`, async ({ browser }) => {
    const { page: teacher } = await teacherContext(browser);
    const code = await createLessonToLive(teacher, TOPICS);
    await teacher.getByRole('button', { name: 'Start session' }).click();
    const student = await openStudent(browser, code, setup.options, setup.network);

    const run = await measureChanges(teacher, student.page, async (n) => {
      await teacher.getByTestId(`jump-${n}`).click();
    });
    const overflow = await student.page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);

    if (setup.shot) await student.page.screenshot({ path: path.join(SHOTS, setup.shot), fullPage: true });
    (results.scenarios as unknown[]).push({
      kind: 'student device and network',
      name: setup.name,
      network: setup.network,
      pageLoadMs: student.loadMs,
      pageLoadKb: student.loadKb,
      syncDelayMs: stats(run.delays),
      correctUpdates: `${run.correct}/${TRIALS}`,
      horizontalOverflowPx: overflow,
    });
    expect(run.correct).toBe(TRIALS);
    expect(overflow).toBe(0);
  });
}

test('sync delay: voice command path (scripted recognition engine)', async ({ browser }) => {
  const { page: teacher } = await teacherContext(browser);
  const code = await createLessonToLive(teacher, TOPICS);
  await teacher.getByRole('button', { name: 'Start session' }).click();
  const student = await openStudent(browser, code, { ...devices['Pixel 7'] }, 'No throttling');
  await teacher.getByRole('button', { name: 'Enable microphone' }).click();
  await teacher.waitForFunction(() => window.__speech.active !== null);

  const run = await measureChanges(teacher, student.page, async (n) => {
    await say(teacher, `Start Topic ${n}`);
    await teacher.waitForTimeout(0);
  });
  (results.scenarios as unknown[]).push({
    kind: 'voice pipeline',
    name: 'Final transcript to student screen (Android phone, emulated)',
    network: 'No throttling',
    syncDelayMs: stats(run.delays),
    correctUpdates: `${run.correct}/${TRIALS}`,
    note: 'Excludes the speech engine itself: it starts when the final transcript is delivered.',
  });
  expect(run.correct).toBe(TRIALS);
});

test('recovery after the student loses its connection', async ({ browser }) => {
  const { page: teacher } = await teacherContext(browser);
  const code = await createLessonToLive(teacher, TOPICS);
  await teacher.getByRole('button', { name: 'Start session' }).click();
  const student = await openStudent(browser, code, { ...devices['Pixel 7'] }, 'No throttling');

  const recoveries: number[] = [];
  for (let i = 0; i < 5; i += 1) {
    await student.cdp.send('Network.emulateNetworkConditions', { offline: true, latency: 0, downloadThroughput: -1, uploadThroughput: -1 });
    await expect(student.page.getByTestId('connection-warning')).toBeVisible({ timeout: 30_000 });
    const target = ((i + 1) % TOPICS.length) + 1;
    await teacher.getByTestId(`jump-${target}`).click();
    await expect(teacher.getByTestId('current-topic-title')).toHaveText(TOPICS[target - 1]!);
    const before = await changeCount(student.page);
    const backAt = Date.now();
    await student.cdp.send('Network.emulateNetworkConditions', { offline: false, latency: 0, downloadThroughput: -1, uploadThroughput: -1 });
    recoveries.push((await changeAfter(student.page, before, TOPICS[target - 1]!)) - backAt);
    await expect(student.page.getByTestId('connection-warning')).toHaveCount(0);
  }
  (results.scenarios as unknown[]).push({
    kind: 'reconnection',
    name: 'Student offline, teacher changes topic, student back online',
    network: 'Offline, then no throttling',
    recoveryMs: stats(recoveries),
    correctUpdates: `${recoveries.length}/5`,
  });
});

test('screenshots: teacher pages', async ({ browser }) => {
  const { page: teacher } = await teacherContext(browser);
  await teacher.setViewportSize({ width: 1366, height: 768 });
  const code = await createLessonToLive(teacher, TOPICS);
  await teacher.getByRole('button', { name: 'Start session' }).click();
  await teacher.screenshot({ path: path.join(SHOTS, 'teacher-live-laptop.png'), fullPage: true });
  await teacher.setViewportSize({ width: 800, height: 1280 });
  await teacher.screenshot({ path: path.join(SHOTS, 'teacher-live-tablet.png'), fullPage: true });
  const phone = await browser.newContext({ ...devices['Pixel 7'] });
  const join = await phone.newPage();
  await join.goto(`/join?code=${code}`);
  await join.screenshot({ path: path.join(SHOTS, 'student-join-phone.png') });
});

function toMarkdown(): string {
  const rows = (results.scenarios as Array<Record<string, any>>).map((s) => {
    const d = s.syncDelayMs ?? s.recoveryMs;
    return `| ${s.name} | ${s.network} | ${s.pageLoadMs ?? '–'} | ${s.pageLoadKb ?? '–'} | ${d.median} | ${d.p95} | ${d.max} | ${s.correctUpdates} |`;
  });
  return [
    `# Measured results`,
    '',
    `Generated by \`npm run evaluate\` on ${results.date}. ${TRIALS} topic changes per scenario (5 reconnections). Times in milliseconds.`,
    '',
    '| Scenario | Network | Student page load (ms) | Downloaded (KB) | Delay median | Delay p95 | Delay max | Correct updates |',
    '| --- | --- | --- | --- | --- | --- | --- | --- |',
    ...rows,
    '',
    "Delay is from the teacher's action to the new topic title appearing on the student page. For the reconnection row, it is from the connection returning to the student showing the topic chosen while it was offline.",
    '',
    `Networks: Fast 3G = ${NETWORKS['Fast 3G'].latency} ms latency, 1.6 Mbit/s down, 750 kbit/s up. Slow 3G = ${NETWORKS['Slow 3G'].latency} ms latency, 400 kbit/s both ways. Page load includes the demo video's metadata.`,
    '',
  ].join('\n');
}
