import { expect, test } from '@playwright/test';
import { countLoads, createLessonToLive, joinAsStudent, teacherContext } from './helpers';

const TOPICS = ['Addition', 'Subtraction', 'Multiplication'];

test('one teacher command updates every connected student', async ({ browser }) => {
  const { page: teacher } = await teacherContext(browser);
  const code = await createLessonToLive(teacher, TOPICS);
  await teacher.getByRole('button', { name: 'Start session' }).click();

  const students = await Promise.all([joinAsStudent(browser, code), joinAsStudent(browser, code), joinAsStudent(browser, code)]);
  await expect(teacher.getByTestId('student-count')).toHaveText('3');
  await teacher.getByRole('button', { name: 'Next topic' }).click();
  for (const { page } of students) await expect(page.getByTestId('student-topic-title')).toHaveText('Subtraction');

  await students[0]!.context.close();
  await expect(teacher.getByTestId('student-count')).toHaveText('2');
});

test('a student who joins late, or opens the link directly, gets the current topic', async ({ browser }) => {
  const { page: teacher } = await teacherContext(browser);
  const code = await createLessonToLive(teacher, TOPICS);
  await teacher.getByRole('button', { name: 'Start session' }).click();
  await teacher.getByTestId('jump-3').click();
  await expect(teacher.getByTestId('current-topic-title')).toHaveText('Multiplication');

  const context = await browser.newContext();
  const student = await context.newPage();
  await student.goto(`/student/${code.toLowerCase()}`);
  await expect(student.getByTestId('student-topic-title')).toHaveText('Multiplication');
});

test('a disconnected student sees a warning, then resynchronises automatically', async ({ browser }) => {
  const { page: teacher } = await teacherContext(browser);
  const code = await createLessonToLive(teacher, TOPICS);
  await teacher.getByRole('button', { name: 'Start session' }).click();

  const context = await browser.newContext();
  const student = await context.newPage();
  const loads = countLoads(student);
  // All socket traffic for this student passes through a switch the test controls.
  let online = true;
  const sockets: { close(): Promise<void> }[] = [];
  await student.routeWebSocket(/socket\.io/, (ws) => {
    if (!online) {
      void ws.close();
      return;
    }
    ws.connectToServer();
    sockets.push(ws);
  });
  await student.route(/socket\.io/, (route) => (online ? route.continue() : route.abort()));

  await student.goto(`/student/${code}`);
  await expect(student.getByTestId('student-topic-title')).toHaveText('Addition');
  await expect(student.getByTestId('connection-warning')).toHaveCount(0);

  // Let Socket.IO finish upgrading from long-polling to the WebSocket this test can sever.
  await expect.poll(() => sockets.length).toBeGreaterThan(0);
  await student.waitForTimeout(500);

  online = false;
  await Promise.all(sockets.map((ws) => ws.close()));
  await expect(student.getByTestId('connection-warning')).toBeVisible();

  // Changes made during the outage cannot reach the student, and it does not pretend otherwise.
  await teacher.getByTestId('jump-3').click();
  await expect(teacher.getByTestId('current-topic-title')).toHaveText('Multiplication');
  await student.waitForTimeout(500);
  await expect(student.getByTestId('student-topic-title')).toHaveText('Addition');
  await expect(student.getByTestId('connection-warning')).toBeVisible();

  online = true;
  await expect(student.getByTestId('student-topic-title')).toHaveText('Multiplication', { timeout: 15_000 });
  await expect(student.getByTestId('connection-warning')).toHaveCount(0);
  expect(loads()).toBe(1);
});

test('timestamp mode advances from the backend; pause holds; manual override works', async ({ browser }) => {
  const { page: teacher } = await teacherContext(browser);
  const code = await createLessonToLive(teacher, TOPICS, 'timestamp', [2, 3, 60]);
  await expect(teacher.getByTestId('session-status')).toContainText('Timestamp mode');
  const { page: student } = await joinAsStudent(browser, code);
  const title = student.getByTestId('student-topic-title');
  const seen: string[] = [];
  await student.exposeFunction('recordTopic', (text: string) => seen.push(text));
  await student.evaluate(() => {
    new MutationObserver(() => {
      const el = document.querySelector('[data-testid="student-topic-title"]');
      if (el?.textContent) (window as unknown as { recordTopic(t: string): void }).recordTopic(el.textContent);
    }).observe(document.body, { childList: true, subtree: true, characterData: true });
  });

  await teacher.getByRole('button', { name: 'Start session' }).click();
  await expect(title).toHaveText('Addition');
  await expect(title).toHaveText('Subtraction', { timeout: 4000 });

  await teacher.getByRole('button', { name: 'Pause session' }).click();
  await expect(student.getByText('Your teacher has paused the lesson.')).toBeVisible();
  await student.waitForTimeout(3500);
  await expect(title).toHaveText('Subtraction');

  await teacher.getByRole('button', { name: 'Resume session' }).click();
  await expect(title).toHaveText('Multiplication', { timeout: 5000 });
  expect([...new Set(seen)]).toEqual(['Addition', 'Subtraction', 'Multiplication']);

  // The microphone is unavailable in this mode, and manual override still works.
  await expect(teacher.getByRole('button', { name: 'Enable microphone' })).toHaveCount(0);
  await teacher.getByTestId('jump-1').click();
  await expect(title).toHaveText('Addition');
  await expect(teacher.getByText('Next topic in')).toBeVisible();
});

test('mode switching requires a pause and an explicit confirmation', async ({ browser }) => {
  const { page: teacher } = await teacherContext(browser);
  await createLessonToLive(teacher, TOPICS);
  await teacher.getByRole('button', { name: 'Start session' }).click();
  const button = teacher.getByRole('button', { name: 'Switch to Timestamp mode' });
  await expect(button).toBeDisabled();
  await teacher.getByRole('button', { name: 'Pause session' }).click();
  await button.click();
  await teacher.getByRole('dialog').getByRole('button', { name: 'Switch mode' }).click();
  await expect(teacher.getByTestId('session-status')).toContainText('Timestamp mode');
  await expect(teacher.getByRole('button', { name: 'Enable microphone' })).toHaveCount(0);
});

test('the teacher can leave and return to a running session', async ({ browser }) => {
  const { page: teacher } = await teacherContext(browser);
  const code = await createLessonToLive(teacher, TOPICS);
  await teacher.getByRole('button', { name: 'Start session' }).click();
  await teacher.getByTestId('jump-2').click();
  await expect(teacher.getByTestId('current-topic-title')).toHaveText('Subtraction');

  await teacher.goto('/teacher');
  await teacher.getByRole('link', { name: new RegExp(code) }).click();
  await expect(teacher.getByTestId('current-topic-title')).toHaveText('Subtraction');
  await expect(teacher.getByTestId('sync-status')).toHaveText('Live');
});
