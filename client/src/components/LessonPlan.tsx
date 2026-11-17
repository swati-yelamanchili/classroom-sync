import { Loader2, RefreshCw, Sparkles } from 'lucide-react';
import { useEffect, useState } from 'react';
import type { LessonPlanDTO } from '@classroom/shared';
import { Notice } from '@/components/feedback';
import { Button } from '@/components/ui/button';
import { useAsync } from '@/hooks/useAsync';
import { api, errorMessage } from '@/lib/api';
import { cn } from '@/lib/utils';

const POLL_MS = 3000;

/** Re-fetches every few seconds while a plan is still being written. */
export function usePollWhilePending(pending: boolean, reload: () => unknown) {
  useEffect(() => {
    if (!pending) return;
    const timer = setTimeout(() => void reload(), POLL_MS);
    return () => clearTimeout(timer);
  });
}

/**
 * The same 5-part plan for teacher and student. `currentPart` (1-based) highlights a part; the
 * student page scrolls to it. Parts are buttons only when `onSelectPart` is given.
 */
export function LessonPlanView({
  plan,
  currentPart,
  onSelectPart,
  onRetry,
  retrying,
  textSize,
}: {
  plan: LessonPlanDTO | null;
  currentPart?: number;
  onSelectPart?: (part: number) => void;
  onRetry?: () => void;
  retrying?: boolean;
  textSize?: string;
}) {
  if (!plan) return <Notice>No lesson plan for this topic. Plans are made only for resources with a YouTube video.</Notice>;
  if (plan.status === 'pending') {
    return (
      <p role="status" className="flex items-center gap-2 text-ink-soft">
        <Loader2 className="size-5 animate-spin" aria-hidden />Making the lesson plan from the video's transcript. This takes about half a minute.
      </p>
    );
  }
  if (plan.status === 'failed') {
    return (
      <Notice tone="warn">
        <p>No lesson plan yet. {plan.error}</p>
        {onRetry && (
          <Button variant="secondary" size="sm" className="mt-2" onClick={onRetry} disabled={retrying}>
            <RefreshCw aria-hidden />{retrying ? 'Starting…' : 'Try again'}
          </Button>
        )}
      </Notice>
    );
  }
  return (
    <div>
      <p className="mb-3 flex items-start gap-2 text-sm text-ink-soft">
        <Sparkles className="mt-0.5 size-4 shrink-0" aria-hidden />
        Written by AI (Gemini) from the video's automatic transcript{plan.transcriptLanguage ? ` (${plan.transcriptLanguage})` : ''}. Check it before teaching.
      </p>
      <ol className="space-y-3" style={textSize ? { fontSize: textSize } : undefined}>
        {plan.parts.map((part, i) => {
          const number = i + 1;
          const current = currentPart === number;
          const heading = (
            <>
              <span className="text-teal-dark">Part {number}:</span> {part.title}
            </>
          );
          return (
            <li
              key={number}
              id={`part-${number}`}
              data-testid={`plan-part-${number}`}
              aria-current={current ? 'step' : undefined}
              className={cn('scroll-mt-4 rounded-md border p-3 md:p-4', current ? 'border-teal bg-teal-tint ring-2 ring-teal' : 'border-line bg-surface')}
            >
              <h3 className="text-[1.1em] leading-snug">
                {onSelectPart ? (
                  <button type="button" className="text-left" onClick={() => onSelectPart(number)}>{heading}</button>
                ) : (
                  heading
                )}
              </h3>
              <p className="mt-1.5 leading-relaxed whitespace-pre-line">{part.content}</p>
            </li>
          );
        })}
      </ol>
    </div>
  );
}

/** Teacher's view of one resource's plan, with Try again. */
export function TeacherLessonPlan({ resourceId }: { resourceId: string }) {
  const { data, error, loading, setData, reload } = useAsync(() => api.resourcePlan(resourceId), [resourceId]);
  const [retrying, setRetrying] = useState(false);
  const [retryError, setRetryError] = useState<string | null>(null);
  usePollWhilePending(data?.status === 'pending', reload);

  const retry = async () => {
    setRetrying(true);
    setRetryError(null);
    try {
      setData(await api.regeneratePlan(resourceId));
    } catch (e) {
      setRetryError(errorMessage(e));
    } finally {
      setRetrying(false);
    }
  };

  if (error && !data) return <Notice tone="error" className="mt-3">{error}</Notice>;
  // A null plan is a real answer (no YouTube video), so wait for the first load before showing it.
  if (loading && !data) return <p role="status" className="mt-3 text-ink-soft">Loading the lesson plan…</p>;
  return (
    <div className="mt-3 rounded-md border border-line bg-paper p-3 md:p-4" data-testid="teacher-plan">
      <h4 className="mb-2 text-base font-bold">Lesson plan</h4>
      <LessonPlanView plan={data} onRetry={retry} retrying={retrying} />
      {retryError && <Notice tone="error" className="mt-2">{retryError}</Notice>}
    </div>
  );
}
