import { ArrowLeft, Download, Upload } from 'lucide-react';
import { useState, type ChangeEvent } from 'react';
import { Link } from 'react-router-dom';
import type { ImportReport } from '@classroom/shared';
import { Notice } from '@/components/feedback';
import { PageBody } from '@/components/TeacherShell';
import { Button } from '@/components/ui/button';
import { Card } from '@/components/ui/card';
import { Input, Label, Select, Textarea } from '@/components/ui/field';
import { usePageTitle } from '@/hooks/useAsync';
import { api, errorMessage } from '@/lib/api';

function ReportView({ report }: { report: ImportReport }) {
  return (
    <div className="space-y-3" data-testid="import-report">
      <Notice tone={report.errors.length ? 'warn' : 'good'} role="status">
        {report.dryRun ? (
          <>
            Checked {report.totalRows} {report.totalRows === 1 ? 'row' : 'rows'}: <strong>{report.valid.length} ready to import</strong>, {report.duplicates.length} duplicates, {report.errors.length} errors. Nothing has been saved yet.
          </>
        ) : (
          <>
            <strong>{report.created} imported.</strong> {report.duplicates.length} duplicates skipped, {report.errors.length} errors.
          </>
        )}
      </Notice>
      {report.errors.length > 0 && (
        <div>
          <h3 className="font-bold">Errors</h3>
          <ul className="mt-1 list-disc space-y-1 pl-5">
            {report.errors.map((e, i) => <li key={i}>Row {e.row}{e.field ? ` (${e.field})` : ''}: {e.message}</li>)}
          </ul>
        </div>
      )}
      {report.duplicates.length > 0 && (
        <div>
          <h3 className="font-bold">Duplicates skipped</h3>
          <ul className="mt-1 list-disc space-y-1 pl-5">
            {report.duplicates.map((d) => <li key={d.row}>Row {d.row}, "{d.title}": {d.reason}</li>)}
          </ul>
        </div>
      )}
    </div>
  );
}

export function ResourceImport() {
  usePageTitle('Import resources');
  const [format, setFormat] = useState<'csv' | 'json'>('csv');
  const [content, setContent] = useState('');
  const [fileName, setFileName] = useState<string | null>(null);
  const [report, setReport] = useState<ImportReport | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const onFile = async (event: ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    if (!file) return;
    setReport(null);
    setError(null);
    setFileName(file.name);
    if (file.name.toLowerCase().endsWith('.json')) setFormat('json');
    else if (file.name.toLowerCase().endsWith('.csv')) setFormat('csv');
    try {
      setContent(await file.text());
    } catch {
      setError('That file could not be read.');
    }
  };

  const run = async (dryRun: boolean) => {
    setBusy(true);
    setError(null);
    try {
      const result = await api.importResources(format, content, dryRun);
      setReport(result);
      if (!dryRun && result.created > 0) {
        setContent('');
        setFileName(null);
      }
    } catch (e) {
      setError(errorMessage(e));
      setReport(null);
    } finally {
      setBusy(false);
    }
  };

  const readyToImport = report?.dryRun && report.valid.length > 0;

  return (
    <PageBody width="narrow">
      <Link to="/teacher/resources" className="inline-flex items-center gap-1.5"><ArrowLeft className="size-4" aria-hidden />Resource library</Link>
      <h1 className="mt-3 text-3xl">Import existing resources</h1>
      <p className="mt-2 text-ink-soft">
        Add videos and scripts from a CSV or JSON file. Scripts are stored exactly as they appear in the file. Imported resources are marked "Source not verified" unless the file says otherwise and names the source.
      </p>

      <div className="mt-4 flex flex-wrap gap-2">
        <Button asChild variant="secondary" size="sm"><a href="/templates/resources-template.csv" download><Download aria-hidden />CSV template</a></Button>
        <Button asChild variant="secondary" size="sm"><a href="/templates/resources-template.json" download><Download aria-hidden />JSON template</a></Button>
      </div>

      <Card className="mt-6 space-y-5 p-5">
        <div className="space-y-1.5">
          <Label htmlFor="import-file">Choose a file</Label>
          <Input id="import-file" type="file" accept=".csv,.json,text/csv,application/json" onChange={onFile} className="py-2" />
          {fileName && <p className="text-ink-soft">Selected: {fileName}</p>}
        </div>
        <div className="grid gap-4 sm:grid-cols-[10rem_1fr]">
          <div className="space-y-1.5">
            <Label htmlFor="import-format">Format</Label>
            <Select id="import-format" value={format} onChange={(e) => { setFormat(e.target.value as 'csv' | 'json'); setReport(null); }}>
              <option value="csv">CSV</option>
              <option value="json">JSON</option>
            </Select>
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="import-content">File contents (you can also paste here)</Label>
            <Textarea id="import-content" rows={7} className="font-mono text-sm" value={content} onChange={(e) => { setContent(e.target.value); setFileName(null); setReport(null); }} />
          </div>
        </div>
        <div className="flex flex-wrap gap-3">
          <Button variant={readyToImport ? 'secondary' : 'primary'} disabled={busy || !content.trim()} onClick={() => run(true)}>Check file</Button>
          {readyToImport && (
            <Button disabled={busy} onClick={() => run(false)}>
              <Upload aria-hidden />Import {report.valid.length} {report.valid.length === 1 ? 'resource' : 'resources'}
            </Button>
          )}
        </div>
        {error && <Notice tone="error">{error}</Notice>}
        {report && <ReportView report={report} />}
      </Card>

      {report && !report.dryRun && report.created > 0 && (
        <Button asChild variant="secondary" className="mt-4"><Link to="/teacher/resources">View the library</Link></Button>
      )}
    </PageBody>
  );
}
