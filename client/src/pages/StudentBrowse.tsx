import { ArrowLeft, ArrowRight, BookOpen, ChevronLeft, ChevronRight, FileText, Mic, MicOff, Minus, Plus } from 'lucide-react';
import { useEffect, useRef, useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import { youtubeVideoId, type StudentLessonDTO, type TranscriptDTO } from '@classroom/shared';
import { EmptyState, Loading, Notice } from '@/components/feedback';
import { LessonPlanView, usePollWhilePending } from '@/components/LessonPlan';
import { SourceLine, VideoPanel } from '@/components/ResourceContent';
import { SkipLink, Wordmark } from '@/components/TeacherShell';
import { Button } from '@/components/ui/button';
import { Card } from '@/components/ui/card';
import { Input, Label } from '@/components/ui/field';
import { usePageTitle, useAsync } from '@/hooks/useAsync';
import { api, errorMessage } from '@/lib/api';
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
        <p className="mt-2 text-xl text-ink-soft">Each topic has its sign language video and a lesson plan in parts. Turn on listening and the page follows your teacher saying "Part 2".</p>
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

function describe(command: StudentCommand): string {
  switch (command.type) {
    case 'part':
      return `Part ${command.partNumber}`;
    case 'nextPart':
      return 'Next part';
    case 'previousPart':
      return 'Previous part';
    case 'topic':
      return `Topic ${command.topicNumber}`;
    case 'nextTopic':
      return 'Next topic';
    case 'previousTopic':
      return 'Previous topic';
  }
}

/** 65.4 -> "1:05"; 3725 -> "1:02:05". */
export function formatTimestamp(seconds: number): string {
  const total = Math.floor(seconds);
  const pad = (n: number) => String(n).padStart(2, '0');
  const h = Math.floor(total / 3600);
  const m = Math.floor((total % 3600) / 60);
  return h ? `${h}:${pad(m)}:${pad(total % 60)}` : `${m}:${pad(total % 60)}`;
}

/** The video's raw captions with times, loaded only when the student asks for them. */
function TranscriptPanel({ lessonId, topicNumber, videoUrl, textSize }: { lessonId: string; topicNumber: number; videoUrl: string | null; textSize: string }) {
  const [open, setOpen] = useState(false);
  const [transcript, setTranscript] = useState<TranscriptDTO | null>(null);
  const [error, setError] = useState<string | null>(null);
  const videoId = videoUrl ? youtubeVideoId(videoUrl) : null;

  const toggle = async () => {
    setOpen(!open);
    if (open || transcript) return;
    setError(null);
    try {
      setTranscript(await api.studentTranscript(lessonId, topicNumber));
    } catch (e) {
      setError(errorMessage(e));
    }
  };

  return (
    <section aria-label="Transcript" className="mt-5">
      <Button variant="secondary" onClick={toggle} aria-expanded={open} aria-controls="transcript-panel" data-testid="transcript-toggle">
        <FileText aria-hidden />{open ? 'Hide transcript' : 'Show transcript with timestamps'}
      </Button>
      {open && (
        <div id="transcript-panel" className="mt-3">
          {error && <Notice tone="warn">{error}</Notice>}
          {!error && !transcript && <p role="status" className="text-ink-soft">Loading the transcript…</p>}
          {transcript && (
            <>
              <p className="mb-2 text-sm text-ink-soft">
                {transcript.generated ? "YouTube's automatic captions" : 'Captions'} ({transcript.language}), exactly as YouTube has them. They may contain mistakes. Tap a time to open the video there.
              </p>
              <ol tabIndex={0} aria-label="Transcript lines" data-testid="transcript-lines" className="max-h-[60vh] space-y-1 overflow-y-auto rounded-md border border-line bg-surface p-3" style={{ fontSize: textSize }}>
                {transcript.segments.map((segment, i) => {
                  const time = formatTimestamp(segment.start);
                  return (
                    <li key={i} className="flex gap-3">
                      {videoId ? (
                        <a href={`https://www.youtube.com/watch?v=${videoId}&t=${Math.floor(segment.start)}s`} target="_blank" rel="noopener noreferrer" className="shrink-0 font-mono font-bold tabular-nums" aria-label={`${time}, open the video at this time in a new tab`}>{time}</a>
                      ) : (
                        <span className="shrink-0 font-mono font-bold tabular-nums">{time}</span>
                      )}
                      <span lang={transcript.language}>{segment.text}</span>
                    </li>
                  );
                })}
              </ol>
            </>
          )}
        </div>
      )}
    </section>
  );
}

/** Presentational, so it can be tested with any lesson. */
export function StudentPlanLessonView({ lesson }: { lesson: StudentLessonDTO }) {
  const [topicIndex, setTopicIndex] = useState(0);
  const [part, setPart] = useState(1);
  const [lastHeard, setLastHeard] = useState<string | null>(null);
  const [announcement, setAnnouncement] = useState('');
  const text = useTextSize();
  const scrollOnChange = useRef(false);

  const topic = lesson.topics[topicIndex];
  const parts = topic?.plan?.status === 'ready' ? topic.plan.parts : [];

  const goToTopic = (index: number) => {
    if (index < 0 || index >= lesson.topics.length) return false;
    setTopicIndex(index);
    setPart(1);
    setAnnouncement(`Now showing Topic ${index + 1}: ${lesson.topics[index]!.displayTitle}.`);
    window.scrollTo({ top: 0, behavior: 'smooth' });
    return true;
  };

  const goToPart = (number: number) => {
    if (number < 1 || number > parts.length) return false;
    scrollOnChange.current = true;
    setPart(number);
    setAnnouncement(`Now showing Part ${number}: ${parts[number - 1]!.title}.`);
    return true;
  };

  const act = (command: StudentCommand, heard: string) => {
    let done = false;
    let why = '';
    if (command.type === 'topic') {
      done = goToTopic(command.topicNumber - 1);
      why = `there is no Topic ${command.topicNumber}`;
    } else if (command.type === 'nextTopic' || command.type === 'previousTopic') {
      done = goToTopic(topicIndex + (command.type === 'nextTopic' ? 1 : -1));
      why = command.type === 'nextTopic' ? 'this is the last topic' : 'this is the first topic';
    } else if (!parts.length) {
      why = 'this topic has no lesson plan yet';
    } else if (command.type === 'part') {
      done = goToPart(command.partNumber);
      why = `there is no Part ${command.partNumber}`;
    } else {
      done = goToPart(part + (command.type === 'nextPart' ? 1 : -1));
      why = command.type === 'nextPart' ? 'this is the last part' : 'this is the first part';
    }
    setLastHeard(`Heard "${heard}": ${done ? `moved to ${describe(command)}` : `nothing changed, ${why}`}.`);
  };
  const listener = useStudentListener(act);

  useEffect(() => {
    if (!scrollOnChange.current) return;
    scrollOnChange.current = false;
    document.getElementById(`part-${part}`)?.scrollIntoView({ behavior: 'smooth', block: 'start' });
  }, [part]);

  if (!topic) return <Notice tone="warn">This lesson has no topics.</Notice>;
  const listening = listener.state === 'listening' || listener.state === 'error';

  return (
    <div className="flex min-h-dvh flex-col">
      <p role="status" className="sr-only" data-testid="plan-announcement">{announcement}</p>
      <header className="border-b border-line bg-surface">
        <div className="mx-auto max-w-[92rem] px-4 py-3 md:px-6">
          <Link to="/lessons" className="inline-flex items-center gap-1 text-ink-soft"><ArrowLeft className="size-4" aria-hidden />All lessons</Link>
          <p className="mt-1 font-bold text-teal-dark">{lesson.title}</p>
          <h1 data-testid="plan-topic-title" className="text-3xl break-words md:text-4xl">
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
        </div>
      </header>

      <div className="sticky top-0 z-10 border-b border-line bg-paper/95 backdrop-blur">
        <div className="mx-auto flex max-w-[92rem] flex-wrap items-center gap-2 px-4 py-2 md:px-6">
          <Button
            size="sm"
            variant={listening ? 'danger' : 'primary'}
            onClick={listening ? listener.stop : listener.start}
            data-testid="listen-toggle"
          >
            {listening ? <MicOff aria-hidden /> : <Mic aria-hidden />}
            {listening ? 'Stop listening' : 'Listen for my teacher'}
          </Button>
          <span className="flex items-center gap-1">
            <Button size="sm" variant="secondary" onClick={() => goToPart(part - 1)} disabled={part <= 1 || !parts.length} aria-label="Previous part"><ChevronLeft aria-hidden /></Button>
            <span className="min-w-20 text-center font-bold" data-testid="current-part">{parts.length ? `Part ${part} of ${parts.length}` : 'No parts'}</span>
            <Button size="sm" variant="secondary" onClick={() => goToPart(part + 1)} disabled={part >= parts.length} aria-label="Next part"><ChevronRight aria-hidden /></Button>
          </span>
          <span role="group" aria-label="Text size" className="ml-auto flex items-center gap-1">
            <Button variant="secondary" size="icon" disabled={!text.canShrink} onClick={() => text.change(-1)} aria-label="Smaller text"><Minus aria-hidden /></Button>
            <Button variant="secondary" size="icon" disabled={!text.canGrow} onClick={() => text.change(1)} aria-label="Larger text"><Plus aria-hidden /></Button>
          </span>
        </div>
        <div className="mx-auto max-w-[92rem] px-4 pb-2 text-ink-soft md:px-6" data-testid="listen-status">
          {listener.state === 'listening' && <p>Listening for "Part 1" to "Part {parts.length || 5}", "next part", "previous part" or "Start Topic 2".</p>}
          {listener.message && <p className={cn(listener.state !== 'listening' && 'font-bold text-bad')}>{listener.message}</p>}
          {lastHeard && <p data-testid="last-heard">{lastHeard}</p>}
        </div>
      </div>

      <main id="main" className="mx-auto w-full max-w-[92rem] flex-1 px-4 py-4 md:px-6">
        <div className="grid gap-4 md:grid-cols-[minmax(0,2fr)_minmax(0,3fr)] md:gap-5">
          <section aria-labelledby="video-heading" className="min-w-0">
            {topic.resource ? (
              <>
                <Card className="p-3 md:p-4">
                  <h2 id="video-heading" className="mb-2 text-xl">Sign language video</h2>
                  <VideoPanel videoUrl={topic.resource.videoUrl} title={topic.resource.title} />
                </Card>
                <div className="mt-3"><SourceLine resource={topic.resource} /></div>
              </>
            ) : (
              <Notice tone="warn">No video for this topic. Follow your teacher.</Notice>
            )}
          </section>
          <section aria-labelledby="plan-heading" className="min-w-0">
            <h2 id="plan-heading" className="mb-2 text-xl">Lesson plan</h2>
            <LessonPlanView plan={topic.plan} currentPart={parts.length ? part : undefined} onSelectPart={goToPart} textSize={text.size} />
            {topic.plan && <TranscriptPanel key={topic.number} lessonId={lesson.id} topicNumber={topic.number} videoUrl={topic.resource?.videoUrl ?? null} textSize={text.size} />}
          </section>
        </div>
      </main>
    </div>
  );
}

export function StudentPlanLesson() {
  const { id = '' } = useParams();
  const { data, error, loading, reload } = useAsync(() => api.studentLesson(id), [id]);
  usePageTitle(data?.title ?? 'Your lesson');
  usePollWhilePending(!!data?.topics.some((t) => t.plan?.status === 'pending'), reload);
  if (loading && !data) return <Loading label="Opening the lesson…" />;
  if (error && !data) {
    return (
      <main id="main" className="mx-auto max-w-xl px-4 py-24 text-center">
        <Notice tone="error">{error}</Notice>
        <Button asChild className="mt-6"><Link to="/lessons">Choose another lesson</Link></Button>
      </main>
    );
  }
  return data ? <StudentPlanLessonView lesson={data} /> : null;
}
