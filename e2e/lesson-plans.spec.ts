import path from 'node:path';
import { devices, expect, test } from '@playwright/test';
import { PrismaClient } from '@prisma/client';
import { installFakeSpeech, say, teacherContext } from './helpers';

/**
 * The plan itself comes from Gemini, which tests must not call, so a ready plan is written straight
 * into the test database. Everything after that (API, teacher review, student pages, the student's
 * own listening, scrolling to parts) runs for real; only the browser's speech engine is scripted.
 */
test('student picks a lesson and the page follows "part 3" heard on their own device', async ({ browser }) => {
  const db = new PrismaClient({ datasourceUrl: `file:${path.resolve('e2e/.tmp/e2e.db')}` });
  const title = `Waste Management ${Date.now()}`;
  await db.resource.create({
    data: {
      title,
      videoUrl: 'https://www.youtube.com/watch?v=abcdef12345',
      provenance: 'verified',
      sourceOrganisation: 'Ashray Akruti',
      sourceReference: 'e2e',
      dedupeKey: `e2e-${title}`,
      lessonPlan: {
        create: {
          status: 'ready',
          transcriptLanguage: 'ta',
          transcript: JSON.stringify({ language: 'ta', generated: true, segments: [{ start: 5, duration: 3, text: 'குப்பை மேலாண்மை' }, { start: 75, duration: 4, text: 'மக்கும் குப்பை' }] }),
          model: 'e2e',
          parts: JSON.stringify([1, 2, 3, 4, 5].map((n) => ({ title: `Step ${n} of waste`, content: `- Teach point ${n}` }))),
        },
      },
    },
  });
  await db.$disconnect();

  // Teacher: the plan appears in lesson review; confirming makes the lesson available to students.
  const { page: teacher } = await teacherContext(browser);
  await teacher.getByRole('link', { name: 'New lesson' }).click();
  await teacher.getByLabel('Topics, one per line').fill(`${title}\nAddition`);
  await teacher.getByRole('button', { name: 'Find resources' }).click();
  await teacher.getByRole('button', { name: 'Lesson plan for Topic 1' }).click();
  await expect(teacher.getByTestId('teacher-plan')).toContainText('Part 3: Step 3 of waste');
  await teacher.getByRole('button', { name: /Confirm sequence/ }).click();
  await expect(teacher.getByTestId('session-code')).toBeVisible();

  // Student on a phone, with no code.
  const context = await browser.newContext({ ...devices['Pixel 7'] });
  await installFakeSpeech(context);
  const student = await context.newPage();
  await student.goto('/join');
  await student.getByRole('link', { name: /Choose a lesson yourself/ }).click();
  await student.getByRole('link', { name: new RegExp(title) }).click();
  await expect(student.getByTestId('plan-topic-title')).toHaveText(`Topic 1: ${title}`);
  await expect(student.getByTestId('plan-part-1')).toHaveAttribute('aria-current', 'step');
  await expect(student.locator('iframe')).toHaveAttribute('src', 'https://www.youtube-nocookie.com/embed/abcdef12345');

  await student.getByTestId('listen-toggle').click();
  await expect(student.getByTestId('listen-status')).toContainText('Listening for');
  await say(student, 'Right, now we move on to part 3');
  await expect(student.getByTestId('current-part')).toHaveText('Part 3 of 5');
  await expect(student.getByTestId('plan-part-3')).toHaveAttribute('aria-current', 'step');
  await expect(student.getByTestId('plan-part-3')).toBeInViewport();

  await say(student, 'part one');
  await expect(student.getByTestId('current-part')).toHaveText('Part 1 of 5');

  // The raw transcript, with times that open the video at that moment.
  await student.getByTestId('transcript-toggle').click();
  const lines = student.getByTestId('transcript-lines');
  await expect(lines.getByRole('listitem')).toHaveCount(2);
  await expect(lines.getByRole('link', { name: /1:15/ })).toHaveAttribute('href', 'https://www.youtube.com/watch?v=abcdef12345&t=75s');
  await expect(lines).toContainText('மக்கும் குப்பை');

  await say(student, 'Start topic 2');
  await expect(student.getByTestId('plan-topic-title')).toHaveText('Topic 2: Addition');
  await expect(student.getByText(/only for resources with a YouTube video/)).toBeVisible();
  await expect(student.getByTestId('transcript-toggle')).toHaveCount(0);

  await student.getByTestId('listen-toggle').click();
  await expect(student.getByTestId('listen-toggle')).toHaveText(/Listen for my teacher/);
});
