import { ArrowLeft, ArrowRight, BookOpen, Mic, MicOff, Minus, Plus } from 'lucide-react';
import { useEffect, useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import { youtubeVideoId, type StudentLessonDTO } from '@classroom/shared';
import { EmptyState, Loading, Notice } from '@/components/feedback';
import { SourceLine, VideoPanel, type SeekRequest } from '@/components/ResourceContent';
import { SkipLink, Wordmark } from '@/components/TeacherShell';
import { TranscriptView } from '@/components/Transcript';
import { Button } from '@/components/ui/button';
import { Card } from '@/components/ui/card';
import { Input, Label } from '@/components/ui/field';
import { usePageTitle, useAsync } from '@/hooks/useAsync';
import { api } from '@/lib/api';
import { cn } from '@/lib/utils';
import { useTextSize } from '@/pages/StudentLesson';
import { useStudentListener, type StudentCommand } from '@/speech/studentListener';

const wordsOf = (text: string) => text.normalize('NFKD').replace(/\p{M}/gu, '').toLowerCase().split(/[^\p{L}\p{N}]+/u).filter(Boolean);

/** Every typed word must start a word of the title, in any order: "traf air" finds "Traffic Rules, Air". */
export function matchesLessonSearch(title: string, query: string): boolean {
  const titleWords = wordsOf(title);
  return wordsOf(query).every((q) => titleWords.some((w) => w.startsWith(q)));
}

/** Lessons the teacher has confirmed, for a student browsing without a session code. */
export function StudentLessonList() {
  usePageTitle('Choose a lesson');
  const { data: all, error, loading } = useAsync(() => api.studentLessons(), []);
  const [query, setQuery] = useState('');
  const data = all?.filter((lesson) => matchesLessonSearch(lesson.title, query)) ?? null;
  return (
    <div className="min-h-dvh px-4 py-5 md:px-6">
      <SkipLink />
      <Wordmark />
      <main id="main" className="mx-auto mt-8 max-w-2xl">
        <h1 className="text-4xl">Choose your lesson</h1>
        <p className="mt-2 text-xl text-ink-soft">Each topic has its sign language video and the video's transcript, line by line with times. Tap a time to watch that moment.</p>
        {(all?.length ?? 0) > 1 && (
          <div className="mt-6 space-y-1">
            <Label htmlFor="lesson-search" className="text-lg">Find a lesson</Label>
            <Input id="lesson-search" type="search" value={query} onChange={(e) => setQuery(e.target.value)} className="min-h-12 text-lg" />
          </div>
        )}
        <div className="mt-6">
          {loading && !data && <Loading />}
          {error && <Notice tone="error">{error}</Notice>}
          {data && data.length === 0 && query && <EmptyState title="No lessons match">Try fewer or shorter words.</EmptyState>}
          {data && data.length === 0 && !query && (
            <EmptyState title="No lessons yet">Your teacher has not prepared a lesson yet. If they gave you a code, <Link to="/join">join with the code</Link>.</EmptyState>
          )}
          {data && data.length > 0 && (
            <ul className="space-y-3">
              {data.map((lesson) => (
                <li key={lesson.id}>
                  <Link to={`/lessons/${lesson.id}`} className="group flex items-center gap-4 rounded-lg border border-line-strong bg-surface p-5 text-ink no-underline hover:bg-neutral-tint">
                    <BookOpen className="size-7 shrink-0 text-teal" aria-hidden />
                    <span className="min-w-0 flex-1">
                      <span className="block text-2xl font-bold break-words">{lesson.title}</span>
                      <span className="block text-ink-soft">{lesson.topicCount} {lesson.topicCount === 1 ? 'topic' : 'topics'}</span>
                    </span>
                    <ArrowRight className="size-6 shrink-0 transition-transform group-hover:translate-x-1" aria-hidden />
                  </Link>
                </li>
              ))}
            </ul>
          )}
        </div>
        <p className="mt-8 text-lg"><Link to="/join">Have a code from your teacher? Join the live lesson instead.</Link></p>
      </main>
    </div>
  );
}

/** Presentational, so it can be tested with any lesson. */
export function StudentSelfPacedView({ lesson }: { lesson: StudentLessonDTO }) {
  const [topicIndex, setTopicIndex] = useState(0);
  const [seek, setSeek] = useState<SeekRequest>(null);
  const [lastHeard, setLastHeard] = useState<string | null>(null);
  const [announcement, setAnnouncement] = useState('');
  const text = useTextSize();
  useEffect(() => setSeek(null), [topicIndex]);

  const topic = lesson.topics[topicIndex];

  const goToTopic = (index: number) => {
    if (index < 0 || index >= lesson.topics.length) return false;
    setTopicIndex(index);
    setAnnouncement(`Now showing Topic ${index + 1}: ${lesson.topics[index]!.displayTitle}.`);
    window.scrollTo({ top: 0, behavior: 'smooth' });
    return true;
  };

  const listener = useStudentListener((command: StudentCommand, heard: string) => {
    const target = command.type === 'topic' ? command.topicNumber - 1 : topicIndex + (command.type === 'nextTopic' ? 1 : -1);
    const done = goToTopic(target);
    const why = command.type === 'topic' ? `there is no Topic ${command.topicNumber}` : command.type === 'nextTopic' ? 'this is the last topic' : 'this is the first topic';
    setLastHeard(`Heard "${heard}": ${done ? `moved to Topic ${target + 1}` : `nothing changed, ${why}`}.`);
  });

  if (!topic) return <Notice tone="warn">This lesson has no topics.</Notice>;
  const listening = listener.state === 'listening' || listener.state === 'error';
  const videoUrl = topic.resource?.videoUrl ?? null;
  const hasTranscript = !!videoUrl && !!youtubeVideoId(videoUrl);

  return (
    <div className="flex min-h-dvh flex-col">
      <p role="status" className="sr-only" data-testid="topic-announcement">{announcement}</p>
      <header className="border-b border-line bg-surface">
        <div className="mx-auto max-w-[92rem] px-4 py-3 md:px-6">
          <Link to="/lessons" className="inline-flex items-center gap-1 text-ink-soft"><ArrowLeft className="size-4" aria-hidden />All lessons</Link>
          <p className="mt-1 font-bold text-teal-dark">{lesson.title}</p>
          <h1 data-testid="self-paced-topic-title" className="text-3xl break-words md:text-4xl">
            <span className="sr-only">Topic {topicIndex + 1}: </span>{topic.displayTitle}
          </h1>
          {lesson.topics.length > 1 && (
            <nav aria-label="Topics" className="mt-3 flex gap-2 overflow-x-auto pb-1">
              {lesson.topics.map((t, i) => (
                <Button key={t.number} size="sm" variant={i === topicIndex ? 'primary' : 'secondary'} aria-pressed={i === topicIndex} onClick={() => goToTopic(i)} className="shrink-0">
                  {t.number}. {t.displayTitle}
                </Button>
              ))}
            </nav>
          )}
          <div className="mt-3 flex flex-wrap items-center gap-2">
            <Button size="sm" variant={listening ? 'danger' : 'secondary'} onClick={listening ? listener.stop : listener.start} data-testid="listen-toggle">
              {listening ? <MicOff aria-hidden /> : <Mic aria-hidden />}
              {listening ? 'Stop listening' : 'Listen for my teacher'}
            </Button>
            <span role="group" aria-label="Text size" className="ml-auto flex items-center gap-1">
              <Button variant="secondary" size="icon" disabled={!text.canShrink} onClick={() => text.change(-1)} aria-label="Smaller text"><Minus aria-hidden /></Button>
              <Button variant="secondary" size="icon" disabled={!text.canGrow} onClick={() => text.change(1)} aria-label="Larger text"><Plus aria-hidden /></Button>
            </span>
          </div>
          <div className="mt-1 text-ink-soft" data-testid="listen-status">
            {listener.state === 'listening' && <p>Listening for your teacher to say "Start Topic 2", "next topic" or "previous topic".</p>}
            {listener.message && <p className={cn(listener.state !== 'listening' && 'font-bold text-bad')}>{listener.message}</p>}
            {lastHeard && <p data-testid="last-heard">{lastHeard}</p>}
          </div>
        </div>
      </header>

      <main id="main" className="mx-auto w-full max-w-[92rem] flex-1 px-4 py-4 md:px-6">
        <div className="grid gap-4 md:grid-cols-[minmax(0,1fr)_minmax(0,1fr)] md:gap-5">
          <section aria-labelledby="video-heading" className="min-w-0">
            {topic.resource ? (
              <>
                <Card className="p-3 md:p-4">
                  <h2 id="video-heading" className="mb-2 text-xl">Sign language video</h2>
                  <VideoPanel videoUrl={videoUrl} title={topic.resource.title} seek={seek} />
                </Card>
                <div className="mt-3"><SourceLine resource={topic.resource} /></div>
              </>
            ) : (
              <Notice tone="warn">No video for this topic. Follow your teacher.</Notice>
            )}
          </section>
          <section aria-labelledby="transcript-heading" className="min-w-0">
            <Card className="p-3 md:p-4">
              <h2 id="transcript-heading" className="mb-2 text-xl">Transcript</h2>
              {hasTranscript ? (
                <TranscriptView
                  key={`${lesson.id}-${topic.number}`}
                  load={() => api.studentTranscript(lesson.id, topic.number)}
                  loadKey={`${lesson.id}-${topic.number}`}
                  videoUrl={videoUrl}
                  onSeek={(seconds) => setSeek({ seconds, at: Date.now() })}
                  textSize={text.size}
                />
              ) : (
                <p className="text-ink-soft">Transcripts come from YouTube, and this topic has no YouTube video.</p>
              )}
            </Card>
          </section>
        </div>
      </main>
    </div>
  );
}

export function StudentSelfPaced() {
  const { id = '' } = useParams();
  const { data, error, loading } = useAsync(() => api.studentLesson(id), [id]);
  usePageTitle(data?.title ?? 'Your lesson');
  if (loading && !data) return <Loading label="Opening the lesson…" />;
  if (error && !data) {
    return (
      <main id="main" className="mx-auto max-w-xl px-4 py-24 text-center">
        <Notice tone="error">{error}</Notice>
        <Button asChild className="mt-6"><Link to="/lessons">Choose another lesson</Link></Button>
      </main>
    );
  }
  return data ? <StudentSelfPacedView lesson={data} /> : null;
}
