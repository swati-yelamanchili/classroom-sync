import { describe, expect, it } from 'vitest';
import { CommandCooldown, DEFAULT_VOICE_GRAMMAR, normalizeTranscript, parsePartCommand, parseSpokenNumber, parseVoiceCommand, parseVoiceCommands, validateCommand } from './voice';

const context = { status: 'active' as const, currentTopicIndex: 0, totalTopics: 3 };

describe('parseVoiceCommand', () => {
  it.each([
    ['Start Topic 3', 3],
    ['Start topic three', 3],
    ['start topic 3.', 3],
    ['Go to topic 2', 2],
    ['Go to topic three', 3],
    ['Switch to topic one', 1],
    ['Repeat Topic 2', 2],
    ['start topic twenty one', 21],
    ['start topic number four', 4],
    ['start topic to', 2],
  ])('%s -> Topic %i', (phrase, topicNumber) => {
    expect(parseVoiceCommand(phrase)).toEqual({ type: 'goto', topicNumber });
  });

  it.each([
    ['Next Topic', 'next'],
    ['go to the next topic', 'next'],
    ['Previous Topic', 'previous'],
    ['Pause Session', 'pause'],
    ['Resume Session', 'resume'],
  ])('%s -> %s', (phrase, type) => {
    expect(parseVoiceCommand(phrase)).toEqual({ type });
  });

  it.each([
    'Today we will study mathematics',
    'Topic three is very important',
    'today we will start topic three',
    'start topic three now',
    'start topic',
    'start the topic',
    'we should go to topic two after lunch',
    'next',
    'the next topic is hard',
    'pause',
    'start topic addition',
    'start topic for the class',
    '',
  ])('rejects ordinary speech: "%s"', (phrase) => {
    expect(parseVoiceCommand(phrase)).toBeNull();
  });

  it('keeps out-of-range numbers parseable so they can be rejected with a reason', () => {
    expect(parseVoiceCommand('Start Topic 99')).toEqual({ type: 'goto', topicNumber: 99 });
  });

  it('accepts an optional wake phrase by default', () => {
    expect(parseVoiceCommand('Classroom, start Topic 3')).toEqual({ type: 'goto', topicNumber: 3 });
    expect(parseVoiceCommand('start topic 3')).toEqual({ type: 'goto', topicNumber: 3 });
  });

  it('demands the wake phrase when configured', () => {
    const grammar = { ...DEFAULT_VOICE_GRAMMAR, requireWakePhrase: true };
    expect(parseVoiceCommand('start topic 3', grammar)).toBeNull();
    expect(parseVoiceCommand('Classroom, start topic 3', grammar)).toEqual({ type: 'goto', topicNumber: 3 });
    expect(parseVoiceCommand('classroom', grammar)).toBeNull();
  });

  it('uses a configured wake phrase and verbs', () => {
    const grammar = { ...DEFAULT_VOICE_GRAMMAR, wakePhrase: 'hello board', requireWakePhrase: true, topicVerbs: ['show'] };
    expect(parseVoiceCommand('Hello board, show topic 2', grammar)).toEqual({ type: 'goto', topicNumber: 2 });
    expect(parseVoiceCommand('hello board, start topic 2', grammar)).toBeNull();
  });

  it.each([
    ['goto topic 3', { type: 'goto', topicNumber: 3 }],
    ['Next topics', { type: 'next' }],
    ['start topic tree', { type: 'goto', topicNumber: 3 }],
  ])('accepts the engine spelling "%s"', (phrase, command) => {
    expect(parseVoiceCommand(phrase)).toEqual(command);
  });
});

describe('parseVoiceCommands', () => {
  it('splits commands that recognition joined into one transcript', () => {
    expect(parseVoiceCommands('Start topic 2 next topic')).toEqual([{ type: 'goto', topicNumber: 2 }, { type: 'next' }]);
    expect(parseVoiceCommands('start topic twenty one pause session')).toEqual([{ type: 'goto', topicNumber: 21 }, { type: 'pause' }]);
    expect(parseVoiceCommands('go to topic 3 go to topic 2')).toEqual([{ type: 'goto', topicNumber: 3 }, { type: 'goto', topicNumber: 2 }]);
  });

  it('returns nothing when any part is ordinary speech', () => {
    expect(parseVoiceCommands('start topic 2 and then we will read')).toEqual([]);
    expect(parseVoiceCommands('ok next topic')).toEqual([]);
    expect(parseVoiceCommands('')).toEqual([]);
  });

  it('needs the wake phrase before each command when it is required', () => {
    const grammar = { ...DEFAULT_VOICE_GRAMMAR, requireWakePhrase: true };
    expect(parseVoiceCommands('classroom start topic 2 classroom next topic', grammar)).toEqual([{ type: 'goto', topicNumber: 2 }, { type: 'next' }]);
    expect(parseVoiceCommands('classroom start topic 2 next topic', grammar)).toEqual([]);
  });

  it('treats a joined pair as two commands, not one', () => {
    expect(parseVoiceCommand('start topic 2 next topic')).toBeNull();
  });
});

describe('parseSpokenNumber', () => {
  it.each([['3', 3], ['twelve', 12], ['forty two', 42], ['ninety', 90]])('%s = %i', (words, n) => {
    expect(parseSpokenNumber(words)).toBe(n);
  });
  it.each(['two three', 'hundred', 'twenty twenty', 'twenty ten', '1000', 'x'])('%s is not a number', (words) => {
    expect(parseSpokenNumber(words)).toBeNull();
  });
});

describe('normalizeTranscript', () => {
  it('lowercases and strips punctuation', () => {
    expect(normalizeTranscript('  Start,  Topic-3! ')).toBe('start topic 3');
  });
});

describe('validateCommand', () => {
  it('converts a spoken topic number to a zero-based position', () => {
    expect(validateCommand({ type: 'goto', topicNumber: 3 }, context)).toEqual({
      ok: true,
      request: { kind: 'topic', change: { action: 'goto', index: 2, source: 'voice' } },
    });
  });
  it.each([0, 4, 99])('rejects Topic %i in a three-topic lesson', (topicNumber) => {
    expect(validateCommand({ type: 'goto', topicNumber }, context).ok).toBe(false);
  });
  it('rejects moving past either end', () => {
    expect(validateCommand({ type: 'previous' }, context).ok).toBe(false);
    expect(validateCommand({ type: 'next' }, { ...context, currentTopicIndex: 2 }).ok).toBe(false);
  });
  it('rejects topic changes before start and after end', () => {
    expect(validateCommand({ type: 'next' }, { ...context, status: 'created' }).ok).toBe(false);
    expect(validateCommand({ type: 'goto', topicNumber: 1 }, { ...context, status: 'ended' }).ok).toBe(false);
  });
  it('only pauses a running session and only resumes a paused one', () => {
    expect(validateCommand({ type: 'pause' }, context).ok).toBe(true);
    expect(validateCommand({ type: 'resume' }, context).ok).toBe(false);
    expect(validateCommand({ type: 'resume' }, { ...context, status: 'paused' }).ok).toBe(true);
  });
});

describe('CommandCooldown', () => {
  it('suppresses the same command inside the window only', () => {
    const cooldown = new CommandCooldown(1000);
    const command = { type: 'goto', topicNumber: 2 } as const;
    expect(cooldown.allow(command, 0)).toBe(true);
    expect(cooldown.allow(command, 500)).toBe(false);
    expect(cooldown.allow(command, 1500)).toBe(true);
  });
  it('does not delay a different command', () => {
    const cooldown = new CommandCooldown(1000);
    expect(cooldown.allow({ type: 'goto', topicNumber: 2 }, 0)).toBe(true);
    expect(cooldown.allow({ type: 'goto', topicNumber: 3 }, 100)).toBe(true);
  });
});

describe('parsePartCommand', () => {
  it.each([
    ['Part 3', 3],
    ['part three', 3],
    ['Now look at part 2 of the lesson', 2],
    ['part number four', 4],
    ['go to part 1. Actually part 5', 5],
    ['and finally part to', 2],
  ])('"%s" goes to part %i', (heard, partNumber) => {
    expect(parsePartCommand(heard)).toEqual({ type: 'part', partNumber });
  });

  it('understands next and previous part', () => {
    expect(parsePartCommand('next part')).toEqual({ type: 'nextPart' });
    expect(parsePartCommand('Okay, previous part please')).toEqual({ type: 'previousPart' });
  });

  it.each(['take part to win', 'every part of the plant', 'the parts are listed', 'topic 3', ''])('ignores "%s"', (heard) => {
    expect(parsePartCommand(heard)).toBeNull();
  });
});
