import { AlertTriangle, CheckCircle2, Info, Loader2, XCircle } from 'lucide-react';
import type { ReactNode } from 'react';
import { cn } from '@/lib/utils';

const TONES = {
  info: { className: 'border-line bg-neutral-tint text-ink', Icon: Info },
  warn: { className: 'border-warn/40 bg-warn-tint text-warn', Icon: AlertTriangle },
  error: { className: 'border-bad/40 bg-bad-tint text-bad', Icon: XCircle },
  good: { className: 'border-good/40 bg-good-tint text-good', Icon: CheckCircle2 },
} as const;

export function Notice({ tone = 'info', children, className, role }: { tone?: keyof typeof TONES; children: ReactNode; className?: string; role?: 'alert' | 'status' }) {
  const { className: toneClass, Icon } = TONES[tone];
  return (
    <div role={role ?? (tone === 'error' ? 'alert' : undefined)} className={cn('flex items-start gap-3 rounded-md border px-4 py-3', toneClass, className)}>
      <Icon className="mt-0.5 size-5 shrink-0" aria-hidden />
      <div className="min-w-0">{children}</div>
    </div>
  );
}

export function Loading({ label = 'Loading…' }: { label?: string }) {
  return (
    <div role="status" className="flex items-center justify-center gap-3 py-16 text-ink-soft">
      <Loader2 className="size-5 animate-spin" aria-hidden />
      {label}
    </div>
  );
}

export function EmptyState({ title, children }: { title: string; children?: ReactNode }) {
  return (
    <div className="rounded-lg border border-dashed border-line-strong px-6 py-10 text-center">
      <p className="text-lg font-bold">{title}</p>
      {children && <div className="mx-auto mt-2 max-w-prose text-ink-soft">{children}</div>}
    </div>
  );
}
