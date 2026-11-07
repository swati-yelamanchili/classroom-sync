import { Slot } from '@radix-ui/react-slot';
import { cva, type VariantProps } from 'class-variance-authority';
import type { ComponentProps } from 'react';
import { cn } from '@/lib/utils';

const buttonVariants = cva(
  'inline-flex items-center justify-center gap-2 rounded-md font-bold whitespace-nowrap transition-colors disabled:cursor-not-allowed disabled:opacity-50 [&_svg]:size-[1.1em] [&_svg]:shrink-0',
  {
    variants: {
      variant: {
        primary: 'bg-teal text-white hover:bg-teal-dark',
        secondary: 'border border-line-strong bg-surface text-ink hover:bg-neutral-tint',
        ghost: 'text-ink hover:bg-neutral-tint',
        danger: 'border border-bad bg-surface text-bad hover:bg-bad-tint',
        dangerSolid: 'bg-bad text-white hover:brightness-90',
      },
      size: {
        sm: 'min-h-9 px-3 text-sm',
        md: 'min-h-11 px-4',
        lg: 'min-h-13 px-6 text-lg',
        icon: 'size-10',
      },
    },
    defaultVariants: { variant: 'primary', size: 'md' },
  },
);

export type ButtonProps = ComponentProps<'button'> & VariantProps<typeof buttonVariants> & { asChild?: boolean };

export function Button({ className, variant, size, asChild, type, ...props }: ButtonProps) {
  const Component = asChild ? Slot : 'button';
  return <Component type={asChild ? undefined : (type ?? 'button')} className={cn(buttonVariants({ variant, size }), 'no-underline', className)} {...props} />;
}
