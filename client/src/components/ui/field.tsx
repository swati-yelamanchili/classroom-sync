import type { ComponentProps } from 'react';
import { cn } from '@/lib/utils';

const controlClass =
  'w-full rounded-md border border-line-strong bg-surface px-3 text-ink placeholder:text-ink-soft focus-visible:border-teal disabled:opacity-60';

export function Input({ className, ...props }: ComponentProps<'input'>) {
  return <input className={cn(controlClass, 'min-h-11', className)} {...props} />;
}

export function Textarea({ className, ...props }: ComponentProps<'textarea'>) {
  return <textarea className={cn(controlClass, 'py-2', className)} {...props} />;
}

export function Select({ className, ...props }: ComponentProps<'select'>) {
  return <select className={cn(controlClass, 'min-h-11', className)} {...props} />;
}

export function Label({ className, ...props }: ComponentProps<'label'>) {
  return <label className={cn('block font-bold', className)} {...props} />;
}
