import { ArrowRight } from 'lucide-react';
import { useState, type FormEvent } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import { Notice } from '@/components/feedback';
import { SkipLink, Wordmark } from '@/components/TeacherShell';
import { Button } from '@/components/ui/button';
import { Input, Label } from '@/components/ui/field';
import { usePageTitle } from '@/hooks/useAsync';
import { api, ApiRequestError, errorMessage } from '@/lib/api';

export function Join() {
  usePageTitle('Join a lesson');
  const navigate = useNavigate();
  const [params] = useSearchParams();
  const [code, setCode] = useState(params.get('code') ?? '');
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const submit = async (event: FormEvent) => {
    event.preventDefault();
    const clean = code.replace(/[^a-z0-9]/gi, '').toUpperCase();
    if (!clean) {
      setError('Enter the code your teacher gave you.');
      return;
    }
    setBusy(true);
    setError(null);
    try {
      await api.studentSession(clean);
      navigate(`/student/${clean}`);
    } catch (e) {
      setError(e instanceof ApiRequestError && e.status === 404 ? 'No lesson found with that code. Check it and try again.' : errorMessage(e));
      setBusy(false);
    }
  };

  return (
    <div className="min-h-dvh px-4 py-5 md:px-6">
      <SkipLink />
      <Wordmark />
      <main id="main" className="mx-auto mt-[10dvh] max-w-md">
        <h1 className="text-4xl">Join your lesson</h1>
        <p className="mt-2 text-xl text-ink-soft">Your teacher will give you a code.</p>
        <form onSubmit={submit} className="mt-6 space-y-4" noValidate>
          <div className="space-y-1.5">
            <Label htmlFor="code" className="text-xl">Session code</Label>
            <Input
              id="code"
              value={code}
              onChange={(e) => setCode(e.target.value)}
              autoFocus
              autoComplete="off"
              autoCapitalize="characters"
              spellCheck={false}
              maxLength={20}
              aria-invalid={!!error}
              className="min-h-16 text-center text-3xl font-bold tracking-[0.2em] uppercase"
            />
          </div>
          {error && <Notice tone="error">{error}</Notice>}
          <Button type="submit" size="lg" className="w-full" disabled={busy}>
            {busy ? 'Joining…' : 'Join lesson'}<ArrowRight aria-hidden />
          </Button>
        </form>
      </main>
    </div>
  );
}
