import { act, render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter } from 'react-router-dom';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { LessonPlanDTO, StudentLessonDTO } from '@classroom/shared';
import { LessonPlanView } from '@/components/LessonPlan';
import { api } from '@/lib/api';
import { formatTimestamp, matchesLessonSearch, StudentPlanLessonView } from '@/pages/StudentBrowse';
import { parseStudentCommand, StudentListener, type ListenerState, type StudentCommand } from '@/speech/studentListener';
import type { SpeechHandlers, SpeechRecognitionAdapter } from '@/speech/types';

class MockAdapter implements SpeechRecognitionAdapter {
  supported = true;
  handlers: SpeechHandlers | null = null;
  starts = 0;
  start(handlers: SpeechHandlers) {
    this.handlers = handlers;
    this.starts += 1;
    handlers.onStart();
  }
  stop() {}
}

const plan = (title: string): LessonPlanDTO => ({
  status: 'ready',
  parts: [1, 2, 3, 4, 5].map((n) => ({ title: `${title} part ${n}`, content: `- Teach ${title} ${n}` })),
  transcriptLanguage: 'ta',
  error: null,
  updatedAt: '2026-11-14T00:00:00.000Z',
});

describe('student commands', () => {
  it.each<[string, StudentCommand | null]>([
    ['Start topic 2', { type: 'topic', topicNumber: 2 }],
    ['next topic', { type: 'nextTopic' }],
    ['now we look at part three', { type: 'part', partNumber: 3 }],
    ['previous part', { type: 'previousPart' }],
    ['today we will start topic three', null],
  ])('"%s"', (heard, expected) => {
    expect(parseStudentCommand(heard)).toEqual(expected);
  });
});

describe('StudentListener', () => {
  const setup = () => {
    const adapter = new MockAdapter();
    const commands: StudentCommand[] = [];
    const states: ListenerState[] = [];
    let now = 0;
    const listener = new StudentListener(adapter, (c) => commands.push(c), (s) => states.push(s), () => now);
    return { adapter, commands, states, listener, advance: (ms: number) => (now += ms) };
  };

  it('acts on the first alternative that is a command, once per repeat window', () => {
    const { adapter, commands, listener, advance } = setup();
    listener.start();
    adapter.handlers!.onFinalResult(['heart three', 'part three']);
    adapter.handlers!.onFinalResult(['part three']);
    advance(3000);
    adapter.handlers!.onFinalResult(['part three']);
    adapter.handlers!.onFinalResult(['the water cycle']);
    expect(commands).toEqual([{ type: 'part', partNumber: 3 }, { type: 'part', partNumber: 3 }]);
  });

  it('restarts when the browser stops listening, and stops on permission denial', () => {
    vi.useFakeTimers();
    const { adapter, states, listener } = setup();
    listener.start();
    adapter.handlers!.onEnd();
    vi.advanceTimersByTime(400);
    expect(adapter.starts).toBe(2);
    adapter.handlers!.onError('not-allowed');
    adapter.handlers!.onEnd();
    vi.advanceTimersByTime(5000);
    expect(adapter.starts).toBe(2);
    expect(states.at(-1)).toBe('permission-denied');
    vi.useRealTimers();
  });

  it('says so when the browser cannot listen', () => {
    const { adapter, states, listener } = setup();
    adapter.supported = false;
    listener.start();
    expect(states).toEqual(['unavailable']);
  });
});

describe('LessonPlanView', () => {
  it('labels a ready plan as AI-written and numbers its parts', () => {
    render(<LessonPlanView plan={plan('Air')} currentPart={2} />);
    expect(screen.getByText(/Written by AI \(Gemini\)/)).toBeInTheDocument();
    expect(screen.getByTestId('plan-part-2')).toHaveAttribute('aria-current', 'step');
    expect(within(screen.getByTestId('plan-part-5')).getByRole('heading')).toHaveTextContent('Part 5: Air part 5');
  });

  it('shows why a plan failed and offers Try again', async () => {
    const onRetry = vi.fn();
    render(<LessonPlanView plan={{ ...plan('Air'), status: 'failed', parts: [], error: 'This video has no transcript.' }} onRetry={onRetry} />);
    expect(screen.getByText(/This video has no transcript/)).toBeInTheDocument();
    await userEvent.click(screen.getByRole('button', { name: 'Try again' }));
    expect(onRetry).toHaveBeenCalled();
  });

  it('explains when there can be no plan', () => {
    render(<LessonPlanView plan={null} />);
    expect(screen.getByText(/only for resources with a YouTube video/)).toBeInTheDocument();
  });
});

describe('student lesson with a plan', () => {
  // A scripted engine standing in for the browser's SpeechRecognition.
  let engine: { onresult?: (e: unknown) => void; results: unknown[] } | null = null;
  const say = (text: string) =>
    act(() => {
      const result = Object.assign([{ transcript: text }], { isFinal: true });
      engine!.results.push(result);
      engine!.onresult?.({ resultIndex: engine!.results.length - 1, results: engine!.results });
    });

  beforeEach(() => {
    engine = null;
    (window as unknown as { SpeechRecognition: unknown }).SpeechRecognition = class {
      results: unknown[] = [];
      onresult?: (e: unknown) => void;
      onstart?: () => void;
      start() {
        engine = this;
        this.onstart?.();
      }
      abort() {}
      stop() {}
    };
    Element.prototype.scrollIntoView = vi.fn();
    window.scrollTo = vi.fn() as unknown as typeof window.scrollTo;
  });
  afterEach(() => {
    delete (window as unknown as { SpeechRecognition?: unknown }).SpeechRecognition;
  });

  const lesson: StudentLessonDTO = {
    id: 'l1',
    title: 'EVS',
    topics: [
      { number: 1, displayTitle: 'Air', resource: null, plan: plan('Air') },
      { number: 2, displayTitle: 'Birds', resource: null, plan: plan('Birds') },
    ],
  };

  it('follows the teacher saying "part 3", going back, and changing topic', async () => {
    render(<MemoryRouter><StudentPlanLessonView lesson={lesson} /></MemoryRouter>);
    expect(screen.getByTestId('current-part')).toHaveTextContent('Part 1 of 5');

    await userEvent.click(screen.getByTestId('listen-toggle'));
    say('Now we will look at part 3');
    expect(screen.getByTestId('current-part')).toHaveTextContent('Part 3 of 5');
    expect(screen.getByTestId('plan-part-3')).toHaveAttribute('aria-current', 'step');
    expect(screen.getByTestId('last-heard')).toHaveTextContent('moved to Part 3');
    expect(Element.prototype.scrollIntoView).toHaveBeenCalled();

    say('part 2');
    expect(screen.getByTestId('current-part')).toHaveTextContent('Part 2 of 5');

    say('part 9');
    expect(screen.getByTestId('current-part')).toHaveTextContent('Part 2 of 5');
    expect(screen.getByTestId('last-heard')).toHaveTextContent('nothing changed, there is no Part 9');

    say('Start topic 2');
    expect(screen.getByTestId('plan-topic-title')).toHaveTextContent('Birds');
    expect(screen.getByTestId('current-part')).toHaveTextContent('Part 1 of 5');

    await userEvent.click(screen.getByRole('button', { name: 'Next part' }));
    expect(screen.getByTestId('current-part')).toHaveTextContent('Part 2 of 5');
  });
});

describe('transcript with timestamps', () => {
  it.each([[0, '0:00'], [65.4, '1:05'], [3725, '1:02:05']])('formats %s seconds as %s', (seconds, text) => {
    expect(formatTimestamp(seconds)).toBe(text);
  });

  it('loads only when asked, and links each time to that moment of the video', async () => {
    const fetch = vi.spyOn(api, 'studentTranscript').mockResolvedValue({
      language: 'ta',
      generated: true,
      segments: [{ start: 1.5, duration: 2, text: 'வணக்கம்' }, { start: 65.9, duration: 3, text: 'சிவப்பு என்றால் நிறுத்து' }],
    });
    const lesson: StudentLessonDTO = {
      id: 'l1',
      title: 'EVS',
      topics: [{
        number: 1,
        displayTitle: 'Traffic Rules',
        resource: { title: 'Traffic Rules', videoUrl: 'https://www.youtube.com/watch?v=abcdef12345', scriptText: null, language: 'ta', provenance: 'verified', sourceOrganisation: null, sourceReference: null },
        plan: plan('Traffic'),
      }],
    };
    render(<MemoryRouter><StudentPlanLessonView lesson={lesson} /></MemoryRouter>);
    expect(fetch).not.toHaveBeenCalled();

    await userEvent.click(screen.getByTestId('transcript-toggle'));
    expect(fetch).toHaveBeenCalledWith('l1', 1);
    const lines = await screen.findByTestId('transcript-lines');
    expect(within(lines).getAllByRole('listitem')).toHaveLength(2);
    expect(within(lines).getByRole('link', { name: /1:05/ })).toHaveAttribute('href', 'https://www.youtube.com/watch?v=abcdef12345&t=65s');
    expect(within(lines).getByText('சிவப்பு என்றால் நிறுத்து')).toHaveAttribute('lang', 'ta');
    expect(screen.getByText(/automatic captions \(ta\)/)).toBeInTheDocument();

    await userEvent.click(screen.getByTestId('transcript-toggle'));
    expect(screen.queryByTestId('transcript-lines')).not.toBeInTheDocument();
    fetch.mockRestore();
  });

  it('explains when there is no transcript', async () => {
    const fetch = vi.spyOn(api, 'studentTranscript').mockRejectedValue(new Error('This video has no transcript.'));
    render(<MemoryRouter><StudentPlanLessonView lesson={{ id: 'l1', title: 'EVS', topics: [{ number: 1, displayTitle: 'Air', resource: null, plan: plan('Air') }] }} /></MemoryRouter>);
    await userEvent.click(screen.getByTestId('transcript-toggle'));
    expect(await screen.findByText('This video has no transcript.')).toBeInTheDocument();
    fetch.mockRestore();
  });
});

describe('student lesson search', () => {
  it.each([
    ['traf air', true],
    ['Air', true],
    ['waste', true],
    ['', true],
    ['birds', false],
    ['ir', false],
  ])('"%s" against "Waste Management, Traffic Rules, Air" is %s', (query, expected) => {
    expect(matchesLessonSearch('Waste Management, Traffic Rules, Air', query)).toBe(expected);
  });
});
