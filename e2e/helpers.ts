import { expect, type Browser, type BrowserContext, type Page } from '@playwright/test';

export const PASSCODE = 'e2e-passcode';

declare global {
  interface Window {
    __speech: {
      deny: boolean;
      active: FakeRecognitionInstance | null;
      say(...alternatives: string[]): void;
    };
  }
}
interface FakeRecognitionInstance {
  results: unknown[];
  onresult?: (event: unknown) => void;
}

/**
 * Replaces only the browser's SpeechRecognition with a scripted one. Everything above it (the real
 * adapter, service, parser, API call, server, sockets, student page) runs for real. This verifies
 * the pipeline; it says nothing about microphone or recognition accuracy on real devices.
 */
export function installFakeSpeech(context: BrowserContext) {
  return context.addInitScript(() => {
    class FakeRecognition {
      results: unknown[] = [];
      onstart?: () => void;
      onresult?: (event: unknown) => void;
      onerror?: (event: { error: string }) => void;
      onend?: () => void;
      start() {
        setTimeout(() => {
          if (window.__speech.deny) {
            this.onerror?.({ error: 'not-allowed' });
            this.onend?.();
            return;
          }
          window.__speech.active = this;
          this.onstart?.();
        }, 0);
      }
      stop() {
        this.abort();
      }
      abort() {
        window.__speech.active = null;
        setTimeout(() => this.onend?.(), 0);
      }
    }
    window.__speech = {
      deny: false,
      active: null,
      say(...alternatives) {
        const engine = window.__speech.active;
        if (!engine) throw new Error('Speech engine is not listening');
        const result = Object.assign(alternatives.map((transcript) => ({ transcript })), { isFinal: true });
        engine.results.push(result);
        engine.onresult?.({ resultIndex: engine.results.length - 1, results: engine.results });
      },
    };
    (window as unknown as { SpeechRecognition: unknown }).SpeechRecognition = FakeRecognition;
  });
}

export const say = (page: Page, ...alternatives: string[]) =>
  page.evaluate((list) => window.__speech.say(...list), alternatives);

export async function teacherContext(browser: Browser): Promise<{ context: BrowserContext; page: Page }> {
  const context = await browser.newContext();
  await installFakeSpeech(context);
  const page = await context.newPage();
  await page.goto('/teacher/login');
  await page.getByLabel('Passcode').fill(PASSCODE);
  await page.getByRole('button', { name: 'Sign in' }).click();
  await expect(page.getByRole('heading', { name: 'Your lessons' })).toBeVisible();
  return { context, page };
}

/** Creates and confirms a lesson through the UI, ending on the live page. Returns the session code. */
export async function createLessonToLive(page: Page, topics: string[], mode: 'voice' | 'timestamp' = 'voice', durations?: number[]): Promise<string> {
  await page.goto('/teacher/lessons/new');
  await page.getByLabel('Topics, one per line').fill(topics.join('\n'));
  await page.getByRole('button', { name: 'Find resources' }).click();
  await expect(page.getByRole('heading', { name: 'Suggested teaching sequence' })).toBeVisible();
  if (mode === 'timestamp') {
    await page.getByRole('radio', { name: /Timestamp/ }).check();
    for (const [i, seconds] of (durations ?? []).entries()) {
      const input = page.getByTestId(`topic-${i + 1}`).getByLabel('Duration (seconds)');
      await input.fill(String(seconds));
      await input.blur();
      await expect(page.getByRole('button', { name: /Confirm sequence/ })).toBeEnabled();
    }
  }
  await page.getByRole('button', { name: /Confirm sequence/ }).click();
  const code = page.getByTestId('session-code');
  await expect(code).toBeVisible();
  return (await code.textContent())!.trim();
}

export async function joinAsStudent(browser: Browser, code: string, options?: Parameters<Browser['newContext']>[0]) {
  const context = await browser.newContext(options);
  const page = await context.newPage();
  await page.goto('/join');
  await page.getByLabel('Session code').fill(code);
  await page.getByRole('button', { name: 'Join lesson' }).click();
  await expect(page).toHaveURL(new RegExp(`/student/${code}$`));
  return { context, page };
}

/** Records page loads, so tests can prove that a student update did not need a refresh. */
export function countLoads(page: Page): () => number {
  let loads = 0;
  page.on('load', () => (loads += 1));
  return () => loads;
}
