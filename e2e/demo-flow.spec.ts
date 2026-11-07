import { expect, test } from '@playwright/test';
import { countLoads, joinAsStudent, say, teacherContext } from './helpers';

/** The required live demonstration, step by step, in two separate browser contexts. */
test('complete teacher and student demonstration', async ({ browser }) => {
  const { page: teacher } = await teacherContext(browser);

  // Step 1: teacher enters three topics.
  await teacher.getByRole('link', { name: 'New lesson' }).click();
  await teacher.getByLabel('Topics, one per line').fill('Addition\nSubtraction\nMultiplication');
  await teacher.getByRole('button', { name: 'Find resources' }).click();

  // Step 2: matched resources from the library, labelled as demo.
  const first = teacher.getByTestId('topic-1');
  await expect(first).toContainText('Addition');
  await expect(first).toContainText('Addition (demo placeholder)');
  await expect(first).toContainText('Exact match');
  await expect(first).toContainText('Demo Resource');
  await expect(first).toContainText('Video: available');
  await expect(first).toContainText('Script: available');
  await expect(teacher.getByTestId('topic-3')).toContainText('Multiplication (demo placeholder)');

  // Steps 3-4: confirm and create the session; Voice Trigger is the default.
  await expect(teacher.getByRole('radio', { name: /Voice Trigger/ })).toBeChecked();
  await teacher.getByRole('button', { name: /Confirm sequence/ }).click();
  const code = (await teacher.getByTestId('session-code').textContent())!.trim();
  await expect(teacher.getByTestId('session-status')).toContainText('Not started');
  await expect(teacher.getByTestId('student-count')).toHaveText('0');

  // Student can join before the start and waits.
  const { page: student } = await joinAsStudent(browser, code);
  const loads = countLoads(student);
  await expect(student.getByRole('heading', { name: 'Waiting for your teacher' })).toBeVisible();
  await expect(teacher.getByTestId('student-count')).toHaveText('1');

  await teacher.getByRole('button', { name: 'Start session' }).click();
  await expect(teacher.getByTestId('session-status')).toContainText('In progress');

  // Step 6: student sees Topic 1 with its video and script, without refreshing.
  const title = student.getByTestId('student-topic-title');
  await expect(title).toHaveText('Addition');
  await expect(student.getByTestId('student-topic-number')).toHaveText('Topic 1 of 3');
  await expect(student.locator('video')).toHaveAttribute('src', '/demo/demo-addition.mp4');
  await expect(student.getByTestId('script-text')).toContainText('"Addition"');
  await expect(student.getByTestId('student-announcement')).toHaveText('Now showing Topic 1 of 3: Addition.');

  // The local video really exists and loads.
  await expect.poll(() => student.locator('video').evaluate((v: HTMLVideoElement) => v.readyState)).toBeGreaterThan(0);
  await expect.poll(() => student.locator('video').evaluate((v: HTMLVideoElement) => v.paused)).toBe(true);

  // Video and script are on screen together.
  await expect(student.locator('video')).toBeInViewport();
  await expect(student.getByTestId('script-text')).toBeInViewport();

  // Step 7-8: "Start Topic 2".
  await teacher.getByRole('button', { name: 'Enable microphone' }).click();
  await expect(teacher.getByTestId('voice-state')).toHaveText('Listening');
  await say(teacher, 'Start Topic 2');
  await expect(title).toHaveText('Subtraction');
  await expect(student.locator('video')).toHaveAttribute('src', '/demo/demo-subtraction.mp4');
  await expect(student.getByTestId('script-text')).toContainText('"Subtraction"');
  await expect(teacher.getByTestId('last-command')).toContainText('Recognised: "Start Topic 2"');
  await expect(teacher.getByTestId('last-command')).toContainText('Action: Switched to Topic 2: Subtraction');
  await expect(teacher.getByTestId('current-topic-title')).toHaveText('Subtraction');

  // Step 9-10: spoken as a word this time.
  await say(teacher, 'start topic three');
  await expect(title).toHaveText('Multiplication');
  await expect(student.getByTestId('student-topic-number')).toHaveText('Topic 3 of 3');

  // Step 11-12: manual selection back to Topic 1.
  await teacher.getByTestId('jump-1').click();
  await expect(title).toHaveText('Addition');
  await expect(student.getByTestId('script-text')).toContainText('"Addition"');

  // Step 13-14: end.
  await teacher.getByRole('button', { name: 'End session' }).click();
  await teacher.getByRole('dialog').getByRole('button', { name: 'End session' }).click();
  await expect(student.getByRole('heading', { name: 'This lesson has ended' })).toBeVisible();
  await expect(teacher.getByTestId('session-status')).toContainText('Ended');

  // Basic history survives; voice-driven changes are attributed, with no transcript stored.
  await expect(teacher.getByText('Moved to Topic 2: Subtraction by voice')).toBeVisible();
  await expect(teacher.getByRole('button', { name: 'Start session' })).toHaveCount(0);

  expect(loads(), 'student page must never reload').toBe(0);
});
