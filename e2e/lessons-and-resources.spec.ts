import AxeBuilder from '@axe-core/playwright';
import { expect, test, type Page } from '@playwright/test';
import { createLessonToLive, joinAsStudent, teacherContext } from './helpers';

test('an unmatched topic is reported honestly and can be resolved or left', async ({ browser }) => {
  const { page } = await teacherContext(browser);
  await page.goto('/teacher/lessons/new');
  await page.getByLabel('Topics, one per line').fill('Mathematics\nAddition\nSubtraction');
  await page.getByRole('button', { name: 'Find resources' }).click();

  // No resource is attached, and it moves to the end with a stated reason.
  const last = page.getByTestId('topic-3');
  await expect(last).toContainText('Mathematics');
  await expect(last).toContainText('No matching resource found in the current library.');
  await expect(last).toContainText('Moved to the end');
  await expect(page.getByTestId('topic-1')).toContainText('Addition');
  await expect(page.getByText('1 topic has no resource')).toBeVisible();

  // Teacher's own order can be restored.
  await page.getByRole('button', { name: 'Use the order I entered' }).click();
  await expect(page.getByTestId('topic-1')).toContainText('Mathematics');

  // Replace with an existing resource.
  await page.getByRole('button', { name: 'Choose resource for Topic 1' }).click();
  const dialog = page.getByRole('dialog');
  await dialog.getByLabel('Search the library').fill('fractions');
  await dialog.getByRole('button', { name: /Fractions \(demo placeholder\)/ }).click();
  await expect(page.getByTestId('topic-1')).toContainText('Chosen by you');
  await expect(page.getByTestId('topic-1')).toContainText('Video: not available');

  // Reorder with buttons and remove.
  await page.getByRole('button', { name: 'Move Topic 1 down' }).click();
  await expect(page.getByTestId('topic-1')).toContainText('Addition');
  await expect(page.getByTestId('topic-2')).toContainText('Mathematics');
  await page.getByRole('button', { name: 'Remove Topic 3' }).click();
  await expect(page.getByTestId('topic-3')).toHaveCount(0);

  // Preview shows the resource's content.
  await page.getByRole('button', { name: 'Preview resource for Topic 1' }).click();
  await expect(page.getByRole('dialog').getByTestId('script-text')).toContainText('DEMONSTRATION PLACEHOLDER');
  await page.keyboard.press('Escape');

  // Persisted: survives a reload.
  await page.reload();
  await expect(page.getByTestId('topic-2')).toContainText('Mathematics');
  await expect(page.getByTestId('topic-3')).toHaveCount(0);
});

test('a confirmed topic without a resource tells the student so', async ({ browser }) => {
  const { page: teacher } = await teacherContext(browser);
  const code = await createLessonToLive(teacher, ['Addition', 'Volcanoes']);
  await teacher.getByRole('button', { name: 'Start session' }).click();
  await teacher.getByTestId('jump-2').click();
  const { page: student } = await joinAsStudent(browser, code);
  await expect(student.getByTestId('student-topic-title')).toHaveText('Volcanoes');
  await expect(student.getByText(/No resource is available for this topic/)).toBeVisible();
  await expect(student.locator('video, iframe')).toHaveCount(0);
});

test('resources import from CSV, match, and reach the student exactly as stored', async ({ browser }) => {
  const { page: teacher } = await teacherContext(browser);
  const unique = `Rivers ${Date.now()}`;
  const script = 'First paragraph with <b>markup</b> & "quotes".\n\nSecond paragraph.\n    Indented line.';
  const csv = `title,topic,videoUrl,scriptText,sourceOrganisation\n"${unique}","${unique}",https://example.com/rivers-${Date.now()},"${script.replaceAll('"', '""')}",Test source\nBroken,,not-a-url,,\n`;

  await teacher.goto('/teacher/resources/import');
  await teacher.getByLabel('File contents').fill(csv);
  await teacher.getByRole('button', { name: 'Check file' }).click();
  const report = teacher.getByTestId('import-report');
  await expect(report).toContainText('1 ready to import');
  await expect(report).toContainText('Row 3');
  await expect(report).toContainText('Nothing has been saved yet');

  await teacher.getByRole('button', { name: 'Import 1 resource' }).click();
  await expect(report).toContainText('1 imported');

  // Importing the same data again is reported as a duplicate.
  await teacher.getByLabel('File contents').fill(csv);
  await teacher.getByRole('button', { name: 'Check file' }).click();
  await expect(report).toContainText('Duplicates skipped');

  await teacher.goto(`/teacher/resources`);
  await teacher.getByLabel('Search').fill(unique);
  const row = teacher.getByTestId('resource-row');
  await expect(row).toHaveCount(1);
  await expect(row).toContainText('Source not verified');

  const code = await createLessonToLive(teacher, [unique]);
  await teacher.getByRole('button', { name: 'Start session' }).click();
  const { page: student } = await joinAsStudent(browser, code);
  const scriptElement = student.getByTestId('script-text');
  expect(await scriptElement.textContent()).toBe(script);
  await expect(scriptElement.locator('b')).toHaveCount(0);
  // An unembeddable page gets a clear link rather than a broken frame.
  await expect(student.getByText('This video cannot be shown inside this page.')).toBeVisible();
  await expect(student.getByRole('link', { name: /new tab/ })).toHaveAttribute('target', '_blank');
});

test('resources can be added, edited and deleted by hand, and invalid input is explained', async ({ browser }) => {
  const { page } = await teacherContext(browser);
  const title = `Manual ${Date.now()}`;
  await page.goto('/teacher/resources');
  await page.getByRole('button', { name: 'Add resource' }).click();
  const dialog = page.getByRole('dialog');
  await dialog.getByLabel('Title (required)').fill(title);
  await dialog.getByRole('button', { name: 'Save resource' }).click();
  await expect(dialog).toContainText('A resource needs a video URL or a script.');
  await dialog.getByLabel('Script', { exact: true }).fill('Existing script');
  await dialog.getByLabel('Status').selectOption('verified');
  await dialog.getByRole('button', { name: 'Save resource' }).click();
  await expect(dialog).toContainText('must state its source organisation');
  await dialog.getByLabel('Status').selectOption('unverified');
  await dialog.getByRole('button', { name: 'Save resource' }).click();
  await expect(dialog).toHaveCount(0);

  await page.getByLabel('Search').fill(title);
  await page.getByRole('button', { name: `Edit ${title}` }).click();
  await page.getByRole('dialog').getByLabel('Subject').fill('Edited subject');
  await page.getByRole('dialog').getByRole('button', { name: 'Save resource' }).click();
  await expect(page.getByTestId('resource-row')).toContainText('Edited subject');

  await page.getByRole('button', { name: `Delete ${title}` }).click();
  await page.getByRole('dialog').getByRole('button', { name: 'Delete resource' }).click();
  await expect(page.getByTestId('resource-row')).toHaveCount(0);
});

test('templates can be downloaded and are valid for import', async ({ browser }) => {
  const { page, context } = await teacherContext(browser);
  for (const [path, format] of [['/templates/resources-template.csv', 'csv'], ['/templates/resources-template.json', 'json']] as const) {
    const content = await (await context.request.get(path)).text();
    const response = await context.request.post('/api/resources/import', { data: { format, content, dryRun: true } });
    const { data } = await response.json();
    expect(data.errors, path).toEqual([]);
    expect(data.valid).toHaveLength(1);
  }
  await page.goto('/teacher/resources/import');
  await expect(page.getByRole('link', { name: 'CSV template' })).toHaveAttribute('download', '');
});

test('lessons can be reused and session history is kept', async ({ browser }) => {
  const { page } = await teacherContext(browser);
  const name = `Reuse ${Date.now()}`;
  await page.goto('/teacher/lessons/new');
  await page.getByLabel('Topics, one per line').fill('Addition');
  await page.getByLabel(/Lesson name/).fill(name);
  await page.getByRole('button', { name: 'Find resources' }).click();
  await page.getByRole('button', { name: /Confirm sequence/ }).click();
  await page.getByRole('button', { name: 'Start session' }).click();
  await page.getByRole('button', { name: 'End session' }).click();
  await page.getByRole('dialog').getByRole('button', { name: 'End session' }).click();
  await expect(page.getByTestId('session-status')).toContainText('Ended');

  await page.goto('/teacher');
  await page.getByRole('link', { name, exact: true }).click();
  await expect(page.getByRole('heading', { name: 'Past sessions' })).toBeVisible();

  // Running the same confirmed lesson again needs no re-entry.
  await page.getByRole('button', { name: /Confirm sequence/ }).click();
  await expect(page.getByTestId('session-status')).toContainText('Not started');
  await page.goto('/teacher');
  await page.getByRole('button', { name: `Reuse ${name} as a new lesson` }).click();
  await expect(page.getByRole('heading', { name: `${name} (copy)` })).toBeVisible();
});

test.describe('access control', () => {
  test('teacher pages redirect to sign-in, and a wrong passcode is refused', async ({ page }) => {
    await page.goto('/teacher/resources');
    await expect(page).toHaveURL(/\/teacher\/login\?next=/);
    await page.getByLabel('Passcode').fill('wrong');
    await page.getByRole('button', { name: 'Sign in' }).click();
    await expect(page.getByRole('alert')).toContainText('not correct');
    await page.getByLabel('Passcode').fill('e2e-passcode');
    await page.getByRole('button', { name: 'Sign in' }).click();
    await expect(page.getByRole('heading', { name: 'Resource library' })).toBeVisible();
  });

  test('a student browser gets 401 from every control endpoint and sees no controls', async ({ browser }) => {
    const { page: teacher } = await teacherContext(browser);
    const code = await createLessonToLive(teacher, ['Addition', 'Subtraction']);
    const id = teacher.url().split('/').pop();
    await teacher.getByRole('button', { name: 'Start session' }).click();
    const { page: student, context } = await joinAsStudent(browser, code);
    await expect(student.getByTestId('student-topic-title')).toHaveText('Addition');
    for (const path of ['topic', 'end', 'pause']) {
      const res = await context.request.post(`/api/sessions/${id}/${path}`, { data: { action: 'next' } });
      expect(res.status()).toBe(401);
    }
    await expect(student.getByRole('button', { name: /next|previous|end session|pause|microphone/i })).toHaveCount(0);
    await expect(teacher.getByTestId('current-topic-title')).toHaveText('Addition');
  });

  test('joining with an unknown code explains the problem', async ({ page }) => {
    await page.goto('/join');
    await page.getByLabel('Session code').fill('ZZZZZZ');
    await page.getByRole('button', { name: 'Join lesson' }).click();
    await expect(page.getByRole('alert')).toContainText('No lesson found');
    await page.goto('/student/ZZZZZZ');
    await expect(page.getByRole('heading', { name: "We couldn't find that lesson" })).toBeVisible();
  });
});

async function expectNoSeriousA11yIssues(page: Page, name: string) {
  const results = await new AxeBuilder({ page }).withTags(['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa']).analyze();
  const issues = results.violations.map((v) => `${v.id} (${v.impact}): ${v.nodes.map((n) => n.target.join(' ')).join(', ')}`);
  expect(issues, name).toEqual([]);
}

test('key pages pass automated WCAG A/AA checks', async ({ browser }) => {
  const { page: teacher } = await teacherContext(browser);
  await expectNoSeriousA11yIssues(teacher, 'teacher home');
  await teacher.goto('/teacher/lessons/new');
  await expectNoSeriousA11yIssues(teacher, 'new lesson');
  await teacher.goto('/teacher/resources');
  await expect(teacher.getByTestId('resource-row').first()).toBeVisible();
  await expectNoSeriousA11yIssues(teacher, 'library');
  await teacher.goto('/teacher/resources/import');
  await expectNoSeriousA11yIssues(teacher, 'import');

  await teacher.goto('/teacher/lessons/new');
  await teacher.getByLabel('Topics, one per line').fill('Addition\nSubtraction\nVolcanoes');
  await teacher.getByRole('button', { name: 'Find resources' }).click();
  await expect(teacher.getByTestId('topic-1')).toBeVisible();
  await expectNoSeriousA11yIssues(teacher, 'lesson review');

  await teacher.getByRole('button', { name: /Confirm sequence/ }).click();
  const code = (await teacher.getByTestId('session-code').textContent())!.trim();
  await expectNoSeriousA11yIssues(teacher, 'live, not started');

  const { page: student } = await joinAsStudent(browser, code);
  await expect(student.getByRole('heading', { name: 'Waiting for your teacher' })).toBeVisible();
  await expectNoSeriousA11yIssues(student, 'student waiting');

  await teacher.getByRole('button', { name: 'Start session' }).click();
  await expect(student.getByTestId('student-topic-title')).toHaveText('Addition');
  await student.waitForTimeout(1800);
  await expectNoSeriousA11yIssues(student, 'student lesson');
  await teacher.waitForTimeout(200);
  await expectNoSeriousA11yIssues(teacher, 'live, running');

  const landing = await (await browser.newContext()).newPage();
  await landing.goto('/');
  await expectNoSeriousA11yIssues(landing, 'landing');
  await landing.goto('/join');
  await expectNoSeriousA11yIssues(landing, 'join');
});

test('the student page works by keyboard and fits a phone without sideways scrolling', async ({ browser }) => {
  const { page: teacher } = await teacherContext(browser);
  const code = await createLessonToLive(teacher, ['Addition']);
  await teacher.getByRole('button', { name: 'Start session' }).click();
  const { page: student } = await joinAsStudent(browser, code, { viewport: { width: 375, height: 800 } });
  await expect(student.getByTestId('student-topic-title')).toHaveText('Addition');
  const overflow = await student.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
  expect(overflow).toBe(0);

  // Video first, then script, in reading order on a phone.
  const video = (await student.locator('video').boundingBox())!;
  const script = (await student.getByTestId('script-text').boundingBox())!;
  expect(script.y).toBeGreaterThan(video.y + video.height);

  const focused: string[] = [];
  for (let i = 0; i < 12; i += 1) {
    await student.keyboard.press('Tab');
    focused.push(await student.evaluate(() => document.activeElement?.getAttribute('aria-label') ?? document.activeElement?.textContent ?? ''));
  }
  expect(focused.join('|')).toContain('Larger script text');
});
