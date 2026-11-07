import { LogOut } from 'lucide-react';
import { useEffect, useState, type ReactNode } from 'react';
import { Link, NavLink, Navigate, Outlet, useLocation } from 'react-router-dom';
import { api } from '@/lib/api';
import { cn } from '@/lib/utils';
import { Loading, Notice } from './feedback';
import { Button } from './ui/button';

export function Wordmark({ to = '/' }: { to?: string }) {
  return (
    <Link to={to} className="flex items-center gap-2.5 font-bold text-ink no-underline">
      <img src="/favicon.svg" alt="" className="size-7" />
      <span>
        Classroom Sync<span className="sr-only"> for Ashray Akruti</span>
      </span>
    </Link>
  );
}

export function SkipLink() {
  return (
    <a href="#main" className="sr-only rounded-md bg-teal px-4 py-2 font-bold text-white focus:not-sr-only focus:absolute focus:top-2 focus:left-2 focus:z-50">
      Skip to main content
    </a>
  );
}

function navClass({ isActive }: { isActive: boolean }) {
  return cn('rounded-md px-3 py-1.5 font-bold text-ink no-underline hover:bg-neutral-tint', isActive && 'bg-teal-tint text-teal-dark');
}

/** Redirects to sign-in when needed. The server enforces this independently on every request. */
export function TeacherShell() {
  const location = useLocation();
  const [auth, setAuth] = useState<'checking' | 'yes' | 'no' | 'error'>('checking');

  useEffect(() => {
    api
      .me()
      .then(({ authenticated }) => setAuth(authenticated ? 'yes' : 'no'))
      .catch(() => setAuth('error'));
  }, []);

  if (auth === 'checking') return <Loading />;
  if (auth === 'error') {
    return (
      <div className="mx-auto max-w-xl p-6">
        <Notice tone="error">Could not reach the server. Check that it is running, then reload this page.</Notice>
      </div>
    );
  }
  if (auth === 'no') return <Navigate to={`/teacher/login?next=${encodeURIComponent(location.pathname)}`} replace />;

  const signOut = async () => {
    await api.logout().catch(() => undefined);
    window.location.assign('/');
  };

  return (
    <div className="min-h-dvh">
      <SkipLink />
      <header className="border-b border-line bg-surface">
        <div className="mx-auto flex max-w-[92rem] flex-wrap items-center justify-between gap-x-6 gap-y-2 px-4 py-3 md:px-6">
          <Wordmark to="/teacher" />
          <nav aria-label="Teacher" className="flex flex-wrap items-center gap-1">
            <NavLink to="/teacher" end className={navClass}>Lessons</NavLink>
            <NavLink to="/teacher/resources" className={navClass}>Resource library</NavLink>
            <Button variant="ghost" size="sm" onClick={signOut}>
              <LogOut aria-hidden />
              Sign out
            </Button>
          </nav>
        </div>
      </header>
      <Outlet />
    </div>
  );
}

export function PageBody({ children, width = 'default' }: { children: ReactNode; width?: 'default' | 'narrow' | 'wide' }) {
  return (
    <main id="main" className={cn('mx-auto px-4 py-8 md:px-6', width === 'default' && 'max-w-5xl', width === 'narrow' && 'max-w-2xl', width === 'wide' && 'max-w-[92rem]')}>
      {children}
    </main>
  );
}
