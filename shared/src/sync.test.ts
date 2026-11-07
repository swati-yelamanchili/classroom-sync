import { describe, expect, it } from 'vitest';
import { newerSnapshot } from './revision';
import { canChangeTopic, canTransition } from './stateMachine';
import { computeElapsedSeconds, computeTimerAdvances, formatClock, secondsUntilNextAdvance } from './timing';
import { classifyVideoUrl, isAllowedVideoUrl } from './video';

describe('newerSnapshot', () => {
  const at = (revision: number, topic: number) => ({ revision, topic });
  it('accepts the first snapshot and newer ones', () => {
    expect(newerSnapshot(null, at(1, 0))).toEqual(at(1, 0));
    expect(newerSnapshot(at(1, 0), at(2, 1))).toEqual(at(2, 1));
  });
  it('ignores duplicates and older out-of-order snapshots', () => {
    const current = at(5, 2);
    expect(newerSnapshot(current, at(5, 9))).toBe(current);
    expect(newerSnapshot(current, at(4, 0))).toBe(current);
  });
  it('converges to the highest revision whatever the arrival order', () => {
    const arrivals = [at(3, 2), at(1, 0), at(4, 1), at(2, 5), at(4, 1)];
    const final = arrivals.reduce<ReturnType<typeof at> | null>((state, s) => newerSnapshot(state, s), null);
    expect(final).toEqual(at(4, 1));
  });
});

describe('session state machine', () => {
  it('permits the documented transitions', () => {
    expect(canTransition('created', 'active')).toBe(true);
    expect(canTransition('active', 'paused')).toBe(true);
    expect(canTransition('paused', 'active')).toBe(true);
    expect(canTransition('paused', 'ended')).toBe(true);
  });
  it('has no way out of ended', () => {
    for (const to of ['created', 'active', 'paused', 'ended'] as const) expect(canTransition('ended', to)).toBe(false);
  });
  it('rejects skipping states', () => {
    expect(canTransition('created', 'paused')).toBe(false);
    expect(canTransition('active', 'created')).toBe(false);
  });
  it('allows topic changes only in a live session', () => {
    expect(canChangeTopic('active')).toBe(true);
    expect(canChangeTopic('paused')).toBe(true);
    expect(canChangeTopic('created')).toBe(false);
    expect(canChangeTopic('ended')).toBe(false);
  });
});

describe('timing', () => {
  it('accumulates elapsed time only while running', () => {
    expect(computeElapsedSeconds({ elapsedActiveSeconds: 10, activeSinceMs: null }, 99_000)).toBe(10);
    expect(computeElapsedSeconds({ elapsedActiveSeconds: 10, activeSinceMs: 1000 }, 6000)).toBe(15);
  });
  const state = { currentTopicIndex: 0, topicStartedElapsedSeconds: 0, durationsSeconds: [60, 60, 60] };
  it('does not advance before the boundary', () => {
    expect(computeTimerAdvances(state, 59.9)).toEqual([]);
  });
  it('advances exactly at the boundary', () => {
    expect(computeTimerAdvances(state, 60)).toEqual([{ toIndex: 1, topicStartedElapsedSeconds: 60 }]);
  });
  it('emits every intermediate topic when catching up and stops on the last topic', () => {
    expect(computeTimerAdvances(state, 10_000)).toEqual([
      { toIndex: 1, topicStartedElapsedSeconds: 60 },
      { toIndex: 2, topicStartedElapsedSeconds: 120 },
    ]);
  });
  it('honours per-topic durations', () => {
    const custom = { currentTopicIndex: 0, topicStartedElapsedSeconds: 0, durationsSeconds: [10, 100, 5] };
    expect(computeTimerAdvances(custom, 50).map((a) => a.toIndex)).toEqual([1]);
  });
  it('restarts the clock from the time a topic began (manual jump)', () => {
    const jumped = { currentTopicIndex: 1, topicStartedElapsedSeconds: 30, durationsSeconds: [60, 60, 60] };
    expect(computeTimerAdvances(jumped, 80)).toEqual([]);
    expect(secondsUntilNextAdvance(jumped, 80)).toBe(10);
  });
  it('reports nothing to wait for on the final topic', () => {
    expect(secondsUntilNextAdvance({ ...state, currentTopicIndex: 2 }, 0)).toBeNull();
  });
  it('formats a clock', () => {
    expect(formatClock(65)).toBe('01:05');
    expect(formatClock(3725)).toBe('1:02:05');
  });
});

describe('video URLs', () => {
  it('rejects unsafe or malformed URLs', () => {
    for (const bad of ['javascript:alert(1)', 'data:text/html,x', 'not a url', 'ftp://x/y.mp4', '/demo/../secret', '/etc/passwd']) {
      expect(isAllowedVideoUrl(bad)).toBe(false);
    }
  });
  it('accepts http(s) and local demo assets', () => {
    expect(isAllowedVideoUrl('https://example.com/a')).toBe(true);
    expect(isAllowedVideoUrl('/demo/demo-addition.mp4')).toBe(true);
  });
  it('plays direct media files', () => {
    expect(classifyVideoUrl('https://x.org/a/b.MP4').kind).toBe('file');
    expect(classifyVideoUrl('/demo/demo-addition.mp4').kind).toBe('file');
  });
  it('embeds YouTube and Vimeo only through their official players', () => {
    expect(classifyVideoUrl('https://www.youtube.com/watch?v=abcdef12345')).toMatchObject({ kind: 'embed', embedUrl: 'https://www.youtube-nocookie.com/embed/abcdef12345' });
    expect(classifyVideoUrl('https://youtu.be/abcdef12345').kind).toBe('embed');
    expect(classifyVideoUrl('https://vimeo.com/12345')).toMatchObject({ kind: 'embed', embedUrl: 'https://player.vimeo.com/video/12345' });
  });
  it('never assumes any other page can be embedded', () => {
    expect(classifyVideoUrl('https://example.com/video-page').kind).toBe('link');
    expect(classifyVideoUrl('https://www.youtube.com/channel/abc').kind).toBe('link');
  });
});
