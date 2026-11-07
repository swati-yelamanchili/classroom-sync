import { Eye, FileText, FileX, Pencil, Plus, Trash2, Upload, Video, VideoOff } from 'lucide-react';
import { useState, type FormEvent } from 'react';
import { Link } from 'react-router-dom';
import { PROVENANCES, type Provenance, type ResourceDTO } from '@classroom/shared';
import { ProvenanceBadge } from '@/components/badges';
import { EmptyState, Loading, Notice } from '@/components/feedback';
import { ResourcePreview } from '@/components/ResourceContent';
import { PageBody } from '@/components/TeacherShell';
import { Button } from '@/components/ui/button';
import { Card } from '@/components/ui/card';
import { Dialog } from '@/components/ui/dialog';
import { Input, Label, Select, Textarea } from '@/components/ui/field';
import { useAsync, usePageTitle } from '@/hooks/useAsync';
import { api, errorMessage, type ResourceDraft } from '@/lib/api';

const PROVENANCE_HELP: Record<Provenance, string> = {
  unverified: 'Source not verified',
  verified: 'Verified Ashray Akruti resource (needs organisation and reference)',
  demo: 'Demo resource',
};

function ResourceForm({ resource, onSaved, onCancel }: { resource: ResourceDTO | null; onSaved: () => void; onCancel: () => void }) {
  const [form, setForm] = useState({
    title: resource?.title ?? '',
    subject: resource?.subject ?? '',
    topic: resource?.topic ?? '',
    description: resource?.description ?? '',
    aliases: resource?.aliases.join('; ') ?? '',
    keywords: resource?.keywords.join('; ') ?? '',
    videoUrl: resource?.videoUrl ?? '',
    scriptText: resource?.scriptText ?? '',
    language: resource?.language ?? '',
    gradeLevel: resource?.gradeLevel ?? '',
    sourceOrganisation: resource?.sourceOrganisation ?? '',
    sourceReference: resource?.sourceReference ?? '',
    provenance: resource?.provenance ?? ('unverified' as Provenance),
    curriculumOrder: resource?.curriculumOrder?.toString() ?? '',
    prerequisites: resource?.prerequisites.join('; ') ?? '',
  });
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const set = (field: keyof typeof form) => (e: { target: { value: string } }) => setForm((f) => ({ ...f, [field]: e.target.value }));

  const submit = async (event: FormEvent) => {
    event.preventDefault();
    setBusy(true);
    setError(null);
    try {
      const draft: ResourceDraft = { ...form, curriculumOrder: form.curriculumOrder || null };
      if (resource) await api.updateResource(resource.id, draft);
      else await api.createResource(draft);
      onSaved();
    } catch (e) {
      setError(errorMessage(e));
      setBusy(false);
    }
  };

  const text = (field: keyof typeof form, label: string, hint?: string) => (
    <div className="space-y-1">
      <Label htmlFor={`f-${field}`}>{label}</Label>
      <Input id={`f-${field}`} value={form[field]} onChange={set(field)} aria-describedby={hint ? `f-${field}-hint` : undefined} />
      {hint && <p id={`f-${field}-hint`} className="text-ink-soft">{hint}</p>}
    </div>
  );

  return (
    <form onSubmit={submit} className="space-y-4">
      <div className="space-y-1">
        <Label htmlFor="f-title">Title (required)</Label>
        <Input id="f-title" required value={form.title} onChange={set('title')} autoFocus />
      </div>
      {text('videoUrl', 'Video link', 'The existing video. Must be an http or https link.')}
      <div className="space-y-1">
        <Label htmlFor="f-script">Script</Label>
        <Textarea id="f-script" rows={7} value={form.scriptText} onChange={set('scriptText')} aria-describedby="f-script-hint" />
        <p id="f-script-hint" className="text-ink-soft">Paste the existing script. It is stored and shown exactly as written.</p>
      </div>
      <div className="grid gap-4 sm:grid-cols-2">
        {text('topic', 'Topic')}
        {text('subject', 'Subject')}
        {text('language', 'Language')}
        {text('gradeLevel', 'Grade level')}
      </div>
      {text('aliases', 'Other names', 'Separate with semicolons. Used for matching.')}
      {text('keywords', 'Keywords', 'Separate with semicolons. Used for matching.')}
      {text('description', 'Description')}
      <div className="grid gap-4 sm:grid-cols-2">
        {text('curriculumOrder', 'Curriculum order', 'A whole number, only if known.')}
        {text('prerequisites', 'Prerequisites', 'Titles or topics, separated with semicolons, only if known.')}
      </div>
      <fieldset className="space-y-4 rounded-md border border-line p-4">
        <legend className="px-1 font-bold">Source</legend>
        {text('sourceOrganisation', 'Source organisation')}
        {text('sourceReference', 'Source reference')}
        <div className="space-y-1">
          <Label htmlFor="f-provenance">Status</Label>
          <Select id="f-provenance" value={form.provenance} onChange={set('provenance')}>
            {PROVENANCES.map((p) => <option key={p} value={p}>{PROVENANCE_HELP[p]}</option>)}
          </Select>
        </div>
      </fieldset>
      {error && <Notice tone="error">{error}</Notice>}
      <div className="flex justify-end gap-3">
        <Button variant="secondary" onClick={onCancel}>Cancel</Button>
        <Button type="submit" disabled={busy}>{busy ? 'Saving…' : 'Save resource'}</Button>
      </div>
    </form>
  );
}

export function ResourceLibrary() {
  usePageTitle('Resource library');
  const [query, setQuery] = useState('');
  const [filter, setFilter] = useState<'all' | Provenance>('all');
  const resources = useAsync(() => api.resources(query.trim() || undefined), [query]);
  const [editing, setEditing] = useState<ResourceDTO | 'new' | null>(null);
  const [previewing, setPreviewing] = useState<ResourceDTO | null>(null);
  const [deleting, setDeleting] = useState<ResourceDTO | null>(null);
  const [actionError, setActionError] = useState<string | null>(null);

  const visible = resources.data?.filter((r) => filter === 'all' || r.provenance === filter) ?? [];

  const confirmDelete = async () => {
    if (!deleting) return;
    setActionError(null);
    try {
      await api.deleteResource(deleting.id);
      await resources.reload();
    } catch (e) {
      setActionError(errorMessage(e));
    }
    setDeleting(null);
  };

  return (
    <PageBody>
      <div className="flex flex-wrap items-center justify-between gap-4">
        <h1 className="text-3xl">Resource library</h1>
        <div className="flex flex-wrap gap-2">
          <Button asChild variant="secondary"><Link to="/teacher/resources/import"><Upload aria-hidden />Import</Link></Button>
          <Button onClick={() => setEditing('new')}><Plus aria-hidden />Add resource</Button>
        </div>
      </div>

      <div className="mt-6 grid gap-3 sm:grid-cols-[1fr_16rem]">
        <div className="space-y-1">
          <Label htmlFor="library-search">Search</Label>
          <Input id="library-search" type="search" value={query} onChange={(e) => setQuery(e.target.value)} />
        </div>
        <div className="space-y-1">
          <Label htmlFor="library-filter">Show</Label>
          <Select id="library-filter" value={filter} onChange={(e) => setFilter(e.target.value as typeof filter)}>
            <option value="all">All resources</option>
            <option value="verified">Verified only</option>
            <option value="unverified">Source not verified</option>
            <option value="demo">Demo only</option>
          </Select>
        </div>
      </div>

      {actionError && <Notice tone="error" className="mt-4">{actionError}</Notice>}
      {resources.error && <Notice tone="error" className="mt-4">{resources.error}</Notice>}
      {resources.loading && !resources.data && <Loading label="Loading resources…" />}

      {resources.data && visible.length === 0 && (
        <div className="mt-6">
          <EmptyState title={query || filter !== 'all' ? 'No resources match' : 'The library is empty'}>
            {!query && filter === 'all' && <>Import existing resources from a CSV or JSON file, or add them one at a time.</>}
          </EmptyState>
        </div>
      )}

      {visible.length > 0 && (
        <Card className="mt-6 divide-y divide-line">
          {visible.map((resource) => (
            <div key={resource.id} className="flex flex-wrap items-center gap-x-4 gap-y-2 px-4 py-3.5" data-testid="resource-row">
              <div className="min-w-56 flex-1">
                <p className="text-lg font-bold">{resource.title}</p>
                <div className="mt-1 flex flex-wrap items-center gap-x-3 gap-y-1 text-[0.94rem]">
                  <ProvenanceBadge provenance={resource.provenance} />
                  <span className={`inline-flex items-center gap-1.5 ${resource.videoUrl ? 'text-good' : 'text-bad'}`}>
                    {resource.videoUrl ? <Video className="size-4" aria-hidden /> : <VideoOff className="size-4" aria-hidden />}Video: {resource.videoUrl ? 'yes' : 'no'}
                  </span>
                  <span className={`inline-flex items-center gap-1.5 ${resource.scriptText ? 'text-good' : 'text-bad'}`}>
                    {resource.scriptText ? <FileText className="size-4" aria-hidden /> : <FileX className="size-4" aria-hidden />}Script: {resource.scriptText ? 'yes' : 'no'}
                  </span>
                  {resource.subject && <span className="text-ink-soft">{resource.subject}</span>}
                </div>
              </div>
              <div className="flex items-center gap-1">
                <Button variant="ghost" size="sm" onClick={() => setPreviewing(resource)} aria-label={`Preview ${resource.title}`}><Eye aria-hidden />Preview</Button>
                <Button variant="ghost" size="sm" onClick={() => setEditing(resource)} aria-label={`Edit ${resource.title}`}><Pencil aria-hidden />Edit</Button>
                <Button variant="ghost" size="sm" onClick={() => setDeleting(resource)} aria-label={`Delete ${resource.title}`}><Trash2 aria-hidden />Delete</Button>
              </div>
            </div>
          ))}
        </Card>
      )}

      <Dialog open={editing !== null} onOpenChange={(o) => !o && setEditing(null)} title={editing === 'new' ? 'Add an existing resource' : 'Edit resource'} description="Enter details of a resource that already exists. This app does not create content.">
        {editing !== null && (
          <ResourceForm
            key={editing === 'new' ? 'new' : editing.id}
            resource={editing === 'new' ? null : editing}
            onCancel={() => setEditing(null)}
            onSaved={() => {
              setEditing(null);
              void resources.reload();
            }}
          />
        )}
      </Dialog>
      <Dialog wide open={previewing !== null} onOpenChange={(o) => !o && setPreviewing(null)} title={previewing?.title ?? 'Preview'}>
        {previewing && <ResourcePreview resource={previewing} />}
      </Dialog>
      <Dialog open={deleting !== null} onOpenChange={(o) => !o && setDeleting(null)} title="Delete this resource?" description={`"${deleting?.title}" will be permanently removed from the library. Lessons using it will show it as having no resource.`}>
        <div className="flex justify-end gap-3">
          <Button variant="secondary" onClick={() => setDeleting(null)}>Keep resource</Button>
          <Button variant="dangerSolid" onClick={confirmDelete}>Delete resource</Button>
        </div>
      </Dialog>
    </PageBody>
  );
}
