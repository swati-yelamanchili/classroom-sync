import { CheckCircle2, Clock, Loader2, Minus, PauseCircle, Plus, WifiOff } from 'lucide-react';
import { useState, type ReactNode } from 'react';
import { Link, useParams } from 'react-router-dom';
import type { StudentSnapshot } from '@classroom/shared';
import { SessionStatusBadge } from '@/components/badges';
import { Notice } from '@/components/feedback';
import { ScriptPanel, SourceLine, VideoPanel } from '@/components/ResourceContent';
import { Button } from '@/components/ui/button';
import { Card } from '@/components/ui/card';
import { usePageTitle } from '@/hooks/useAsync';
import { useStudentSession, type ConnectionState } from '@/hooks/useSessionChannel';
import { cn, readPreference, writePreference } from '@/lib/utils';

const TEXT_SIZES = ['1.1rem', '1.3rem', '1.55rem', '1.85rem'];
const TEXT_SIZE_PREF = 'classroom-sync.script-size';

function useTextSize() {
  const [step, setStep] = useState(() => {
    const stored = readPreference(TEXT_SIZE_PREF);
    const parsed = Number(stored);
    return stored !== null && Number.isInteger(parsed) && parsed >= 0 && parsed < TEXT_SIZES.length ? parsed : 1;
  });
  const change = (delta: number) => {
    const next = Math.min(TEXT_SIZES.length - 1, Math.max(0, step + delta));
    setStep(next);
    writePreference(TEXT_SIZE_PREF, String(next));
  };
  return { size: TEXT_SIZES[step]!, canShrink: step > 0, canGrow: step < TEXT_SIZES.length - 1, change };
}

function CenteredMessage({ Icon, title, children, spin }: { Icon: typeof Clock; title: string; children?: ReactNode; spin?: boolean }) {
  return (
    <div className="flex min-h-[60dvh] flex-col items-center justify-center px-4 text-center">
      <Icon className={cn('size-14 text-teal', spin && 'animate-spin')} aria-hidden />
      <h1 className="mt-4 text-4xl">{title}</h1>
      {children && <div className="mt-3 max-w-xl text-xl text-ink-soft">{children}</div>}
    </div>
  );
}

function ConnectionBanner({ connection }: { connection: ConnectionState }) {
  if (connection === 'synced') return null;
  return (
    <div role="alert" data-testid="connection-warning" className="sticky top-0 z-10 flex items-center justify-center gap-3 bg-bad px-4 py-3 text-center text-lg font-bold text-white">
      <WifiOff className="size-6 shrink-0" aria-hidden />
      Connection lost. Reconnecting… This page may not show the current topic until it reconnects.
    </div>
  );
}

/** Purely presentational: renders whatever authoritative state it is given. */
export function StudentLessonView({ snapshot, connection }: { snapshot: StudentSnapshot; connection: ConnectionState }) {
  const text = useTextSize();
  const topic = snapshot.currentTopic;

  // Announced politely so assistive technology hears about changes without losing its place.
  const announcement = (() => {
    if (snapshot.status === 'ended') return 'The lesson has ended.';
    if (snapshot.status === 'created') return 'Waiting for your teacher to begin.';
    if (snapshot.status === 'paused') return 'The lesson is paused.';
    return topic ? `Now showing Topic ${topic.number} of ${snapshot.totalTopics}: ${topic.displayTitle}.` : '';
  })();

  if (snapshot.status === 'created' || snapshot.status === 'ended') {
    return (
      <>
        <ConnectionBanner connection={connection} />
        <p role="status" className="sr-only">{announcement}</p>
        <main id="main" data-testid="student-status" data-status={snapshot.status}>
          {snapshot.status === 'created' ? (
            <CenteredMessage Icon={Clock} title="Waiting for your teacher">
              <p>You've joined <strong>{snapshot.lessonTitle}</strong>. The first topic will appear here when your teacher begins. You don't need to do anything.</p>
            </CenteredMessage>
          ) : (
            <CenteredMessage Icon={CheckCircle2} title="This lesson has ended">
              <p>Thank you for joining <strong>{snapshot.lessonTitle}</strong>. You can close this page.</p>
            </CenteredMessage>
          )}
        </main>
      </>
    );
  }

  return (
    <div className="flex min-h-dvh flex-col">
      <ConnectionBanner connection={connection} />
      <p role="status" className="sr-only" data-testid="student-announcement">{announcement}</p>
      <header key={`header-${topic?.index}`} className="animate-topic-flag border-b border-line bg-surface">
        <div className="mx-auto flex max-w-[92rem] flex-wrap items-center justify-between gap-x-6 gap-y-2 px-4 py-3 md:px-6">
          <div className="min-w-0">
            <p data-testid="student-topic-number" className="text-lg font-bold text-teal-dark">Topic {snapshot.currentTopicIndex + 1} of {snapshot.totalTopics}</p>
            <h1 data-testid="student-topic-title" className="text-3xl break-words md:text-4xl">{topic?.displayTitle}</h1>
          </div>
          <div data-testid="student-status" data-status={snapshot.status}>
            <SessionStatusBadge status={snapshot.status} />
          </div>
        </div>
      </header>

      {snapshot.status === 'paused' && (
        <div className="flex items-center justify-center gap-2 bg-warn-tint px-4 py-2 text-lg font-bold text-warn">
          <PauseCircle className="size-5" aria-hidden />Your teacher has paused the lesson.
        </div>
      )}

      <main id="main" key={`main-${topic?.index}`} className="animate-topic-in mx-auto w-full max-w-[92rem] flex-1 px-4 py-4 md:px-6 md:py-5">
        {topic?.resource ? (
          <div className="grid gap-4 md:grid-cols-[minmax(0,3fr)_minmax(0,2fr)] md:gap-5">
            <section aria-labelledby="video-heading" className="min-w-0">
              <Card className="p-3 md:p-4">
                <h2 id="video-heading" className="mb-2 text-xl">Sign language video</h2>
                <VideoPanel videoUrl={topic.resource.videoUrl} title={topic.resource.title} />
              </Card>
              <div className="mt-3"><SourceLine resource={topic.resource} /></div>
              {topic.resource.provenance === 'demo' && <p className="mt-2 text-ink-soft">This is a demonstration placeholder, not official Ashray Akruti content.</p>}
            </section>
            <section aria-labelledby="script-heading" className="flex min-w-0 flex-col">
              <Card className="flex min-h-0 flex-1 flex-col p-3 md:p-4">
                <div className="mb-2 flex items-center justify-between gap-3">
                  <h2 id="script-heading" className="text-xl">Script</h2>
                  <div role="group" aria-label="Script text size" className="flex items-center gap-1">
                    <Button variant="secondary" size="icon" disabled={!text.canShrink} onClick={() => text.change(-1)} aria-label="Smaller script text"><Minus aria-hidden /></Button>
                    <Button variant="secondary" size="icon" disabled={!text.canGrow} onClick={() => text.change(1)} aria-label="Larger script text"><Plus aria-hidden /></Button>
                  </div>
                </div>
                <div
                  tabIndex={0}
                  role="region"
                  aria-label="Script text"
                  className="flex-1 overflow-y-auto leading-relaxed md:max-h-[calc(100dvh-14rem)]"
                  style={{ fontSize: text.size }}
                >
                  <ScriptPanel scriptText={topic.resource.scriptText} language={topic.resource.language} />
                </div>
              </Card>
            </section>
          </div>
        ) : (
          <Notice tone="warn" className="text-xl">No resource is available for this topic. Please follow along with your teacher.</Notice>
        )}
      </main>
    </div>
  );
}

export function StudentLesson() {
  const { code } = useParams();
  const { snapshot, connection, joinError } = useStudentSession(code);
  usePageTitle(snapshot?.currentTopic ? `Topic ${snapshot.currentTopic.number}: ${snapshot.currentTopic.displayTitle}` : 'Your lesson');

  if (snapshot) return <StudentLessonView snapshot={snapshot} connection={connection} />;
  if (joinError) {
    return (
      <main id="main">
        <CenteredMessage Icon={Clock} title="We couldn't find that lesson">
          <p>{joinError}</p>
          <Button asChild size="lg" className="mt-5"><Link to="/join">Enter a code</Link></Button>
        </CenteredMessage>
      </main>
    );
  }
  return (
    <main id="main">
      <div role="status">
        <CenteredMessage Icon={connection === 'disconnected' ? WifiOff : Loader2} spin={connection !== 'disconnected'} title={connection === 'disconnected' ? 'Trying to connect…' : 'Joining your lesson…'} />
      </div>
    </main>
  );
}
