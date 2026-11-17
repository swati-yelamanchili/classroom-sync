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
const HOMOPHONES: Record<string, number> = { won: 1, to: 2, too: 2, tree: 3, for: 4, fore: 4, ate: 8 };

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

// Spellings speech engines produce for the same spoken words.
const SPELLINGS: Record<string, string> = { goto: 'go to', topics: 'topic' };

function tokensOf(text: string): string[] {
  return normalizeTranscript(text)
    .split(' ')
    .flatMap((word) => (SPELLINGS[word] ?? word).split(' '))
    .filter(Boolean);
}

function startsAt(tokens: string[], at: number, phrase: string[]): boolean {
  return phrase.length > 0 && phrase.every((word, i) => tokens[at + i] === word);
}

/**
 * Strict whole-phrase grammar: the normalised transcript must consist only of commands, otherwise
 * the result is empty. "Topic three is very important" and "today we will start topic three" are
 * not commands, by design. Several commands in one transcript are all returned, because continuous
 * recognition joins phrases spoken close together ("start topic 2 next topic").
 */
export function parseVoiceCommands(transcript: string, grammar: VoiceGrammar = DEFAULT_VOICE_GRAMMAR): VoiceCommand[] {
  const tokens = tokensOf(transcript);
  const wake = tokensOf(grammar.wakePhrase);
  const fixed: Array<[string[], VoiceCommand]> = [
    ...grammar.nextPhrases.map((p): [string[], VoiceCommand] => [tokensOf(p), { type: 'next' }]),
    ...grammar.previousPhrases.map((p): [string[], VoiceCommand] => [tokensOf(p), { type: 'previous' }]),
    ...grammar.pausePhrases.map((p): [string[], VoiceCommand] => [tokensOf(p), { type: 'pause' }]),
    ...grammar.resumePhrases.map((p): [string[], VoiceCommand] => [tokensOf(p), { type: 'resume' }]),
  ];
  const verbs = grammar.topicVerbs.map((verb) => [...tokensOf(verb), 'topic']);

  // Tries every command that fits at `at`, keeping the first reading that uses up all the words.
  const parseFrom = (at: number): VoiceCommand[] | null => {
    if (at === tokens.length) return [];
    let start = at;
    if (startsAt(tokens, start, wake)) start += wake.length;
    else if (grammar.requireWakePhrase) return null;

    const candidates: Array<[VoiceCommand, number]> = [];
    for (const [phrase, command] of fixed) {
      if (startsAt(tokens, start, phrase)) candidates.push([command, start + phrase.length]);
    }
    for (const verb of verbs) {
      if (!startsAt(tokens, start, verb)) continue;
      let numberAt = start + verb.length;
      if (tokens[numberAt] === 'number') numberAt += 1;
      for (const length of [2, 1]) {
        if (numberAt + length > tokens.length) continue;
        const topicNumber = parseSpokenNumber(tokens.slice(numberAt, numberAt + length).join(' '));
        if (topicNumber !== null) candidates.push([{ type: 'goto', topicNumber }, numberAt + length]);
      }
    }
    for (const [command, end] of candidates) {
      const rest = parseFrom(end);
      if (rest) return [command, ...rest];
    }
    return null;
  };
  return parseFrom(0) ?? [];
}

/** A transcript that is exactly one command, or null. */
export function parseVoiceCommand(transcript: string, grammar: VoiceGrammar = DEFAULT_VOICE_GRAMMAR): VoiceCommand | null {
  const commands = parseVoiceCommands(transcript, grammar);
  return commands.length === 1 ? commands[0]! : null;
}

export type PartCommand = { type: 'part'; partNumber: number } | { type: 'nextPart' } | { type: 'previousPart' };

/**
 * Finds "part 3", "part number three", "next part" or "previous part" anywhere in what was heard, and
 * returns the last one said. Unlike topic commands this is deliberately loose: it only moves one
 * student's own page, and teachers say "now part three" mid-sentence. Homophones ("part to") count
 * only at the very end, so "take part to win" does nothing.
 */
export function parsePartCommand(transcript: string): PartCommand | null {
  const tokens = tokensOf(transcript);
  let found: PartCommand | null = null;
  for (let i = 0; i < tokens.length; i += 1) {
    if (tokens[i] !== 'part') continue;
    if (tokens[i - 1] === 'next') found = { type: 'nextPart' };
    else if (tokens[i - 1] === 'previous') found = { type: 'previousPart' };
    const at = tokens[i + 1] === 'number' ? i + 2 : i + 1;
    for (const length of [2, 1]) {
      const words = tokens.slice(at, at + length);
      if (words.length !== length) continue;
      const partNumber = parseSpokenNumber(words.join(' '));
      if (partNumber === null) continue;
      if (length === 1 && HOMOPHONES[words[0]!] !== undefined && at + 1 !== tokens.length) continue;
      found = { type: 'part', partNumber };
      break;
    }
  }
  return found;
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
