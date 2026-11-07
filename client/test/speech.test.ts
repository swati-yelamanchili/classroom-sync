import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { BrowserSpeechAdapter } from '@/speech/browserAdapter';
import { SpeechRecognitionService, type CommandRequest, type VoiceStatus } from '@/speech/SpeechRecognitionService';
import type { SpeechHandlers, SpeechRecognitionAdapter } from '@/speech/types';

class MockAdapter implements SpeechRecognitionAdapter {
  supported = true;
  handlers: SpeechHandlers | null = null;
  starts = 0;
  stops = 0;
  start(handlers: SpeechHandlers) {
    this.handlers = handlers;
    this.starts += 1;
    handlers.onStart();
  }
  stop() {
    this.stops += 1;
  }
  say(...alternatives: string[]) {
    this.handlers!.onFinalResult(alternatives);
  }
}

function setup(context = { status: 'active' as const, currentTopicIndex: 0, totalTopics: 3 }) {
  const adapter = new MockAdapter();
  const statuses: VoiceStatus[] = [];
  const dispatch = vi.fn(async (request: CommandRequest) => (request.kind === 'topic' ? 'Switched' : request.kind));
  const service = new SpeechRecognitionService({
    adapter,
    getContext: () => context,
    dispatch,
    onStatus: (s) => statuses.push(s),
    cooldownMs: 1000,
    resultHoldMs: 500,
    restartDelayMs: 100,
    maxConsecutiveFailures: 3,
    now: () => Date.now(),
  });
  const last = () => statuses[statuses.length - 1]!;
  return { adapter, statuses, dispatch, service, last };
}

const flush = () => vi.advanceTimersByTimeAsync(0);

describe('SpeechRecognitionService', () => {
  beforeEach(() => vi.useFakeTimers());
  afterEach(() => vi.useRealTimers());

  it('listens only after being enabled and stops when disabled', () => {
    const { adapter, service, last } = setup();
    expect(adapter.starts).toBe(0);
    service.enable();
    expect(adapter.starts).toBe(1);
    expect(last().state).toBe('listening');
    service.disable();
    expect(adapter.stops).toBe(1);
    expect(last().state).toBe('off');
  });

  it('dispatches a valid command and reports what happened', async () => {
    const { adapter, service, dispatch, statuses, last } = setup();
    service.enable();
    adapter.say('Start Topic 3');
    await flush();
    expect(dispatch).toHaveBeenCalledWith({ kind: 'topic', change: { action: 'goto', index: 2, source: 'voice' } });
    expect(statuses.map((s) => s.state)).toContain('processing');
    expect(last()).toMatchObject({ state: 'recognised', lastCommand: { heard: 'Start Topic 3', outcome: 'recognised', action: 'Switched' } });
  });

  it('returns to listening after showing the result', async () => {
    const { adapter, service, last } = setup();
    service.enable();
    adapter.say('next topic');
    await flush();
    await vi.advanceTimersByTimeAsync(600);
    expect(last().state).toBe('listening');
    expect(last().lastCommand?.heard).toBe('next topic');
  });

  it('ignores ordinary speech without keeping the words', async () => {
    const { adapter, service, dispatch, last } = setup();
    service.enable();
    adapter.say('Today we will study mathematics');
    adapter.say('Topic three is very important');
    await flush();
    expect(dispatch).not.toHaveBeenCalled();
    expect(last()).toMatchObject({ state: 'listening', lastCommand: null, heardNonCommand: true });
    expect(JSON.stringify(last())).not.toContain('mathematics');
  });

  it('rejects an out-of-range topic without contacting the backend', async () => {
    const { adapter, service, dispatch, last } = setup();
    service.enable();
    adapter.say('Start Topic 99');
    await flush();
    expect(dispatch).not.toHaveBeenCalled();
    expect(last()).toMatchObject({ state: 'rejected', lastCommand: { outcome: 'rejected' } });
    expect(last().lastCommand!.action).toContain('There is no Topic 99');
  });

  it('applies the duplicate-command cooldown, then allows the command again', async () => {
    const { adapter, service, dispatch } = setup();
    service.enable();
    adapter.say('Start Topic 2');
    adapter.say('Start Topic 2');
    await flush();
    expect(dispatch).toHaveBeenCalledTimes(1);
    await vi.advanceTimersByTimeAsync(1100);
    adapter.say('Start Topic 2');
    await flush();
    expect(dispatch).toHaveBeenCalledTimes(2);
  });

  it('checks the engine\'s alternative transcripts', async () => {
    const { adapter, service, dispatch } = setup();
    service.enable();
    adapter.say('star topic tree', 'start topic three');
    await flush();
    expect(dispatch).toHaveBeenCalledWith({ kind: 'topic', change: { action: 'goto', index: 2, source: 'voice' } });
  });

  it('surfaces a backend rejection', async () => {
    const { adapter, service, dispatch, last } = setup();
    dispatch.mockRejectedValueOnce(new Error('This session has ended and cannot be changed.'));
    service.enable();
    adapter.say('next topic');
    await flush();
    expect(last()).toMatchObject({ state: 'rejected', lastCommand: { action: 'This session has ended and cannot be changed.' } });
  });

  it('processes nothing once disabled', async () => {
    const { adapter, service, dispatch } = setup();
    service.enable();
    const handlers = adapter.handlers!;
    service.disable();
    handlers.onFinalResult(['start topic 2']);
    await flush();
    expect(dispatch).not.toHaveBeenCalled();
  });

  it('restarts when the browser ends recognition on its own', async () => {
    const { adapter, service } = setup();
    service.enable();
    adapter.handlers!.onError('no-speech');
    adapter.handlers!.onEnd();
    await vi.advanceTimersByTimeAsync(150);
    expect(adapter.starts).toBe(2);
  });

  it('does not restart after the user disables the microphone', async () => {
    const { adapter, service } = setup();
    service.enable();
    const handlers = adapter.handlers!;
    service.disable();
    handlers.onEnd();
    await vi.advanceTimersByTimeAsync(1000);
    expect(adapter.starts).toBe(1);
  });

  it('reports a denied microphone and does not retry', async () => {
    const { adapter, service, last } = setup();
    service.enable();
    adapter.handlers!.onError('not-allowed');
    adapter.handlers!.onEnd();
    await vi.advanceTimersByTimeAsync(1000);
    expect(last().state).toBe('permission-denied');
    expect(adapter.starts).toBe(1);
  });

  it('backs off on repeated errors, then stops and says so', async () => {
    const { adapter, service, last } = setup();
    service.enable();
    for (let i = 0; i < 3; i += 1) {
      adapter.handlers!.onError('network');
      adapter.handlers!.onEnd();
      await vi.advanceTimersByTimeAsync(5000);
    }
    expect(adapter.starts).toBe(3);
    expect(last().state).toBe('error');
    expect(last().message).toContain('Voice control has stopped');
  });

  it('reports unsupported browsers instead of failing', () => {
    const adapter = new MockAdapter();
    adapter.supported = false;
    const service = new SpeechRecognitionService({
      adapter,
      getContext: () => ({ status: 'active', currentTopicIndex: 0, totalTopics: 1 }),
      dispatch: async () => '',
      onStatus: () => undefined,
    });
    service.enable();
    expect(adapter.starts).toBe(0);
    expect(service.currentStatus.state).toBe('unavailable');
  });
});

describe('BrowserSpeechAdapter', () => {
  afterEach(() => vi.unstubAllGlobals());

  class FakeRecognition {
    static last: FakeRecognition;
    continuous = false;
    interimResults = true;
    maxAlternatives = 1;
    lang = '';
    onstart: (() => void) | null = null;
    onresult: ((event: unknown) => void) | null = null;
    onerror: ((event: { error: string }) => void) | null = null;
    onend: (() => void) | null = null;
    started = false;
    aborted = false;
    constructor() {
      FakeRecognition.last = this;
    }
    start() {
      this.started = true;
    }
    stop() {}
    abort() {
      this.aborted = true;
    }
  }

  const result = (isFinal: boolean, ...texts: string[]) => Object.assign(texts.map((transcript) => ({ transcript })), { isFinal });

  it('is unsupported when the browser has no recognition API', () => {
    expect(new BrowserSpeechAdapter('en-IN').supported).toBe(false);
  });

  it('configures the engine and delivers each final result once', () => {
    vi.stubGlobal('webkitSpeechRecognition', FakeRecognition);
    const adapter = new BrowserSpeechAdapter('en-IN');
    expect(adapter.supported).toBe(true);
    const onFinalResult = vi.fn();
    adapter.start({ onStart: vi.fn(), onFinalResult, onError: vi.fn(), onEnd: vi.fn() });
    const engine = FakeRecognition.last;
    expect(engine).toMatchObject({ continuous: true, interimResults: false, lang: 'en-IN', started: true });

    engine.onresult!({ resultIndex: 0, results: [result(false, 'start')] });
    expect(onFinalResult).not.toHaveBeenCalled();
    engine.onresult!({ resultIndex: 0, results: [result(true, 'start topic 2', 'start topic to')] });
    expect(onFinalResult).toHaveBeenCalledWith(['start topic 2', 'start topic to']);
    // Re-delivery of an already handled index, as some engines do.
    engine.onresult!({ resultIndex: 0, results: [result(true, 'start topic 2')] });
    expect(onFinalResult).toHaveBeenCalledTimes(1);
    engine.onresult!({ resultIndex: 1, results: [result(true, 'start topic 2'), result(true, 'next topic')] });
    expect(onFinalResult).toHaveBeenLastCalledWith(['next topic']);

    adapter.stop();
    expect(engine.aborted).toBe(true);
  });

  it('maps unknown engine errors', () => {
    vi.stubGlobal('SpeechRecognition', FakeRecognition);
    const onError = vi.fn();
    new BrowserSpeechAdapter('en-IN').start({ onStart: vi.fn(), onFinalResult: vi.fn(), onError, onEnd: vi.fn() });
    FakeRecognition.last.onerror!({ error: 'not-allowed' });
    FakeRecognition.last.onerror!({ error: 'something-new' });
    expect(onError.mock.calls).toEqual([['not-allowed'], ['unknown']]);
  });
});
