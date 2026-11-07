import { cva, type VariantProps } from 'class-variance-authority';
import type { ComponentProps } from 'react';
import { cn } from '@/lib/utils';

const badgeVariants = cva('inline-flex items-center gap-1.5 rounded-sm px-2 py-0.5 text-sm font-bold whitespace-nowrap [&_svg]:size-4 [&_svg]:shrink-0', {
  variants: {
    tone: {
      neutral: 'bg-neutral-tint text-ink',
      teal: 'bg-teal-tint text-teal-dark',
      good: 'bg-good-tint text-good',
      warn: 'bg-warn-tint text-warn',
      bad: 'bg-bad-tint text-bad',
    },
  },
  defaultVariants: { tone: 'neutral' },
});

export function Badge({ className, tone, ...props }: ComponentProps<'span'> & VariantProps<typeof badgeVariants>) {
  return <span className={cn(badgeVariants({ tone }), className)} {...props} />;
}
