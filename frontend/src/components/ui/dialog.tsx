import * as DialogPrimitive from '@radix-ui/react-dialog';
import { X } from 'lucide-react';
import type { ReactNode } from 'react';
import { Button } from './button';

export function Dialog({ open, onOpenChange, title, description, children }: { open: boolean; onOpenChange: (open: boolean) => void; title: string; description: string; children: ReactNode }) {
  return <DialogPrimitive.Root open={open} onOpenChange={onOpenChange}>
    <DialogPrimitive.Portal>
      <DialogPrimitive.Overlay className="dialog-overlay" />
      <DialogPrimitive.Content className="dialog-content">
        <DialogPrimitive.Title className="dialog-title">{title}</DialogPrimitive.Title>
        <DialogPrimitive.Description className="muted dialog-description">{description}</DialogPrimitive.Description>
        {children}
        <DialogPrimitive.Close asChild><Button size="icon" variant="ghost" className="dialog-close" aria-label="Cerrar ventana"><X size={18} /></Button></DialogPrimitive.Close>
      </DialogPrimitive.Content>
    </DialogPrimitive.Portal>
  </DialogPrimitive.Root>;
}
