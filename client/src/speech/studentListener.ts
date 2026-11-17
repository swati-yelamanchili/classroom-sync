import { useEffect, useMemo, useRef, useState } from 'react';
import { parsePartCommand, parseVoiceCommand, type PartCommand } from '@classroom/shared';
import { BrowserSpeechAdapter } from './browserAdapter';
import type { SpeechErrorCode, SpeechRecognitionAdapter } from './types';

export type StudentCommand = PartCommand | { type: 'topic'; topicNumber: number } | { type: 'nextTopic' } | { type: 'previousTopic' };
export type ListenerState = 'off' | 'listening' | 'permission-denied' | 'unavailable' | 'error';

/** Topic commands keep the strict teacher grammar; part commands are found anywhere in a sentence. */
export function parseStudentCommand(transcript: string): StudentCommand | null {
  const topic = parseVoiceCommand(transcript);
  if (topic?.type === 'goto') return { type: 'topic', topicNumber: topic.topicNumber };
  if (topic?.type === 'next') return { type: 'nextTopic' };
  if (topic?.type === 'previous') return { type: 'previousTopic' };
  return parsePartCommand(transcript);
}

const REPEAT_WINDOW_MS = 2500;
const MAX_FAILURES = 5;
const ERROR_MESSAGES: Partial<Record<SpeechErrorCode, string>> = {
  'audio-capture': 'No working microphone was found.',
  network: 'The speech service could not be reached. Check the internet connection.',
  'language-not-supported': 'This browser cannot recognise speech in English.',
};

/**
 * Listens on the student's own device for the teacher saying "Part 3", "next part" or "Start Topic 2".
 * Browsers stop continuous recognition by themselves, so it restarts, backing off after errors.
 */
export class StudentListener {
  private enabled = false;
  private failures = 0;
  private startedAt = 0;
  private timer: ReturnType<typeof setTimeout> | null = null;
  private last: { key: string; at: number } | null = null;

  constructor(
    private readonly adapter: SpeechRecognitionAdapter,
    private readonly onCommand: (command: StudentCommand, heard: string) => void,
    private readonly onState: (state: ListenerState, message: string | null) => void,
    private readonly now: () => number = () => Date.now(),
  ) {}

  start(): void {
    if (!this.adapter.supported) {
      this.onState('unavailable', 'This browser cannot listen for speech. Tap the parts instead, or use Google Chrome.');
      return;
    }
    if (this.enabled) return;
    this.enabled = true;
    this.failures = 0;
    this.onState('listening', null);
    this.run();
  }

  stop(): void {
    this.enabled = false;
    if (this.timer) clearTimeout(this.timer);
    this.timer = null;
    this.adapter.stop();
    this.onState('off', null);
  }

  private run(): void {
    this.adapter.start({
      onStart: () => {
        this.startedAt = this.now();
      },
      onFinalResult: (alternatives) => {
        if (!this.enabled) return;
        for (const heard of alternatives) {
          const command = parseStudentCommand(heard);
          if (!command) continue;
          // Engines sometimes deliver the same phrase twice.
          const key = JSON.stringify(command);
          const at = this.now();
          if (this.last?.key === key && at - this.last.at < REPEAT_WINDOW_MS) return;
          this.last = { key, at };
          this.onCommand(command, heard.trim());
          return;
        }
      },
      onError: (code) => {
        if (!this.enabled || code === 'no-speech' || code === 'aborted') return;
        if (code === 'not-allowed' || code === 'service-not-allowed') {
          this.enabled = false;
          this.onState('permission-denied', 'Microphone permission was denied. Allow it in the browser settings, or tap the parts instead.');
          return;
        }
        this.failures += 1;
        this.onState('error', ERROR_MESSAGES[code] ?? 'Listening stopped unexpectedly.');
      },
      onEnd: () => {
        if (!this.enabled) return;
        if (this.now() - this.startedAt > 5000) this.failures = 0;
        if (this.failures >= MAX_FAILURES) {
          this.enabled = false;
          this.onState('error', 'Listening keeps stopping, so it has been turned off. Tap the parts instead, or try again.');
          return;
        }
        this.timer = setTimeout(() => {
          this.timer = null;
          if (!this.enabled) return;
          this.onState('listening', null);
          this.run();
        }, 300 * 2 ** this.failures);
      },
    });
  }
}

export function useStudentListener(onCommand: (command: StudentCommand, heard: string) => void) {
  const [status, setStatus] = useState<{ state: ListenerState; message: string | null }>({ state: 'off', message: null });
  const latest = useRef(onCommand);
  latest.current = onCommand;
  const listener = useMemo(
    () => new StudentListener(new BrowserSpeechAdapter('en-IN'), (command, heard) => latest.current(command, heard), (state, message) => setStatus({ state, message })),
    [],
  );
  useEffect(() => () => listener.stop(), [listener]);
  return { ...status, start: () => listener.start(), stop: () => listener.stop() };
}
