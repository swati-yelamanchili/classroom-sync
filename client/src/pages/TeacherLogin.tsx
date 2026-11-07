import { useState, type FormEvent } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import { Notice } from '@/components/feedback';
import { SkipLink, Wordmark } from '@/components/TeacherShell';
import { Button } from '@/components/ui/button';
import { Card } from '@/components/ui/card';
import { Input, Label } from '@/components/ui/field';
import { usePageTitle } from '@/hooks/useAsync';
import { api, errorMessage } from '@/lib/api';

export function TeacherLogin() {
  usePageTitle('Teacher sign in');
  const navigate = useNavigate();
  const [params] = useSearchParams();
  const [passcode, setPasscode] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const submit = async (event: FormEvent) => {
    event.preventDefault();
    setBusy(true);
    setError(null);
    try {
      await api.login(passcode);
      const next = params.get('next');
      navigate(next && next.startsWith('/') && !next.startsWith('//') ? next : '/teacher', { replace: true });
    } catch (e) {
      setError(errorMessage(e));
      setBusy(false);
    }
  };

  return (
    <div className="min-h-dvh px-4 py-6">
      <SkipLink />
      <Wordmark />
      <main id="main" className="mx-auto mt-[12dvh] max-w-md">
        <Card className="p-6">
          <h1 className="text-2xl">Teacher sign in</h1>
          <p className="mt-1 text-ink-soft">Enter the passcode set for this installation.</p>
          <form onSubmit={submit} className="mt-5 space-y-4">
            <div className="space-y-1.5">
              <Label htmlFor="passcode">Passcode</Label>
              <Input id="passcode" type="password" autoComplete="current-password" autoFocus required value={passcode} onChange={(e) => setPasscode(e.target.value)} />
            </div>
            {error && <Notice tone="error">{error}</Notice>}
            <Button type="submit" disabled={busy} className="w-full">{busy ? 'Signing in…' : 'Sign in'}</Button>
          </form>
        </Card>
      </main>
    </div>
  );
}
