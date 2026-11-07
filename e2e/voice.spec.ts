import { expect, test } from '@playwright/test';
import { createLessonToLive, joinAsStudent, say, teacherContext } from './helpers';

const TOPICS = ['Addition', 'Subtraction', 'Multiplication'];

async function liveVoiceSession(browser: Parameters<typeof teacherContext>[0]) {
  const { page: teacher } = await teacherContext(browser);
  const code = await createLessonToLive(teacher, TOPICS);
  await teacher.getByRole('button', { name: 'Start session' }).click();
  const { page: student } = await joinAsStudent(browser, code);
  await expect(student.getByTestId('student-topic-title')).toHaveText('Addition');
  return { teacher, student };
}

async function enableMic(teacher: import('@playwright/test').Page) {
  await teacher.getByRole('button', { name: 'Enable microphone' }).click();
  await expect(teacher.getByTestId('voice-state')).toHaveText('Listening');
  await teacher.waitForFunction(() => window.__speech.active !== null);
}

test('next, previous, repeat, pause and resume commands reach the student', async ({ browser }) => {
  const { teacher, student } = await liveVoiceSession(browser);
  const title = student.getByTestId('student-topic-title');
  await enableMic(teacher);

  await say(teacher, 'Next Topic');
  await expect(title).toHaveText('Subtraction');
  await say(teacher, 'Next Topic'.toLowerCase() + ' ');
  // Inside the cooldown a repeated identical command is dropped, whatever the engine sends.
  await expect(title).toHaveText('Subtraction');

  await say(teacher, 'Go to topic 3');
  await expect(title).toHaveText('Multiplication');
  await say(teacher, 'Previous Topic');
  await expect(title).toHaveText('Subtraction');
  await say(teacher, 'Repeat Topic 1');
  await expect(title).toHaveText('Addition');
  await expect(student.locator('video').evaluate((v: HTMLVideoElement) => v.paused)).resolves.toBe(true);

  await say(teacher, 'Pause Session');
  await expect(student.getByText('Your teacher has paused the lesson.')).toBeVisible();
  await expect(teacher.getByRole('button', { name: 'Resume session' })).toBeVisible();
  await say(teacher, 'Resume Session');
  await expect(student.getByText('Your teacher has paused the lesson.')).toHaveCount(0);

  await say(teacher, 'Classroom, start topic 2');
  await expect(title).toHaveText('Subtraction');
});

test('invalid commands are rejected visibly and ordinary speech is ignored', async ({ browser }) => {
  const { teacher, student } = await liveVoiceSession(browser);
  const title = student.getByTestId('student-topic-title');
  await enableMic(teacher);

  await say(teacher, 'Start Topic 99');
  await expect(teacher.getByTestId('voice-state')).toHaveText('Command rejected');
  await expect(teacher.getByTestId('last-command')).toContainText('Rejected: There is no Topic 99');
  await expect(title).toHaveText('Addition');

  await expect(teacher.getByTestId('voice-state')).toHaveText('Listening', { timeout: 6000 });
  await say(teacher, 'Today we will study mathematics');
  await say(teacher, 'Topic three is very important');
  await expect(teacher.getByText('Heard speech that is not a command. Nothing changed.')).toBeVisible();
  await expect(teacher.getByTestId('voice-state')).toHaveText('Listening');
  await expect(teacher.getByTestId('current-topic-title')).toHaveText('Addition');
  await expect(title).toHaveText('Addition');
  // The classroom's words are not displayed or retained in the status panel.
  await expect(teacher.locator('body')).not.toContainText('study mathematics');

  await say(teacher, 'Previous Topic');
  await expect(teacher.getByTestId('last-command')).toContainText('Already on the first topic');
});

test('the wake phrase setting is honoured', async ({ browser }) => {
  const { teacher, student } = await liveVoiceSession(browser);
  await enableMic(teacher);
  await teacher.getByText('Commands and settings').click();
  await teacher.getByLabel(/Only respond after the word/).check();
  await say(teacher, 'Start Topic 2');
  await teacher.waitForTimeout(300);
  await expect(student.getByTestId('student-topic-title')).toHaveText('Addition');
  await say(teacher, 'Classroom, start Topic 2');
  await expect(student.getByTestId('student-topic-title')).toHaveText('Subtraction');
});

test('the microphone can be disabled at any time', async ({ browser }) => {
  const { teacher } = await liveVoiceSession(browser);
  await enableMic(teacher);
  await teacher.getByRole('button', { name: 'Disable microphone' }).click();
  await expect(teacher.getByTestId('voice-state')).toHaveText('Microphone off');
  await expect(teacher.getByRole('button', { name: 'Enable microphone' })).toBeVisible();
  await teacher.waitForFunction(() => window.__speech.active === null);
});

test('a denied microphone leaves manual controls working', async ({ browser }) => {
  const { teacher, student } = await liveVoiceSession(browser);
  await teacher.evaluate(() => {
    window.__speech.deny = true;
  });
  await teacher.getByRole('button', { name: 'Enable microphone' }).click();
  await expect(teacher.getByTestId('voice-state')).toHaveText('Microphone permission denied');
  await teacher.getByRole('button', { name: 'Next topic' }).click();
  await expect(student.getByTestId('student-topic-title')).toHaveText('Subtraction');
});

test('a browser without speech recognition says so and stays usable', async ({ browser }) => {
  const context = await browser.newContext();
  await context.addInitScript(() => {
    Object.defineProperty(window, 'SpeechRecognition', { value: undefined });
    Object.defineProperty(window, 'webkitSpeechRecognition', { value: undefined });
  });
  const page = await context.newPage();
  await page.goto('/teacher/login');
  await page.getByLabel('Passcode').fill('e2e-passcode');
  await page.getByRole('button', { name: 'Sign in' }).click();
  await expect(page.getByRole('heading', { name: 'Your lessons' })).toBeVisible();
  await createLessonToLive(page, TOPICS);
  await expect(page.getByTestId('voice-state')).toHaveText('Speech recognition unavailable');
  await expect(page.getByRole('button', { name: 'Enable microphone' })).toHaveCount(0);
  await page.getByRole('button', { name: 'Start session' }).click();
  await page.getByRole('button', { name: 'Next topic' }).click();
  await expect(page.getByTestId('current-topic-title')).toHaveText('Subtraction');
});
