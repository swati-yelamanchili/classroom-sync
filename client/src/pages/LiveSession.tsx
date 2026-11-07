import {
  AlertTriangle,
  ArrowLeft,
  ArrowRight,
  Check,
  CheckCircle2,
  Copy,
  ExternalLink,
  Loader2,
  Mic,
  MicOff,
  Pause,
  Play,
  Radio,
  Square,
  Users,
  Wifi,
  WifiOff,
  XCircle,
} from 'lucide-react';
import { useRef, useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import { formatClock, secondsUntilNextAdvance, type SessionEventDTO, type SyncMode, type TeacherSnapshot } from '@classroom/shared';
import { ProvenanceBadge, SessionStatusBadge, SyncModeBadge } from '@/components/badges';
import { Loading, Notice } from '@/components/feedback';
import { ScriptPanel } from '@/components/ResourceContent';
import { Button } from '@/components/ui/button';
import { Card } from '@/components/ui/card';
import { Dialog } from '@/components/ui/dialog';
import { Input, Label, Select } from '@/components/ui/field';
import { useAsync, usePageTitle } from '@/hooks/useAsync';
import { useLiveElapsed } from '@/hooks/useLiveElapsed';
import { useTeacherSession, type ConnectionState } from '@/hooks/useSessionChannel';
import { api, errorMessage } from '@/lib/api';
import { cn } from '@/lib/utils';
import type { VoiceState, VoiceStatus } from '@/speech/SpeechRecognitionService';
import { useVoiceControl, VOICE_LANGUAGES } from '@/speech/useVoiceControl';

const VOICE_STATE_UI: Record<VoiceState, { label: string; className: string; Icon: typeof Mic }> = {
  off: { label: 'Microphone off', className: 'bg-neutral-tint text-ink', Icon: MicOff },
  listening: { label: 'Listening', className: 'bg-teal-tint text-teal-dark', Icon: Radio },
  processing: { label: 'Processing command', className: 'bg-teal-tint text-teal-dark', Icon: Loader2 },
  recognised: { label: 'Command recognised', className: 'bg-good-tint text-good', Icon: CheckCircle2 },
  rejected: { label: 'Command rejected', className: 'bg-bad-tint text-bad', Icon: XCircle },
  'permission-denied': { label: 'Microphone permission denied', className: 'bg-bad-tint text-bad', Icon: MicOff },
  unavailable: { label: 'Speech recognition unavailable', className: 'bg-warn-tint text-warn', Icon: AlertTriangle },
  error: { label: 'Speech recognition problem', className: 'bg-warn-tint text-warn', Icon: AlertTriangle },
};

export function VoiceStatusDisplay({ status }: { status: VoiceStatus }) {
  const { label, className, Icon } = VOICE_STATE_UI[status.state];
  return (
    <div className="space-y-2">
      <div role="status" data-testid="voice-state" className={cn('flex items-center gap-2 rounded-md px-3 py-2.5 font-bold', className)}>
        <Icon className={cn('size-5 shrink-0', status.state === 'processing' && 'animate-spin')} aria-hidden />
        {label}
      </div>
      {status.message && <p className="text-ink-soft">{status.message}</p>}
      {status.heardNonCommand && <p className="text-ink-soft">Heard speech that is not a command. Nothing changed.</p>}
      {status.lastCommand && (
        <div data-testid="last-command" className="rounded-md border border-line p-3">
          <p><span className="text-ink-soft">Recognised:</span> "{status.lastCommand.heard}"</p>
          <p className={cn('mt-0.5 font-bold', status.lastCommand.outcome === 'rejected' && 'text-bad')}>
            {status.lastCommand.outcome === 'rejected' ? 'Rejected' : 'Action'}: {status.lastCommand.action}
          </p>
        </div>
      )}
    </div>
  );
}

function ConnectionPanel({ snapshot, connection, connectedStudents }: { snapshot: TeacherSnapshot; connection: ConnectionState; connectedStudents: number }) {
  const network = useAsync(() => api.network(), []);
  const { hostname, protocol, port, origin } = window.location;
  const onLocalhost = hostname === 'localhost' || hostname === '127.0.0.1' || hostname === '[::1]';
  const lanAddress = network.data?.lanAddresses[0];
  // A "localhost" link would point at the student's own device, so swap in this computer's address.
  const base = network.data?.publicBaseUrl ?? (onLocalhost && lanAddress ? `${protocol}//${lanAddress}${port ? `:${port}` : ''}` : origin);
  const joinUrl = `${base}/student/${snapshot.sessionCode}`;
  const linkUnusable = onLocalhost && network.data !== null && !network.data.publicBaseUrl && !lanAddress;
  const [copied, setCopied] = useState<'yes' | 'manual' | null>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  const copy = async () => {
    try {
      await navigator.clipboard.writeText(joinUrl);
      setCopied('yes');
    } catch {
      // navigator.clipboard needs HTTPS or localhost; select the text so it can be copied by hand.
      inputRef.current?.select();
      setCopied('manual');
    }
    setTimeout(() => setCopied(null), 4000);
  };

  const live = connection === 'synced';
  return (
    <Card className="p-4">
      <h2 className="text-lg">Student connection</h2>
      <p className="mt-2 text-ink-soft">Session code</p>
      <p data-testid="session-code" className="text-3xl font-bold tracking-[0.15em] text-teal-dark">{snapshot.sessionCode}</p>
      <div className="mt-3 space-y-1.5">
        <Label htmlFor="join-url" className="font-normal text-ink-soft">Student link</Label>
        <div className="flex gap-2">
          <Input id="join-url" ref={inputRef} readOnly value={joinUrl} className="min-h-10 text-sm" onFocus={(e) => e.target.select()} />
          <Button variant="secondary" size="sm" className="min-h-10" onClick={copy}>
            {copied === 'yes' ? <Check aria-hidden /> : <Copy aria-hidden />}
            {copied === 'yes' ? 'Copied' : 'Copy link'}
          </Button>
        </div>
        <p role="status" className="min-h-0 text-ink-soft">{copied === 'manual' ? 'Link selected. Press Ctrl+C to copy it.' : ''}</p>
        {linkUnusable && <p className="text-warn">No network connection was found, so this link only works on this computer.</p>}
      </div>
      <dl className="mt-1 space-y-2 border-t border-line pt-3">
        <div className="flex items-center justify-between gap-2">
          <dt className="flex items-center gap-2"><Users className="size-4" aria-hidden />Student devices</dt>
          <dd data-testid="student-count" className="font-bold">{live ? connectedStudents : 'Unknown'}</dd>
        </div>
        <div className="flex items-center justify-between gap-2">
          <dt className="flex items-center gap-2">{live ? <Wifi className="size-4" aria-hidden /> : <WifiOff className="size-4" aria-hidden />}Sync with server</dt>
          <dd data-testid="sync-status" className={cn('font-bold', live ? 'text-good' : 'text-bad')}>
            {connection === 'synced' ? 'Live' : connection === 'connecting' ? 'Connecting…' : 'Disconnected'}
          </dd>
        </div>
      </dl>
    </Card>
  );
}

function VoicePanel({ snapshot, voice }: { snapshot: TeacherSnapshot; voice: ReturnType<typeof useVoiceControl> }) {
  const listening = !['off', 'unavailable', 'permission-denied'].includes(voice.status.state) && !(voice.status.state === 'error' && voice.status.message?.includes('has stopped'));
  if (snapshot.syncMode !== 'voice') {
    return (
      <Card className="p-4">
        <h2 className="text-lg">Voice commands</h2>
        <p className="mt-2 text-ink-soft">The microphone is off in Timestamp mode, so voice and timer can't both move topics. Pause the session to switch mode.</p>
      </Card>
    );
  }
  return (
    <Card className="p-4">
      <h2 className="text-lg">Voice commands</h2>
      <div className="mt-3 space-y-3">
        <VoiceStatusDisplay status={voice.status} />
        {voice.supported && (
          listening ? (
            <Button variant="secondary" className="w-full" onClick={voice.disable}><MicOff aria-hidden />Disable microphone</Button>
          ) : (
            <Button className="w-full" onClick={voice.enable} disabled={snapshot.status === 'ended'}><Mic aria-hidden />Enable microphone</Button>
          )
        )}
        <details className="rounded-md border border-line px-3 py-2">
          <summary className="font-bold">Commands and settings</summary>
          <ul className="mt-2 space-y-0.5">
            <li>"Start Topic 3"</li>
            <li>"Go to Topic 2"</li>
            <li>"Repeat Topic 2"</li>
            <li>"Next Topic" / "Previous Topic"</li>
            <li>"Pause Session" / "Resume Session"</li>
          </ul>
          <p className="mt-2 text-ink-soft">Say each one on its own, then pause briefly. Anything else you say is ignored.</p>
          <label className="mt-3 flex items-start gap-2">
            <input type="checkbox" className="mt-1.5 size-4 accent-teal" checked={voice.requireWake} onChange={(e) => voice.setRequireWake(e.target.checked)} />
            <span>Only respond after the word "Classroom", as in "Classroom, start Topic 3"</span>
          </label>
          <div className="mt-3 space-y-1">
            <Label htmlFor="voice-language" className="font-normal">Speech language</Label>
            <Select id="voice-language" value={voice.language} onChange={(e) => voice.setLanguage(e.target.value)}>
              {VOICE_LANGUAGES.map((l) => <option key={l.code} value={l.code}>{l.label}</option>)}
            </Select>
          </div>
        </details>
      </div>
    </Card>
  );
}

function TimerStrip({ snapshot, elapsed }: { snapshot: TeacherSnapshot; elapsed: number }) {
  const durations = snapshot.topics.map((t) => t.estimatedDurationSeconds);
  const remaining = secondsUntilNextAdvance(
    { currentTopicIndex: snapshot.currentTopicIndex, topicStartedElapsedSeconds: snapshot.topicStartedElapsedSeconds, durationsSeconds: durations },
    elapsed,
  );
  return (
    <div className="flex flex-wrap items-center gap-x-6 gap-y-1">
      <p><span className="text-ink-soft">Elapsed</span> <strong data-testid="elapsed" className="tabular-nums">{formatClock(elapsed)}</strong></p>
      {snapshot.syncMode === 'timestamp' && snapshot.status !== 'ended' && snapshot.status !== 'created' && (
        <p>
          {remaining === null ? (
            <span className="text-ink-soft">Final topic: stays here until you end the session</span>
          ) : (
            <>
              <span className="text-ink-soft">Next topic in</span> <strong className="tabular-nums">{formatClock(Math.ceil(remaining))}</strong>
              {snapshot.status === 'paused' && <span className="text-ink-soft"> (paused)</span>}
            </>
          )}
        </p>
      )}
    </div>
  );
}

function SessionHistory({ sessionId }: { sessionId: string }) {
  const events = useAsync(() => api.sessionEvents(sessionId), [sessionId]);
  const describe = (event: SessionEventDTO) => {
    const via = event.source === 'voice' ? ' by voice' : event.source === 'timer' ? ' by timer' : '';
    if (event.type === 'topic_changed') return `Moved to Topic ${(event.toIndex ?? 0) + 1}: ${event.topicTitle ?? 'unknown'}${via}`;
    if (event.type === 'mode_changed') return 'Synchronisation mode changed';
    return `Session ${event.type}${via}`;
  };
  return (
    <Card className="p-5">
      <h2 className="text-lg">Session history</h2>
      {events.error && <Notice tone="error" className="mt-2">{events.error}</Notice>}
      <ol className="mt-3 space-y-1.5">
        {events.data?.map((event) => (
          <li key={event.id} className="flex gap-3">
            <time className="shrink-0 text-ink-soft tabular-nums" dateTime={event.createdAt}>{new Date(event.createdAt).toLocaleTimeString()}</time>
            <span>{describe(event)}</span>
          </li>
        ))}
      </ol>
    </Card>
  );
}

export function LiveSession() {
  const { id } = useParams();
  const { snapshot, connection, joinError, accept, connectedStudents } = useTeacherSession(id);
  const voice = useVoiceControl(snapshot, accept);
  const elapsed = useLiveElapsed(snapshot);
  usePageTitle(snapshot ? `Live: ${snapshot.lessonTitle}` : 'Live session');
  const [actionError, setActionError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [confirmEnd, setConfirmEnd] = useState(false);
  const [pendingMode, setPendingMode] = useState<SyncMode | null>(null);

  if (joinError && !snapshot) {
    return (
      <main id="main" className="mx-auto max-w-xl p-6">
        <Notice tone="error">{joinError}</Notice>
        <Button asChild variant="secondary" className="mt-4"><Link to="/teacher">Back to lessons</Link></Button>
      </main>
    );
  }
  if (!snapshot) {
    return (
      <main id="main">
        <Loading label={connection === 'disconnected' ? 'Waiting for the server…' : 'Opening session…'} />
      </main>
    );
  }

  const sessionId = snapshot.id;
  const act = async (task: () => Promise<TeacherSnapshot>) => {
    setBusy(true);
    setActionError(null);
    try {
      accept(await task());
    } catch (e) {
      setActionError(errorMessage(e));
    } finally {
      setBusy(false);
    }
  };
  const goTo = (change: Parameters<typeof api.changeTopic>[1]) =>
    act(async () => (await api.changeTopic(sessionId, { ...change, source: 'manual', commandId: crypto.randomUUID?.() })).session);

  const { status, currentTopic: topic, topics, currentTopicIndex } = snapshot;
  const live = status === 'active' || status === 'paused';
  const resource = topic?.resource ?? null;
  const canSwitchMode = status === 'created' || status === 'paused';

  return (
    <main id="main" className="mx-auto max-w-[92rem] px-4 py-5 md:px-6">
      {connection !== 'synced' && (
        <Notice tone="error" role="alert" className="mb-4">
          Connection to the server was lost. Reconnecting automatically. Changes will not reach students until this clears.
        </Notice>
      )}

      <div className="flex flex-wrap items-start justify-between gap-x-6 gap-y-3">
        <div>
          <Link to={`/teacher/lessons/${snapshot.lessonId}`} className="inline-flex items-center gap-1.5"><ArrowLeft className="size-4" aria-hidden />Lesson</Link>
          <h1 className="mt-1 text-2xl">{snapshot.lessonTitle}</h1>
          <div className="mt-2 flex flex-wrap items-center gap-2" data-testid="session-status">
            <SessionStatusBadge status={status} />
            <SyncModeBadge mode={snapshot.syncMode} />
          </div>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          {status === 'created' && <Button size="lg" disabled={busy} onClick={() => act(() => api.startSession(sessionId))}><Play aria-hidden />Start session</Button>}
          {status === 'active' && <Button variant="secondary" size="lg" disabled={busy} onClick={() => act(() => api.pauseSession(sessionId))}><Pause aria-hidden />Pause session</Button>}
          {status === 'paused' && <Button size="lg" disabled={busy} onClick={() => act(() => api.resumeSession(sessionId))}><Play aria-hidden />Resume session</Button>}
          {status !== 'ended' && <Button variant="danger" size="lg" disabled={busy} onClick={() => setConfirmEnd(true)}><Square aria-hidden />End session</Button>}
        </div>
      </div>

      {actionError && <Notice tone="error" className="mt-4">{actionError}</Notice>}

      <div className="mt-5 grid items-start gap-5 lg:grid-cols-[17rem_minmax(0,1fr)_21rem]">
        <nav aria-label="Teaching sequence" className="lg:sticky lg:top-4">
          <Card className="p-2">
            <h2 className="px-2 pt-2 pb-1 text-lg">Teaching sequence</h2>
            <p className="px-2 pb-2 text-ink-soft">Select a topic to jump to it.</p>
            <ol className="space-y-1">
              {topics.map((t) => {
                const current = t.index === currentTopicIndex && status !== 'ended';
                return (
                  <li key={t.index}>
                    <button
                      type="button"
                      data-testid={`jump-${t.number}`}
                      aria-current={current ? 'step' : undefined}
                      disabled={!live || busy}
                      onClick={() => goTo({ action: 'goto', index: t.index })}
                      className={cn(
                        'flex w-full items-start gap-2.5 rounded-md px-2 py-2 text-left disabled:cursor-not-allowed',
                        current ? 'bg-teal font-bold text-white' : 'enabled:hover:bg-neutral-tint',
                      )}
                    >
                      <span className="sr-only">Jump to Topic </span>
                      <span className={cn('flex size-6 shrink-0 items-center justify-center rounded-sm text-sm font-bold', current ? 'bg-white text-teal-dark' : 'bg-neutral-tint')}>{t.number}</span>
                      <span className="min-w-0 break-words">
                        {t.displayTitle}
                        {!t.resource && <span className={cn('block text-sm', current ? 'text-white' : 'text-bad')}>No resource</span>}
                      </span>
                    </button>
                  </li>
                );
              })}
            </ol>
          </Card>
        </nav>

        <div className="min-w-0 space-y-5">
          <Card className="p-5 md:p-6">
            <div className="flex flex-wrap items-center justify-between gap-3">
              <p className="font-bold text-teal-dark" data-testid="current-topic-number">Topic {currentTopicIndex + 1} of {snapshot.totalTopics}</p>
              <TimerStrip snapshot={snapshot} elapsed={elapsed} />
            </div>
            <h2 data-testid="current-topic-title" className="mt-1 text-3xl break-words">{topic?.displayTitle ?? 'No topic'}</h2>

            {status === 'created' && <Notice className="mt-4">Students see a waiting screen until you start. Share the code, then press Start session.</Notice>}
            {status === 'ended' && <Notice className="mt-4">This session has ended and cannot be restarted. The lesson stays saved, so you can run it again.</Notice>}

            {live && (
              <div className="mt-4 flex flex-wrap gap-2">
                <Button variant="secondary" size="lg" disabled={busy || currentTopicIndex === 0} onClick={() => goTo({ action: 'previous' })}><ArrowLeft aria-hidden />Previous topic</Button>
                <Button size="lg" disabled={busy || currentTopicIndex >= snapshot.totalTopics - 1} onClick={() => goTo({ action: 'next' })}>Next topic<ArrowRight aria-hidden /></Button>
              </div>
            )}

            <div className="mt-5 border-t border-line pt-4">
              {resource ? (
                <>
                  <div className="flex flex-wrap items-center gap-3">
                    <p><span className="text-ink-soft">Resource:</span> <strong>{resource.title}</strong></p>
                    <ProvenanceBadge provenance={resource.provenance} />
                  </div>
                  <p className="mt-2">
                    {resource.videoUrl ? (
                      <a href={resource.videoUrl} target="_blank" rel="noopener noreferrer" className="inline-flex items-center gap-1.5 break-all font-bold">
                        <ExternalLink className="size-4 shrink-0" aria-hidden />Open video link<span className="sr-only"> (opens in a new tab)</span>
                      </a>
                    ) : (
                      <span className="text-ink-soft">No video is available for this resource.</span>
                    )}
                  </p>
                  <h3 className="mt-4 font-bold">Script preview</h3>
                  <div className="mt-1 max-h-72 overflow-y-auto rounded-md border border-line p-3" tabIndex={0} aria-label="Script preview">
                    <ScriptPanel scriptText={resource.scriptText} language={resource.language} />
                  </div>
                </>
              ) : (
                <p className="font-bold text-bad">No resource is attached to this topic. Students will see a message saying so.</p>
              )}
            </div>
          </Card>
          {status === 'ended' && <SessionHistory sessionId={sessionId} />}
        </div>

        <aside aria-label="Session tools" className="space-y-5">
          <ConnectionPanel snapshot={snapshot} connection={connection} connectedStudents={connectedStudents} />
          {status !== 'ended' && <VoicePanel snapshot={snapshot} voice={voice} />}
          {status !== 'ended' && (
            <Card className="p-4">
              <h2 className="text-lg">Mode</h2>
              <p className="mt-1 text-ink-soft">
                {canSwitchMode ? 'You can switch mode now.' : 'Pause the session to switch mode.'}
              </p>
              <Button
                variant="secondary"
                className="mt-3 w-full whitespace-normal"
                disabled={!canSwitchMode || busy}
                onClick={() => setPendingMode(snapshot.syncMode === 'voice' ? 'timestamp' : 'voice')}
              >
                Switch to {snapshot.syncMode === 'voice' ? 'Timestamp' : 'Voice Trigger'} mode
              </Button>
            </Card>
          )}
        </aside>
      </div>

      <Dialog open={confirmEnd} onOpenChange={setConfirmEnd} title="End this session?" description="Students will see that the lesson has ended. An ended session cannot be restarted, though you can create a new one from the same lesson.">
        <div className="flex justify-end gap-3">
          <Button variant="secondary" onClick={() => setConfirmEnd(false)}>Keep teaching</Button>
          <Button
            variant="dangerSolid"
            onClick={() => {
              setConfirmEnd(false);
              void act(() => api.endSession(sessionId));
            }}
          >
            End session
          </Button>
        </div>
      </Dialog>

      <Dialog
        open={pendingMode !== null}
        onOpenChange={(o) => !o && setPendingMode(null)}
        title={`Switch to ${pendingMode === 'timestamp' ? 'Timestamp' : 'Voice Trigger'} mode?`}
        description={pendingMode === 'timestamp' ? "The microphone will turn off. After you resume, topics move automatically, starting with the current topic's full duration." : 'The timer will stop moving topics. You can turn on the microphone and use voice commands.'}
      >
        <div className="flex justify-end gap-3">
          <Button variant="secondary" onClick={() => setPendingMode(null)}>Cancel</Button>
          <Button
            onClick={() => {
              const mode = pendingMode!;
              setPendingMode(null);
              void act(() => api.setSessionMode(sessionId, mode));
            }}
          >
            Switch mode
          </Button>
        </div>
      </Dialog>
    </main>
  );
}
