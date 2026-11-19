import { act, render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter } from 'react-router-dom';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { StudentLessonDTO, StudentSnapshot, TranscriptDTO } from '@classroom/shared';
import { formatTimestamp, TranscriptView } from '@/components/Transcript';
import { api } from '@/lib/api';
import { matchesLessonSearch, StudentSelfPacedView } from '@/pages/StudentBrowse';
import { StudentLessonView } from '@/pages/StudentLesson';
import { parseStudentCommand, StudentListener, type ListenerState, type StudentCommand } from '@/speech/studentListener';
import type { SpeechHandlers, SpeechRecognitionAdapter } from '@/speech/types';

const YOUTUBE = 'https://www.youtube.com/watch?v=abcdef12345';
const transcript: TranscriptDTO = {
  status: 'ready',
  language: 'ta',
  generated: true,
  segments: [
    { start: 1.5, duration: 2, text: 'வணக்கம் மாணவர்களே' },
    { start: 65.9, duration: 3, text: 'சிவப்பு என்றால் நிறுத்து' },
    { start: 70, duration: 3, text: 'பச்சை என்றால் செல்' },
  ],
  error: null,
};

afterEach(() => vi.restoreAllMocks());

describe('formatTimestamp', () => {
  it.each([[0, '0:00'], [65.9, '1:05'], [3725, '1:02:05']])('%s seconds is %s', (seconds, text) => {
    expect(formatTimestamp(seconds)).toBe(text);
  });
});

describe('TranscriptView', () => {
  it('lists every line with its time, and tapping a time plays the video from there', async () => {
    const onSeek = vi.fn();
    render(<TranscriptView load={async () => transcript} loadKey="a" videoUrl={YOUTUBE} onSeek={onSeek} />);
    const lines = await screen.findByTestId('transcript-lines');
    expect(within(lines).getAllByRole('listitem')).toHaveLength(3);
    expect(within(lines).getByText('சிவப்பு என்றால் நிறுத்து')).toHaveAttribute('lang', 'ta');
    expect(screen.getByText(/automatic captions in Tamil/)).toBeInTheDocument();

    await userEvent.click(within(lines).getByRole('button', { name: 'Play from 1:05' }));
    expect(onSeek).toHaveBeenCalledWith(65.9);
    expect(within(lines).getAllByRole('listitem')[1]).toHaveAttribute('aria-current', 'true');
  });

  it('finds words in the transcript', async () => {
    render(<TranscriptView load={async () => transcript} loadKey="a" videoUrl={YOUTUBE} onSeek={() => undefined} />);
    await userEvent.type(await screen.findByTestId('transcript-search'), 'என்றால்');
    expect(within(screen.getByTestId('transcript-lines')).getAllByRole('listitem')).toHaveLength(2);
    expect(screen.getByText('2 of 3 lines contain "என்றால்"')).toBeInTheDocument();
  });

  it('links times to YouTube when the video is not on the page', async () => {
    render(<TranscriptView load={async () => transcript} loadKey="a" videoUrl={YOUTUBE} />);
    expect(await screen.findByRole('link', { name: /1:05/ })).toHaveAttribute('href', `${YOUTUBE}&t=65s`);
  });

  it('shows why there is no transcript, and can fetch again', async () => {
    const onRefetch = vi.fn(async () => transcript);
    render(<TranscriptView load={async () => ({ ...transcript, status: 'failed', segments: [], error: 'This video has no transcript.' })} loadKey="a" videoUrl={YOUTUBE} onRefetch={onRefetch} />);
    expect(await screen.findByText(/This video has no transcript/)).toBeInTheDocument();
    await userEvent.click(screen.getByRole('button', { name: 'Fetch again' }));
    expect(await screen.findByTestId('transcript-lines')).toBeInTheDocument();
  });

  it('explains a request that failed', async () => {
    render(<TranscriptView load={() => Promise.reject(new Error('This topic has no video, so there is no transcript.'))} loadKey="a" videoUrl={null} />);
    expect(await screen.findByText('This topic has no video, so there is no transcript.')).toBeInTheDocument();
  });
});

describe('live student page', () => {
  it('shows the timestamped transcript where a YouTube lesson has no script, and plays from a tapped time', async () => {
    const load = vi.spyOn(api, 'sessionTranscript').mockResolvedValue(transcript);
    const snapshot = {
      sessionCode: 'ABC234',
      lessonTitle: 'EVS',
      revision: 2,
      status: 'active',
      syncMode: 'voice',
      currentTopicIndex: 0,
      totalTopics: 1,
      elapsedActiveSeconds: 0,
      topicStartedElapsedSeconds: 0,
      currentTopic: {
        index: 0,
        number: 1,
        displayTitle: 'Traffic Rules',
        estimatedDurationSeconds: 60,
        resource: { title: 'Traffic Rules', videoUrl: YOUTUBE, scriptText: null, language: 'ta', provenance: 'verified', sourceOrganisation: null, sourceReference: null },
      },
    } as unknown as StudentSnapshot;
    render(<StudentLessonView snapshot={snapshot} connection="synced" />);
    expect(screen.getByRole('heading', { name: 'Transcript' })).toBeInTheDocument();
    expect(load).toHaveBeenCalledWith('ABC234', 1);
    await userEvent.click(await screen.findByRole('button', { name: 'Play from 1:05' }));
    expect(screen.getByTitle('Sign language video: Traffic Rules')).toHaveAttribute('src', 'https://www.youtube-nocookie.com/embed/abcdef12345?start=65&autoplay=1');
  });
});

describe('self-paced student page', () => {
  // A scripted engine standing in for the browser's SpeechRecognition.
  let engine: { onresult?: (e: unknown) => void; results: unknown[] } | null = null;
  const say = (text: string) =>
    act(() => {
      engine!.results.push(Object.assign([{ transcript: text }], { isFinal: true }));
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
    window.scrollTo = vi.fn() as unknown as typeof window.scrollTo;
  });
  afterEach(() => {
    delete (window as unknown as { SpeechRecognition?: unknown }).SpeechRecognition;
  });

  const resource = (title: string, videoUrl: string | null) => ({ title, videoUrl, scriptText: null, language: 'ta', provenance: 'verified' as const, sourceOrganisation: null, sourceReference: null });
  const lesson: StudentLessonDTO = {
    id: 'l1',
    title: 'EVS',
    topics: [
      { number: 1, displayTitle: 'Traffic Rules', resource: resource('Traffic Rules', YOUTUBE) },
      { number: 2, displayTitle: 'Addition', resource: resource('Addition', '/demo/demo-addition.mp4') },
    ],
  };

  it('puts the transcript beside the video, plays from a tapped time, and follows "Start Topic 2"', async () => {
    const load = vi.spyOn(api, 'studentTranscript').mockResolvedValue(transcript);
    render(<MemoryRouter><StudentSelfPacedView lesson={lesson} /></MemoryRouter>);
    expect(load).toHaveBeenCalledWith('l1', 1);
    await userEvent.click(await screen.findByRole('button', { name: 'Play from 1:10' }));
    expect(screen.getByTitle('Sign language video: Traffic Rules')).toHaveAttribute('src', 'https://www.youtube-nocookie.com/embed/abcdef12345?start=70&autoplay=1');

    await userEvent.click(screen.getByTestId('listen-toggle'));
    say('now look at part 3');
    expect(screen.getByTestId('self-paced-topic-title')).toHaveTextContent('Traffic Rules');
    say('Start topic 2');
    expect(screen.getByTestId('self-paced-topic-title')).toHaveTextContent('Addition');
    expect(screen.getByText(/this topic has no YouTube video/)).toBeInTheDocument();
    say('start topic 9');
    expect(screen.getByTestId('last-heard')).toHaveTextContent('nothing changed, there is no Topic 9');
  });
});

describe('student commands', () => {
  it.each<[string, StudentCommand | null]>([
    ['Start topic 2', { type: 'topic', topicNumber: 2 }],
    ['next topic', { type: 'nextTopic' }],
    ['previous topic', { type: 'previousTopic' }],
    ['part three', null],
    ['today we will start topic three', null],
    ['pause session', null],
  ])('"%s"', (heard, expected) => {
    expect(parseStudentCommand(heard)).toEqual(expected);
  });
});

describe('StudentListener', () => {
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
    adapter.handlers!.onFinalResult(['start topic tree house', 'start topic 3']);
    adapter.handlers!.onFinalResult(['start topic 3']);
    advance(3000);
    adapter.handlers!.onFinalResult(['start topic 3']);
    expect(commands).toEqual([{ type: 'topic', topicNumber: 3 }, { type: 'topic', topicNumber: 3 }]);
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

describe('student lesson search', () => {
  it.each([
    ['traf air', true],
    ['Air', true],
    ['', true],
    ['birds', false],
    ['ir', false],
  ])('"%s" against "Waste Management, Traffic Rules, Air" is %s', (query, expected) => {
    expect(matchesLessonSearch('Waste Management, Traffic Rules, Air', query)).toBe(expected);
  });
});
