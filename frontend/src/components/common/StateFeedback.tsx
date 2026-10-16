import { LoaderCircle } from 'lucide-react';
import type { ReactNode } from 'react';

export interface LoadingProps {
  text: string;
}
export interface EmptyStateProps {
  icon: ReactNode;
  title: string;
  text: string;
  action?: ReactNode;
}

export function Loading({ text }: LoadingProps) {
  return (
    <div className="loading-block" role="status">
      <LoaderCircle size={22} className="spin" />
      {text}
    </div>
  );
}
export function EmptyState({ icon, title, text, action }: EmptyStateProps) {
  return (
    <div className="empty-state">
      <span className="empty-icon">{icon}</span>
      <h2>{title}</h2>
      <p>{text}</p>
      {action}
    </div>
  );
}
