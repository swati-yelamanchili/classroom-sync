import { ArrowRight, Copy, Library, Plus, Trash2 } from 'lucide-react';
import { useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { SessionStatusBadge } from '@/components/badges';
import { EmptyState, Loading, Notice } from '@/components/feedback';
import { PageBody } from '@/components/TeacherShell';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card } from '@/components/ui/card';
import { Dialog } from '@/components/ui/dialog';
import { useAsync, usePageTitle } from '@/hooks/useAsync';
import { api, errorMessage } from '@/lib/api';
import { formatDateTime } from '@/lib/utils';

export function TeacherHome() {
  usePageTitle('Lessons');
  const navigate = useNavigate();
  const lessons = useAsync(() => api.lessons(), []);
  const stats = useAsync(() => api.resourceStats(), []);
  const open = useAsync(() => api.openSessions(), []);
  const [actionError, setActionError] = useState<string | null>(null);
  const [deleting, setDeleting] = useState<{ id: string; title: string } | null>(null);

  const reuse = async (id: string) => {
    setActionError(null);
    try {
      const copy = await api.duplicateLesson(id);
      navigate(`/teacher/lessons/${copy.id}`);
    } catch (e) {
      setActionError(errorMessage(e));
    }
  };

  const confirmDelete = async () => {
    if (!deleting) return;
    setActionError(null);
    try {
      await api.deleteLesson(deleting.id);
      await lessons.reload();
    } catch (e) {
      setActionError(errorMessage(e));
    }
    setDeleting(null);
  };

  return (
    <PageBody>
      <div className="flex flex-wrap items-center justify-between gap-4">
        <h1 className="text-3xl">Your lessons</h1>
        <Button asChild size="lg">
          <Link to="/teacher/lessons/new"><Plus aria-hidden />New lesson</Link>
        </Button>
      </div>

      {actionError && <Notice tone="error" className="mt-4">{actionError}</Notice>}

      {open.data && open.data.length > 0 && (
        <section aria-labelledby="open-heading" className="mt-8">
          <h2 id="open-heading" className="text-xl">Open classroom sessions</h2>
          <ul className="mt-3 space-y-2">
            {open.data.map((s) => (
              <li key={s.id}>
                <Link to={`/teacher/sessions/${s.id}`} className="flex flex-wrap items-center gap-x-4 gap-y-1 rounded-lg border-2 border-teal bg-surface px-4 py-3 text-ink no-underline hover:bg-teal-tint">
                  <span className="font-bold">{s.lessonTitle}</span>
                  <span className="font-bold tracking-widest text-teal-dark">{s.sessionCode}</span>
                  <SessionStatusBadge status={s.status} />
                  <span className="ml-auto flex items-center gap-1 font-bold text-teal-dark">Open <ArrowRight className="size-4" aria-hidden /></span>
                </Link>
              </li>
            ))}
          </ul>
        </section>
      )}

      <section aria-labelledby="lessons-heading" className="mt-8">
        <h2 id="lessons-heading" className="sr-only">All lessons</h2>
        {lessons.loading && !lessons.data && <Loading label="Loading lessons…" />}
        {lessons.error && <Notice tone="error">{lessons.error}</Notice>}
        {lessons.data?.length === 0 && (
          <EmptyState title="No lessons yet">
            Create a lesson by listing the topics you plan to teach. The app will match them to the resource library.
          </EmptyState>
        )}
        {lessons.data && lessons.data.length > 0 && (
          <Card className="divide-y divide-line">
            {lessons.data.map((lesson) => {
              const latest = lesson.sessions[0];
              return (
                <div key={lesson.id} className="flex flex-wrap items-center gap-x-4 gap-y-2 px-4 py-3.5">
                  <div className="min-w-56 flex-1">
                    <Link to={`/teacher/lessons/${lesson.id}`} className="text-lg font-bold">{lesson.title}</Link>
                    <p className="text-ink-soft">
                      {lesson.topicCount} {lesson.topicCount === 1 ? 'topic' : 'topics'}
                      {lesson.unresolvedCount > 0 && `, ${lesson.unresolvedCount} without a resource`}
                      {' · '}Updated {formatDateTime(lesson.updatedAt)}
                      {latest && ` · ${lesson.sessions.length} ${lesson.sessions.length === 1 ? 'session' : 'sessions'}`}
                    </p>
                  </div>
                  <Badge tone={lesson.status === 'confirmed' ? 'good' : 'neutral'}>{lesson.status === 'confirmed' ? 'Confirmed' : 'Draft'}</Badge>
                  <div className="flex items-center gap-1">
                    <Button variant="ghost" size="sm" onClick={() => reuse(lesson.id)} aria-label={`Reuse ${lesson.title} as a new lesson`}>
                      <Copy aria-hidden />Reuse
                    </Button>
                    <Button variant="ghost" size="sm" onClick={() => setDeleting({ id: lesson.id, title: lesson.title })} aria-label={`Delete ${lesson.title}`}>
                      <Trash2 aria-hidden />Delete
                    </Button>
                  </div>
                </div>
              );
            })}
          </Card>
        )}
      </section>

      <section aria-labelledby="library-heading" className="mt-10 flex flex-wrap items-center justify-between gap-4 border-t border-line pt-6">
        <div>
          <h2 id="library-heading" className="text-xl">Resource library</h2>
          {stats.data && (
            <p className="mt-1 text-ink-soft">
              {stats.data.total} available: {stats.data.verified} verified, {stats.data.unverified} source not verified, {stats.data.demo} demo
            </p>
          )}
          {stats.error && <p className="mt-1 text-bad">{stats.error}</p>}
        </div>
        <Button asChild variant="secondary">
          <Link to="/teacher/resources"><Library aria-hidden />Open library</Link>
        </Button>
      </section>

      {stats.data && stats.data.demo > 0 && stats.data.verified + stats.data.unverified === 0 && (
        <Notice tone="warn" className="mt-4">
          The library currently holds only demonstration placeholders, not Ashray Akruti content. <Link to="/teacher/resources/import">Import the real resources</Link> when they are available.
        </Notice>
      )}

      <Dialog open={deleting !== null} onOpenChange={(o) => !o && setDeleting(null)} title="Delete this lesson?" description={`"${deleting?.title}" and its session history will be permanently removed. Resources in the library are not affected.`}>
        <div className="flex justify-end gap-3">
          <Button variant="secondary" onClick={() => setDeleting(null)}>Keep lesson</Button>
          <Button variant="dangerSolid" onClick={confirmDelete}>Delete lesson</Button>
        </div>
      </Dialog>
    </PageBody>
  );
}
