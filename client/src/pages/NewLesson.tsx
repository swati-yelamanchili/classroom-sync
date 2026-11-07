import { Plus } from 'lucide-react';
import { useState, type FormEvent } from 'react';
import { useNavigate } from 'react-router-dom';
import { Notice } from '@/components/feedback';
import { PageBody } from '@/components/TeacherShell';
import { Button } from '@/components/ui/button';
import { Input, Label, Textarea } from '@/components/ui/field';
import { usePageTitle } from '@/hooks/useAsync';
import { api, errorMessage } from '@/lib/api';

export function NewLesson() {
  usePageTitle('New lesson');
  const navigate = useNavigate();
  const [title, setTitle] = useState('');
  const [topics, setTopics] = useState('');
  const [nextTopic, setNextTopic] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const count = topics.split('\n').filter((line) => line.trim()).length;

  const addTopic = () => {
    const topic = nextTopic.trim();
    if (!topic) return;
    setTopics((current) => (current.trim() ? `${current.replace(/\n+$/, '')}\n${topic}` : topic));
    setNextTopic('');
  };

  const submit = async (event: FormEvent) => {
    event.preventDefault();
    setBusy(true);
    setError(null);
    try {
      const lesson = await api.createLesson(topics.split('\n'), title.trim() || undefined);
      navigate(`/teacher/lessons/${lesson.id}`, { state: { notices: lesson.notices ?? [] } });
    } catch (e) {
      setError(errorMessage(e));
      setBusy(false);
    }
  };

  return (
    <PageBody width="narrow">
      <h1 className="text-3xl">New lesson</h1>
      <p className="mt-2 text-ink-soft">List what you plan to teach. The next step shows which existing resources match.</p>

      <form onSubmit={submit} className="mt-6 space-y-6">
        <div className="space-y-1.5">
          <Label htmlFor="topics">Topics, one per line</Label>
          <Textarea id="topics" rows={8} value={topics} onChange={(e) => setTopics(e.target.value)} aria-describedby="topics-count" autoFocus />
          <p id="topics-count" className="text-ink-soft">{count > 0 ? `${count} ${count === 1 ? 'topic' : 'topics'}` : 'For example: Addition, then Subtraction on the next line.'}</p>
        </div>

        <div className="space-y-1.5">
          <Label htmlFor="next-topic">Or add one at a time</Label>
          <div className="flex gap-2">
            <Input
              id="next-topic"
              value={nextTopic}
              onChange={(e) => setNextTopic(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === 'Enter') {
                  e.preventDefault();
                  addTopic();
                }
              }}
            />
            <Button variant="secondary" onClick={addTopic} disabled={!nextTopic.trim()}><Plus aria-hidden />Add topic</Button>
          </div>
        </div>

        <div className="space-y-1.5">
          <Label htmlFor="title">Lesson name <span className="font-normal text-ink-soft">(optional)</span></Label>
          <Input id="title" value={title} onChange={(e) => setTitle(e.target.value)} maxLength={200} />
        </div>

        {error && <Notice tone="error">{error}</Notice>}
        <Button type="submit" size="lg" disabled={busy || count === 0}>{busy ? 'Finding resources…' : 'Find resources'}</Button>
      </form>
    </PageBody>
  );
}
