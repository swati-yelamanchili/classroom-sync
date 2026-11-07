import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it } from 'vitest';
import type { StudentSnapshot, TopicView } from '@classroom/shared';
import { ProvenanceBadge } from '@/components/badges';
import { ScriptPanel, VideoPanel } from '@/components/ResourceContent';
import { VoiceStatusDisplay } from '@/pages/LiveSession';
import { StudentLessonView } from '@/pages/StudentLesson';

const topic = (overrides: Partial<TopicView> = {}): TopicView => ({
  index: 1,
  number: 2,
  displayTitle: 'Subtraction',
  estimatedDurationSeconds: 60,
  resource: {
    title: 'Subtraction resource',
    videoUrl: 'https://example.com/page',
    scriptText: 'First line.\n\nSecond paragraph.',
    language: 'en',
    provenance: 'verified',
    sourceOrganisation: 'Ashray Akruti',
    sourceReference: 'REF-1',
  },
  ...overrides,
});

const snapshot = (overrides: Partial<StudentSnapshot> = {}): StudentSnapshot => ({
  sessionCode: 'ABC234',
  lessonTitle: 'Maths',
  revision: 3,
  status: 'active',
  syncMode: 'voice',
  currentTopicIndex: 1,
  totalTopics: 3,
  elapsedActiveSeconds: 10,
  topicStartedElapsedSeconds: 5,
  serverTime: 0,
  currentTopic: topic(),
  ...overrides,
});

describe('ScriptPanel', () => {
  it('preserves the exact text and line structure', () => {
    render(<ScriptPanel scriptText={'One\n\n  Two  \nThree'} />);
    const element = screen.getByTestId('script-text');
    expect(element.textContent).toBe('One\n\n  Two  \nThree');
    expect(element).toHaveClass('whitespace-pre-wrap');
  });
  it('shows markup as text instead of interpreting it', () => {
    const attack = '<img src=x onerror="alert(1)"><script>alert(2)</script>';
    const { container } = render(<ScriptPanel scriptText={attack} />);
    expect(screen.getByTestId('script-text').textContent).toBe(attack);
    expect(container.querySelector('img, script')).toBeNull();
  });
  it('says so when there is no script', () => {
    render(<ScriptPanel scriptText={null} />);
    expect(screen.getByText('No script is available for this resource.')).toBeInTheDocument();
  });
});

describe('VideoPanel', () => {
  it('embeds a direct file without autoplay', () => {
    const { container } = render(<VideoPanel videoUrl="/demo/demo-addition.mp4" title="Addition" />);
    const video = container.querySelector('video')!;
    expect(video).toHaveAttribute('controls');
    expect(video.autoplay).toBe(false);
    expect(screen.getByRole('link', { name: /new tab/i })).toHaveAttribute('href', '/demo/demo-addition.mp4');
  });
  it('uses the official player for YouTube', () => {
    render(<VideoPanel videoUrl="https://www.youtube.com/watch?v=abcdef12345" title="A" />);
    expect(screen.getByTitle('Sign language video: A')).toHaveAttribute('src', 'https://www.youtube-nocookie.com/embed/abcdef12345');
  });
  it('does not assume other pages can be embedded, and explains', () => {
    const { container } = render(<VideoPanel videoUrl="https://example.com/page" title="A" />);
    expect(container.querySelector('iframe, video')).toBeNull();
    expect(screen.getByText(/cannot be shown inside this page/)).toBeInTheDocument();
    const link = screen.getByRole('link', { name: /new tab/i });
    expect(link).toHaveAttribute('target', '_blank');
    expect(link).toHaveAttribute('rel', 'noopener noreferrer');
  });
  it('states when there is no video', () => {
    render(<VideoPanel videoUrl={null} title="A" />);
    expect(screen.getByText('No video is available for this resource.')).toBeInTheDocument();
  });
});

describe('StudentLessonView', () => {
  it('shows topic, video and script together', () => {
    render(<StudentLessonView snapshot={snapshot()} connection="synced" />);
    expect(screen.getByTestId('student-topic-number')).toHaveTextContent('Topic 2 of 3');
    expect(screen.getByRole('heading', { level: 1, name: 'Subtraction' })).toBeInTheDocument();
    expect(screen.getByRole('heading', { name: 'Sign language video' })).toBeInTheDocument();
    expect(screen.getByRole('link', { name: /new tab/i })).toBeInTheDocument();
    expect(screen.getByTestId('script-text').textContent).toBe('First line.\n\nSecond paragraph.');
  });
  it('announces the current topic to assistive technology', () => {
    render(<StudentLessonView snapshot={snapshot()} connection="synced" />);
    expect(screen.getByRole('status')).toHaveTextContent('Now showing Topic 2 of 3: Subtraction.');
  });
  it('replaces content when a new snapshot arrives', () => {
    const { rerender } = render(<StudentLessonView snapshot={snapshot()} connection="synced" />);
    rerender(
      <StudentLessonView
        snapshot={snapshot({
          revision: 4,
          currentTopicIndex: 2,
          currentTopic: topic({ index: 2, number: 3, displayTitle: 'Multiplication', resource: { ...topic().resource!, scriptText: 'Other script' } }),
        })}
        connection="synced"
      />,
    );
    expect(screen.getByRole('heading', { level: 1, name: 'Multiplication' })).toBeInTheDocument();
    expect(screen.getByTestId('script-text').textContent).toBe('Other script');
    expect(screen.queryByText('Subtraction')).toBeNull();
  });
  it('warns honestly while disconnected', () => {
    render(<StudentLessonView snapshot={snapshot()} connection="disconnected" />);
    expect(screen.getByRole('alert')).toHaveTextContent('Connection lost');
  });
  it('has no warning while synced', () => {
    render(<StudentLessonView snapshot={snapshot()} connection="synced" />);
    expect(screen.queryByRole('alert')).toBeNull();
  });
  it('shows waiting, paused and ended states', () => {
    const { rerender } = render(<StudentLessonView snapshot={snapshot({ status: 'created', currentTopic: null })} connection="synced" />);
    expect(screen.getByRole('heading', { name: 'Waiting for your teacher' })).toBeInTheDocument();
    rerender(<StudentLessonView snapshot={snapshot({ status: 'paused' })} connection="synced" />);
    expect(screen.getByText('Your teacher has paused the lesson.')).toBeInTheDocument();
    rerender(<StudentLessonView snapshot={snapshot({ status: 'ended', currentTopic: null })} connection="synced" />);
    expect(screen.getByRole('heading', { name: 'This lesson has ended' })).toBeInTheDocument();
  });
  it('is honest about a topic without a resource', () => {
    render(<StudentLessonView snapshot={snapshot({ currentTopic: topic({ resource: null }) })} connection="synced" />);
    expect(screen.getByText(/No resource is available for this topic/)).toBeInTheDocument();
  });
  it('labels demo content so it cannot pass as official', () => {
    render(<StudentLessonView snapshot={snapshot({ currentTopic: topic({ resource: { ...topic().resource!, provenance: 'demo' } }) })} connection="synced" />);
    expect(screen.getByText('Demo Resource')).toBeInTheDocument();
    expect(screen.getByText(/not official Ashray Akruti content/)).toBeInTheDocument();
  });
  it('offers no teacher controls', () => {
    render(<StudentLessonView snapshot={snapshot()} connection="synced" />);
    for (const name of [/next topic/i, /previous/i, /end session/i, /pause/i, /microphone/i]) {
      expect(screen.queryByRole('button', { name })).toBeNull();
    }
  });
  it('lets the student change script text size by keyboard', async () => {
    const user = userEvent.setup();
    render(<StudentLessonView snapshot={snapshot()} connection="synced" />);
    const region = screen.getByRole('region', { name: 'Script text' });
    const before = region.style.fontSize;
    screen.getByRole('button', { name: 'Larger script text' }).focus();
    await user.keyboard('{Enter}');
    expect(region.style.fontSize).not.toBe(before);
  });
});

describe('ProvenanceBadge', () => {
  it('uses distinct wording for demo and verified resources', () => {
    render(<><ProvenanceBadge provenance="demo" /><ProvenanceBadge provenance="verified" /><ProvenanceBadge provenance="unverified" /></>);
    expect(screen.getByText('Demo Resource')).toBeInTheDocument();
    expect(screen.getByText('Verified Ashray Akruti Resource')).toBeInTheDocument();
    expect(screen.getByText('Source not verified')).toBeInTheDocument();
  });
});

describe('VoiceStatusDisplay', () => {
  const base = { message: null, lastCommand: null, heardNonCommand: false };
  it.each([
    ['off', 'Microphone off'],
    ['listening', 'Listening'],
    ['processing', 'Processing command'],
    ['recognised', 'Command recognised'],
    ['rejected', 'Command rejected'],
    ['permission-denied', 'Microphone permission denied'],
    ['unavailable', 'Speech recognition unavailable'],
  ] as const)('shows %s as visible text', (state, label) => {
    render(<VoiceStatusDisplay status={{ ...base, state }} />);
    expect(screen.getByTestId('voice-state')).toHaveTextContent(label);
  });
  it('shows the most recent command and its result', () => {
    render(<VoiceStatusDisplay status={{ ...base, state: 'recognised', lastCommand: { heard: 'Start Topic 3', outcome: 'recognised', action: 'Switched to Topic 3: Multiplication' } }} />);
    expect(screen.getByTestId('last-command')).toHaveTextContent('Recognised: "Start Topic 3"');
    expect(screen.getByTestId('last-command')).toHaveTextContent('Action: Switched to Topic 3: Multiplication');
  });
});
