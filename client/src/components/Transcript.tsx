import { Captions, RefreshCw, Search } from 'lucide-react';
import { useState } from 'react';
import { languageName, youtubeVideoId, type TranscriptDTO } from '@classroom/shared';
import { Notice } from '@/components/feedback';
import { Button } from '@/components/ui/button';
import { Input, Label } from '@/components/ui/field';
import { useAsync } from '@/hooks/useAsync';
import { errorMessage } from '@/lib/api';
import { cn } from '@/lib/utils';

/** 65.4 -> "1:05"; 3725 -> "1:02:05". */
export function formatTimestamp(seconds: number): string {
  const total = Math.floor(seconds);
  const pad = (n: number) => String(n).padStart(2, '0');
  const h = Math.floor(total / 3600);
  const m = Math.floor((total % 3600) / 60);
  return h ? `${h}:${pad(m)}:${pad(total % 60)}` : `${m}:${pad(total % 60)}`;
}

const fold = (text: string) => text.normalize('NFKC').toLowerCase();

/**
 * A video's captions, line by line with their times, exactly as YouTube has them. With `onSeek`,
 * tapping a time plays the video on the page from there; otherwise times link to YouTube.
 */
export function TranscriptView({
  load,
  loadKey,
  videoUrl,
  onSeek,
  onRefetch,
  textSize,
  maxHeight = 'max-h-[65vh]',
}: {
  load: () => Promise<TranscriptDTO>;
  /** Changing it loads again, for example when the topic changes. */
  loadKey: string;
  videoUrl: string | null;
  onSeek?: (seconds: number) => void;
  onRefetch?: () => Promise<TranscriptDTO>;
  textSize?: string;
  maxHeight?: string;
}) {
  const { data, setData, error, loading } = useAsync(load, [loadKey]);
  const [query, setQuery] = useState('');
  const [active, setActive] = useState<number | null>(null);
  const [refetching, setRefetching] = useState(false);
  const [refetchError, setRefetchError] = useState<string | null>(null);
  const videoId = videoUrl ? youtubeVideoId(videoUrl) : null;

  const refetch = async () => {
    if (!onRefetch) return;
    setRefetching(true);
    setRefetchError(null);
    try {
      setData(await onRefetch());
    } catch (e) {
      setRefetchError(errorMessage(e));
    } finally {
      setRefetching(false);
    }
  };

  if (loading && !data) return <p role="status" className="text-ink-soft">Loading the transcript… The first time a video is opened this takes a few seconds.</p>;
  if (error && !data) return <Notice tone="warn">{error}</Notice>;
  if (!data) return null;
  if (data.status === 'failed') {
    return (
      <Notice tone="warn">
        <p>No transcript. {data.error}</p>
        {onRefetch && (
          <Button variant="secondary" size="sm" className="mt-2" onClick={refetch} disabled={refetching}>
            <RefreshCw aria-hidden />{refetching ? 'Fetching…' : 'Fetch again'}
          </Button>
        )}
        {refetchError && <p className="mt-2">{refetchError}</p>}
      </Notice>
    );
  }

  const needle = fold(query.trim());
  const lines = data.segments.map((segment, index) => ({ ...segment, index }));
  const shown = needle ? lines.filter((line) => fold(line.text).includes(needle)) : lines;
  const lang = data.language ?? undefined;

  return (
    <div data-testid="transcript">
      <p className="mb-2 flex items-start gap-2 text-sm text-ink-soft">
        <Captions className="mt-0.5 size-4 shrink-0" aria-hidden />
        <span>
          {data.generated ? "YouTube's automatic captions" : 'Captions'}
          {data.language ? ` in ${languageName(data.language)}` : ''}, exactly as YouTube has them, so they may contain mistakes.{' '}
          {onSeek ? 'Tap a time to play the video from there.' : videoId ? 'Each time opens the video there.' : ''}
        </span>
      </p>
      <div className="mb-2">
        <Label htmlFor={`transcript-search-${loadKey}`} className="sr-only">Find in transcript</Label>
        <div className="relative">
          <Search className="pointer-events-none absolute top-1/2 left-3 size-4 -translate-y-1/2 text-ink-soft" aria-hidden />
          <Input
            id={`transcript-search-${loadKey}`}
            type="search"
            placeholder="Find in transcript"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            className="pl-9"
            data-testid="transcript-search"
          />
        </div>
        {needle && (
          <p className="mt-1 text-sm text-ink-soft" role="status">
            {shown.length} of {lines.length} lines contain "{query.trim()}"
          </p>
        )}
      </div>
      <ol
        tabIndex={0}
        aria-label="Transcript lines"
        data-testid="transcript-lines"
        className={cn('space-y-1 overflow-y-auto rounded-md border border-line bg-surface p-2 md:p-3', maxHeight)}
        style={textSize ? { fontSize: textSize } : undefined}
      >
        {shown.map((line) => {
          const time = formatTimestamp(line.start);
          const timeClass = 'shrink-0 rounded px-1.5 py-0.5 font-mono font-bold tabular-nums text-teal-dark';
          return (
            <li key={line.index} className={cn('flex gap-3 rounded-md px-1 py-0.5', active === line.index && 'bg-teal-tint ring-1 ring-teal')} aria-current={active === line.index ? 'true' : undefined}>
              {onSeek ? (
                <button
                  type="button"
                  className={cn(timeClass, 'underline underline-offset-3 hover:bg-teal-tint')}
                  onClick={() => {
                    setActive(line.index);
                    onSeek(line.start);
                  }}
                  aria-label={`Play from ${time}`}
                >
                  {time}
                </button>
              ) : videoId ? (
                <a href={`https://www.youtube.com/watch?v=${videoId}&t=${Math.floor(line.start)}s`} target="_blank" rel="noopener noreferrer" className={timeClass} aria-label={`${time}, open the video at this time in a new tab`}>
                  {time}
                </a>
              ) : (
                <span className={timeClass}>{time}</span>
              )}
              <span lang={lang}>{line.text}</span>
            </li>
          );
        })}
      </ol>
    </div>
  );
}
