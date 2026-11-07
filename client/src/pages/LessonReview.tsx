import { ArrowDown, ArrowLeft, ArrowUp, CheckCircle2, Eye, FileText, FileX, Mic, Plus, RefreshCw, Replace, Timer, Trash2, Video, VideoOff } from 'lucide-react';
import { useState, type FormEvent } from 'react';
import { Link, useLocation, useNavigate, useParams } from 'react-router-dom';
import type { LessonDTO, LessonTopicDTO, ResourceDTO, SyncMode } from '@classroom/shared';
import { MatchBadge, ProvenanceBadge, SessionStatusBadge } from '@/components/badges';
import { EmptyState, Loading, Notice } from '@/components/feedback';
import { ResourcePreview } from '@/components/ResourceContent';
import { PageBody } from '@/components/TeacherShell';
import { Button } from '@/components/ui/button';
import { Card } from '@/components/ui/card';
import { Dialog } from '@/components/ui/dialog';
import { Input, Label } from '@/components/ui/field';
import { useAsync, usePageTitle } from '@/hooks/useAsync';
import { api, ApiRequestError, errorMessage, type LessonTopicPatch } from '@/lib/api';
import { cn, formatDateTime } from '@/lib/utils';

function Availability({ available, kind }: { available: boolean; kind: 'Video' | 'Script' }) {
  const Icon = kind === 'Video' ? (available ? Video : VideoOff) : available ? FileText : FileX;
  return (
    <span className={cn('inline-flex items-center gap-1.5', available ? 'text-good' : 'text-bad')}>
      <Icon className="size-4" aria-hidden />
      {kind}: {available ? 'available' : 'not available'}
    </span>
  );
}

function ReplaceDialog({
  topic,
  onClose,
  onChoose,
}: {
  topic: LessonTopicDTO | null;
  onClose: () => void;
  onChoose: (resourceId: string | null) => void;
}) {
  const [query, setQuery] = useState('');
  const library = useAsync(() => api.resources(query.trim() || undefined), [query]);
  return (
    <Dialog open={topic !== null} onOpenChange={(o) => !o && onClose()} title={`Choose a resource for "${topic?.displayTitle ?? ''}"`} description="Only resources that exist in the library can be chosen.">
      <Label htmlFor="resource-search">Search the library</Label>
      <Input id="resource-search" className="mt-1.5" value={query} onChange={(e) => setQuery(e.target.value)} autoFocus />
      <div className="mt-4 space-y-2" aria-live="polite">
        {library.error && <Notice tone="error">{library.error}</Notice>}
        {library.data?.length === 0 && <p className="text-ink-soft">No resources match that search.</p>}
        {library.data?.map((resource: ResourceDTO) => (
          <button
            key={resource.id}
            type="button"
            onClick={() => onChoose(resource.id)}
            className={cn('block w-full rounded-md border border-line p-3 text-left hover:border-teal hover:bg-teal-tint', topic?.resource?.id === resource.id && 'border-teal')}
          >
            <span className="block font-bold">{resource.title}</span>
            <span className="mt-1 flex flex-wrap items-center gap-x-3 gap-y-1 text-sm">
              <ProvenanceBadge provenance={resource.provenance} />
              <Availability available={!!resource.videoUrl} kind="Video" />
              <Availability available={!!resource.scriptText} kind="Script" />
            </span>
          </button>
        ))}
      </div>
      <div className="mt-5 border-t border-line pt-4">
        <Button variant="secondary" onClick={() => onChoose(null)}>Leave without a resource</Button>
      </div>
    </Dialog>
  );
}

function TopicRow({
  topic,
  total,
  busy,
  locked,
  showDuration,
  onMove,
  onRemove,
  onReplace,
  onPreview,
  onDuration,
  onRename,
}: {
  topic: LessonTopicDTO;
  total: number;
  busy: boolean;
  locked: boolean;
  showDuration: boolean;
  onMove: (delta: -1 | 1) => void;
  onRemove: () => void;
  onReplace: () => void;
  onPreview: () => void;
  onDuration: (seconds: number) => void;
  onRename: (title: string) => void;
}) {
  const [duration, setDuration] = useState(String(topic.estimatedDurationSeconds));
  const [editing, setEditing] = useState(false);
  const [name, setName] = useState(topic.displayTitle);
  const number = topic.position + 1;

  const commitDuration = () => {
    const seconds = Number(duration);
    if (Number.isInteger(seconds) && seconds >= 1) {
      if (seconds !== topic.estimatedDurationSeconds) onDuration(seconds);
    } else {
      setDuration(String(topic.estimatedDurationSeconds));
    }
  };

  return (
    <li className="flex gap-4 p-4 md:p-5" data-testid={`topic-${number}`}>
      <div className="flex size-11 shrink-0 items-center justify-center rounded-md bg-teal-tint text-lg font-bold text-teal-dark" aria-hidden>{number}</div>
      <div className="min-w-0 flex-1">
        {editing ? (
          <form
            className="flex flex-wrap items-center gap-2"
            onSubmit={(e: FormEvent) => {
              e.preventDefault();
              const trimmed = name.trim();
              if (trimmed && trimmed !== topic.displayTitle) onRename(trimmed);
              setEditing(false);
            }}
          >
            <Label htmlFor={`name-${topic.id}`} className="sr-only">Name for Topic {number}</Label>
            <Input id={`name-${topic.id}`} value={name} onChange={(e) => setName(e.target.value)} className="max-w-sm" autoFocus />
            <Button type="submit" size="sm">Save name</Button>
          </form>
        ) : (
          <h3 className="text-lg">
            <span className="sr-only">Topic {number}: </span>{topic.displayTitle}
            {!locked && (
              <button type="button" className="ml-2 text-sm font-normal text-teal-dark underline underline-offset-3" onClick={() => setEditing(true)} aria-label={`Rename Topic ${number}`}>Rename</button>
            )}
          </h3>
        )}

        {topic.resource ? (
          <p className="mt-1">
            <span className="text-ink-soft">Resource:</span> <span className="font-bold">{topic.resource.title}</span>
          </p>
        ) : (
          <p className="mt-1 font-bold text-bad">No matching resource found in the current library.</p>
        )}

        <div className="mt-2 flex flex-wrap items-center gap-x-4 gap-y-1.5 text-[0.94rem]">
          <MatchBadge status={topic.matchStatus} confidence={topic.matchConfidence} />
          {topic.resource && <ProvenanceBadge provenance={topic.resource.provenance} />}
          {topic.resource && <Availability available={!!topic.resource.videoUrl} kind="Video" />}
          {topic.resource && <Availability available={!!topic.resource.scriptText} kind="Script" />}
        </div>
        {topic.matchStatus !== 'unresolved' && topic.matchExplanation && <p className="mt-1.5 text-ink-soft">{topic.matchExplanation}</p>}
        {topic.sequenceNote && <p className="mt-1.5 text-ink-soft">{topic.sequenceNote}</p>}

        <div className="mt-3 flex flex-wrap items-center gap-2">
          {topic.resource && <Button variant="secondary" size="sm" onClick={onPreview} aria-label={`Preview resource for Topic ${number}`}><Eye aria-hidden />Preview</Button>}
          {!locked && (
            <>
              <Button variant="secondary" size="sm" onClick={onReplace} aria-label={`${topic.resource ? 'Replace' : 'Choose'} resource for Topic ${number}`}><Replace aria-hidden />{topic.resource ? 'Replace' : 'Choose resource'}</Button>
              <Button variant="ghost" size="sm" onClick={onRemove} disabled={busy} aria-label={`Remove Topic ${number}`}><Trash2 aria-hidden />Remove</Button>
            </>
          )}
          {showDuration && (
            <span className="ml-auto flex items-center gap-2">
              <label htmlFor={`duration-${topic.id}`} className="text-ink-soft">Duration (seconds)</label>
              <Input
                id={`duration-${topic.id}`}
                type="number"
                min={1}
                className="min-h-9 w-24"
                disabled={locked}
                value={duration}
                onChange={(e) => setDuration(e.target.value)}
                onBlur={commitDuration}
              />
            </span>
          )}
        </div>
      </div>
      {!locked && (
        <div className="flex shrink-0 flex-col gap-1">
          <Button variant="secondary" size="icon" disabled={busy || number === 1} onClick={() => onMove(-1)} aria-label={`Move Topic ${number} up`}><ArrowUp aria-hidden /></Button>
          <Button variant="secondary" size="icon" disabled={busy || number === total} onClick={() => onMove(1)} aria-label={`Move Topic ${number} down`}><ArrowDown aria-hidden /></Button>
        </div>
      )}
    </li>
  );
}

export function LessonReview() {
  const { id = '' } = useParams();
  const navigate = useNavigate();
  const location = useLocation();
  const lesson = useAsync(() => api.lesson(id), [id]);
  usePageTitle(lesson.data ? `Review: ${lesson.data.title}` : 'Review lesson');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [replacing, setReplacing] = useState<LessonTopicDTO | null>(null);
  const [previewing, setPreviewing] = useState<LessonTopicDTO | null>(null);
  const [syncMode, setSyncMode] = useState<SyncMode>('voice');
  const [newTopic, setNewTopic] = useState('');
  const initialNotices = (location.state as { notices?: string[] } | null)?.notices ?? [];

  const data = lesson.data;
  const openSession = data?.sessions.find((s) => s.status !== 'ended');
  const pastSessions = data?.sessions.filter((s) => s.status === 'ended') ?? [];
  const locked = !!openSession;

  const run = async (task: () => Promise<LessonDTO>) => {
    setBusy(true);
    setError(null);
    try {
      lesson.setData(await task());
    } catch (e) {
      setError(errorMessage(e));
    } finally {
      setBusy(false);
    }
  };

  const patchTopics = (build: (topics: LessonTopicPatch[]) => LessonTopicPatch[]) =>
    run(() => api.patchLesson(id, { topics: build(data!.topics.map((t) => ({ id: t.id }))) }));

  const move = (index: number, delta: -1 | 1) =>
    patchTopics((topics) => {
      const next = [...topics];
      const [item] = next.splice(index, 1);
      next.splice(index + delta, 0, item!);
      return next;
    });

  const updateTopic = (index: number, patch: LessonTopicPatch) =>
    patchTopics((topics) => topics.map((t, i) => (i === index ? { ...t, ...patch } : t)));

  const restoreEnteredOrder = () =>
    run(() => api.patchLesson(id, { topics: [...data!.topics].sort((a, b) => a.enteredPosition - b.enteredPosition).map((t) => ({ id: t.id })) }));

  const addTopic = async (event: FormEvent) => {
    event.preventDefault();
    const name = newTopic.trim();
    if (!name) return;
    await patchTopics((topics) => [...topics, { requestedTopic: name }]);
    setNewTopic('');
  };

  const confirmAndCreate = async () => {
    setBusy(true);
    setError(null);
    try {
      if (data!.status !== 'confirmed') await api.confirmLesson(id);
      const session = await api.createSession(id, syncMode);
      navigate(`/teacher/sessions/${session.id}`);
    } catch (e) {
      if (e instanceof ApiRequestError && e.code === 'session_open') {
        const sessionId = (e.details as { sessionId?: string } | undefined)?.sessionId;
        if (sessionId) {
          navigate(`/teacher/sessions/${sessionId}`);
          return;
        }
      }
      setError(errorMessage(e));
      await lesson.reload();
      setBusy(false);
    }
  };

  if (lesson.loading && !data) return <PageBody><Loading label="Loading lesson…" /></PageBody>;
  if (lesson.error && !data) {
    return (
      <PageBody>
        <Notice tone="error">{lesson.error}</Notice>
        <Button asChild variant="secondary" className="mt-4"><Link to="/teacher">Back to lessons</Link></Button>
      </PageBody>
    );
  }
  if (!data) return null;

  const unresolved = data.topics.filter((t) => !t.resource).length;
  const fuzzy = data.topics.filter((t) => t.matchStatus === 'fuzzy').length;
  const reordered = data.topics.some((t, i, all) => i > 0 && t.enteredPosition < all[i - 1]!.enteredPosition);

  return (
    <PageBody>
      <Link to="/teacher" className="inline-flex items-center gap-1.5"><ArrowLeft className="size-4" aria-hidden />Lessons</Link>
      <h1 className="mt-3 text-3xl">{data.title}</h1>
      <p className="mt-2 max-w-3xl text-ink-soft">
        {locked ? 'This sequence is locked while a classroom session is open.' : 'Review the suggested teaching sequence. Voice commands such as "Start Topic 3" use the numbers shown here once you confirm.'}
      </p>

      {[...initialNotices, ...(data.notices ?? [])].map((notice) => <Notice key={notice} tone="info" className="mt-4">{notice}</Notice>)}
      {error && <Notice tone="error" className="mt-4">{error}</Notice>}

      {openSession && (
        <Notice tone="good" className="mt-4">
          <span className="mr-3">A session is open with code <strong className="tracking-widest">{openSession.sessionCode}</strong>.</span>
          <Link to={`/teacher/sessions/${openSession.id}`} className="font-bold">Go to the live session</Link>
        </Notice>
      )}

      <div className="mt-6 flex flex-wrap items-center justify-between gap-3">
        <h2 className="text-xl">Suggested teaching sequence</h2>
        {!locked && (
          <div className="flex flex-wrap gap-2">
            {reordered && <Button variant="secondary" size="sm" disabled={busy} onClick={restoreEnteredOrder}>Use the order I entered</Button>}
            <Button variant="secondary" size="sm" disabled={busy} onClick={() => run(() => api.rematchLesson(id))}><RefreshCw aria-hidden />Re-check library</Button>
          </div>
        )}
      </div>

      {data.topics.length === 0 ? (
        <div className="mt-3"><EmptyState title="No topics left">Add a topic below.</EmptyState></div>
      ) : (
        <Card className="mt-3">
          <ol className="divide-y divide-line">
            {data.topics.map((topic, index) => (
              <TopicRow
                key={topic.id}
                topic={topic}
                total={data.topics.length}
                busy={busy}
                locked={locked}
                showDuration={syncMode === 'timestamp'}
                onMove={(delta) => move(index, delta)}
                onRemove={() => patchTopics((topics) => topics.filter((_, i) => i !== index))}
                onReplace={() => setReplacing(topic)}
                onPreview={() => setPreviewing(topic)}
                onDuration={(estimatedDurationSeconds) => updateTopic(index, { estimatedDurationSeconds })}
                onRename={(displayTitle) => updateTopic(index, { displayTitle })}
              />
            ))}
          </ol>
        </Card>
      )}

      {!locked && (
        <form onSubmit={addTopic} className="mt-4 flex max-w-lg items-end gap-2">
          <div className="flex-1 space-y-1.5">
            <Label htmlFor="add-topic">Add another topic</Label>
            <Input id="add-topic" value={newTopic} onChange={(e) => setNewTopic(e.target.value)} />
          </div>
          <Button type="submit" variant="secondary" disabled={busy || !newTopic.trim()}><Plus aria-hidden />Add topic</Button>
        </form>
      )}

      {!locked && (
        <Card className="mt-8 p-5 md:p-6">
          <h2 className="text-xl">Start teaching</h2>
          <fieldset className="mt-4">
            <legend className="font-bold">How should the student's screen change topics?</legend>
            <div className="mt-2 grid gap-3 md:grid-cols-2">
              {([
                ['voice', Mic, 'Voice Trigger (recommended)', 'You say a command such as "Start Topic 2". Nothing moves unless you say so.'],
                ['timestamp', Timer, 'Timestamp', 'Topics move on automatically after the duration you set for each one.'],
              ] as const).map(([value, Icon, title, body]) => (
                <label key={value} className={cn('flex cursor-pointer gap-3 rounded-md border-2 p-4', syncMode === value ? 'border-teal bg-teal-tint' : 'border-line')}>
                  <input type="radio" name="sync-mode" value={value} checked={syncMode === value} onChange={() => setSyncMode(value)} className="mt-1 size-4 accent-teal" />
                  <span>
                    <span className="flex items-center gap-2 font-bold"><Icon className="size-4" aria-hidden />{title}</span>
                    <span className="mt-0.5 block text-ink-soft">{body}</span>
                  </span>
                </label>
              ))}
            </div>
          </fieldset>
          {syncMode === 'timestamp' && <p className="mt-3 text-ink-soft">Set each topic's duration in the list above. Manual controls stay available in both modes.</p>}

          {unresolved > 0 && (
            <Notice tone="warn" className="mt-4">
              {unresolved} {unresolved === 1 ? 'topic has' : 'topics have'} no resource. The student will see a message saying nothing is available for {unresolved === 1 ? 'it' : 'them'}. You can also remove {unresolved === 1 ? 'it' : 'them'}.
            </Notice>
          )}
          {fuzzy > 0 && <Notice tone="warn" className="mt-4">{fuzzy} {fuzzy === 1 ? 'topic uses a possible match' : 'topics use possible matches'}. Please check {fuzzy === 1 ? 'it' : 'them'} with Preview.</Notice>}

          <Button size="lg" className="mt-5" disabled={busy || data.topics.length === 0} onClick={confirmAndCreate}>
            <CheckCircle2 aria-hidden />Confirm sequence and create session
          </Button>
        </Card>
      )}

      {pastSessions.length > 0 && (
        <section aria-labelledby="past-heading" className="mt-8">
          <h2 id="past-heading" className="text-xl">Past sessions</h2>
          <ul className="mt-3 space-y-2">
            {pastSessions.map((s) => (
              <li key={s.id} className="flex flex-wrap items-center gap-3">
                <Link to={`/teacher/sessions/${s.id}`}>{formatDateTime(s.startedAt ?? s.createdAt)}</Link>
                <span className="tracking-widest text-ink-soft">{s.sessionCode}</span>
                <SessionStatusBadge status={s.status} />
              </li>
            ))}
          </ul>
        </section>
      )}

      <ReplaceDialog
        topic={replacing}
        onClose={() => setReplacing(null)}
        onChoose={(resourceId) => {
          const index = data.topics.findIndex((t) => t.id === replacing?.id);
          setReplacing(null);
          if (index >= 0) void updateTopic(index, { resourceId });
        }}
      />
      <Dialog wide open={previewing !== null} onOpenChange={(o) => !o && setPreviewing(null)} title={previewing?.resource?.title ?? 'Preview'}>
        {previewing?.resource && <ResourcePreview resource={previewing.resource} />}
      </Dialog>
    </PageBody>
  );
}
