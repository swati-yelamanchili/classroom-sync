import type { SessionStatus, ChangeTopicRequest } from './types';

export type VoiceCommand =
  | { type: 'goto'; topicNumber: number }
  | { type: 'next' }
  | { type: 'previous' }
  | { type: 'pause' }
  | { type: 'resume' };

export interface VoiceGrammar {
  /** Phrases that must directly precede "topic <number>". */
  topicVerbs: string[];
  nextPhrases: string[];
  previousPhrases: string[];
  pausePhrases: string[];
  resumePhrases: string[];
  /** Optional spoken prefix, for example "classroom". */
  wakePhrase: string;
  requireWakePhrase: boolean;
}

export const DEFAULT_VOICE_GRAMMAR: VoiceGrammar = {
  topicVerbs: ['start', 'go to', 'switch to', 'repeat'],
  nextPhrases: ['next topic', 'go to next topic', 'go to the next topic'],
  previousPhrases: ['previous topic', 'go to previous topic', 'go to the previous topic'],
  pausePhrases: ['pause session', 'pause the session'],
  resumePhrases: ['resume session', 'resume the session'],
  wakePhrase: 'classroom',
  requireWakePhrase: false,
};

export function normalizeTranscript(transcript: string): string {
  return transcript
    .normalize('NFKC')
    .toLowerCase()
    .replace(/[^\p{L}\p{N}\s]/gu, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

const UNITS: Record<string, number> = {
  zero: 0, one: 1, two: 2, three: 3, four: 4, five: 5, six: 6, seven: 7, eight: 8, nine: 9,
  ten: 10, eleven: 11, twelve: 12, thirteen: 13, fourteen: 14, fifteen: 15, sixteen: 16,
  seventeen: 17, eighteen: 18, nineteen: 19,
};
const TENS: Record<string, number> = {
  twenty: 20, thirty: 30, forty: 40, fifty: 50, sixty: 60, seventy: 70, eighty: 80, ninety: 90,
};
// Speech engines commonly transcribe a spoken digit as its homophone. These are honoured only
// inside an otherwise complete command, so ordinary sentences cannot trigger them.
const HOMOPHONES: Record<string, number> = { won: 1, to: 2, too: 2, for: 4, ate: 8 };

/** Converts "3", "three" or "twenty one" to a number; anything else returns null. */
export function parseSpokenNumber(words: string): number | null {
  if (/^\d{1,3}$/.test(words)) return Number(words);
  const tokens = words.split(' ');
  if (tokens.length === 1) {
    const word = tokens[0]!;
    return UNITS[word] ?? TENS[word] ?? HOMOPHONES[word] ?? null;
  }
  if (tokens.length === 2) {
    const tens = TENS[tokens[0]!];
    const unit = UNITS[tokens[1]!];
    if (tens !== undefined && unit !== undefined && unit >= 1 && unit <= 9) return tens + unit;
  }
  return null;
}

/**
 * Strict whole-phrase grammar: the normalised transcript must be exactly one command, otherwise the
 * result is null. "Topic three is very important" and "today we will start topic three" are not
 * commands, by design.
 */
export function parseVoiceCommand(
  transcript: string,
  grammar: VoiceGrammar = DEFAULT_VOICE_GRAMMAR,
): VoiceCommand | null {
  let text = normalizeTranscript(transcript);
  const wake = normalizeTranscript(grammar.wakePhrase);
  if (wake && (text === wake || text.startsWith(`${wake} `))) {
    text = text.slice(wake.length).trim();
  } else if (grammar.requireWakePhrase) {
    return null;
  }
  if (!text) return null;

  if (grammar.nextPhrases.includes(text)) return { type: 'next' };
  if (grammar.previousPhrases.includes(text)) return { type: 'previous' };
  if (grammar.pausePhrases.includes(text)) return { type: 'pause' };
  if (grammar.resumePhrases.includes(text)) return { type: 'resume' };

  for (const verb of grammar.topicVerbs) {
    const prefix = `${verb} topic `;
    if (!text.startsWith(prefix)) continue;
    const topicNumber = parseSpokenNumber(text.slice(prefix.length).replace(/^number /, ''));
    if (topicNumber !== null) return { type: 'goto', topicNumber };
  }
  return null;
}

export function describeCommand(command: VoiceCommand): string {
  switch (command.type) {
    case 'goto':
      return `Go to Topic ${command.topicNumber}`;
    case 'next':
      return 'Next topic';
    case 'previous':
      return 'Previous topic';
    case 'pause':
      return 'Pause session';
    case 'resume':
      return 'Resume session';
  }
}

export interface CommandContext {
  status: SessionStatus;
  currentTopicIndex: number;
  totalTopics: number;
}

export type CommandDecision =
  | { ok: true; request: { kind: 'topic'; change: ChangeTopicRequest } | { kind: 'pause' } | { kind: 'resume' } }
  | { ok: false; reason: string };

/** Early, friendly validation on the teacher's device. The backend re-validates everything. */
export function validateCommand(command: VoiceCommand, context: CommandContext): CommandDecision {
  const { status, currentTopicIndex, totalTopics } = context;
  if (command.type === 'pause') {
    return status === 'active'
      ? { ok: true, request: { kind: 'pause' } }
      : { ok: false, reason: 'The session is not running, so it cannot be paused.' };
  }
  if (command.type === 'resume') {
    return status === 'paused'
      ? { ok: true, request: { kind: 'resume' } }
      : { ok: false, reason: 'The session is not paused, so it cannot be resumed.' };
  }
  if (status !== 'active' && status !== 'paused') {
    return { ok: false, reason: 'Start the session before changing topics.' };
  }
  if (command.type === 'goto') {
    if (command.topicNumber < 1 || command.topicNumber > totalTopics) {
      return { ok: false, reason: `There is no Topic ${command.topicNumber}. This lesson has ${totalTopics} topics.` };
    }
    return {
      ok: true,
      request: { kind: 'topic', change: { action: 'goto', index: command.topicNumber - 1, source: 'voice' } },
    };
  }
  if (command.type === 'next') {
    if (currentTopicIndex >= totalTopics - 1) return { ok: false, reason: 'Already on the last topic.' };
    return { ok: true, request: { kind: 'topic', change: { action: 'next', source: 'voice' } } };
  }
  if (currentTopicIndex <= 0) return { ok: false, reason: 'Already on the first topic.' };
  return { ok: true, request: { kind: 'topic', change: { action: 'previous', source: 'voice' } } };
}

/** Suppresses the same command repeating within a short window (engines can re-emit finals). */
export class CommandCooldown {
  private lastKey: string | null = null;
  private lastAt = 0;

  constructor(private readonly cooldownMs = 2500) {}

  allow(command: VoiceCommand, nowMs: number): boolean {
    const key = JSON.stringify(command);
    if (key === this.lastKey && nowMs - this.lastAt < this.cooldownMs) return false;
    this.lastKey = key;
    this.lastAt = nowMs;
    return true;
  }

  reset(): void {
    this.lastKey = null;
    this.lastAt = 0;
  }
}
