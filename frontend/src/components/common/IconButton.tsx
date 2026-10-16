import type { ComponentProps, ReactNode } from 'react';
import { Button } from '../ui/button';
import { cn } from '../../lib/utils';

export interface IconButtonProps extends ComponentProps<typeof Button> {
  label: string;
  children: ReactNode;
  active?: boolean;
}

export function IconButton({ label, children, active, className, ...props }: IconButtonProps) {
  return (
    <Button
      variant="ghost"
      size="icon"
      title={label}
      aria-label={label}
      className={cn(active && 'is-active', className)}
      {...props}
    >
      {children}
    </Button>
  );
}
