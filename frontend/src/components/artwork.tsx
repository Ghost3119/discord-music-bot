import { AudioLines } from 'lucide-react';
import { useState } from 'react';
import type { Track } from '../lib/api';
import { cn } from '../lib/utils';

export function Artwork({ track, className, decorative = false }: { track?: Track | null; className?: string; decorative?: boolean }) {
  const [failed, setFailed] = useState('');
  const thumbnail = track?.thumbnail;
  return <div className={cn('artwork', className)}>
    {thumbnail && failed !== thumbnail
      ? <img src={thumbnail} onError={() => setFailed(thumbnail)} alt={decorative ? '' : `Portada de ${track?.title}`} loading="lazy" referrerPolicy="no-referrer" />
      : <div className="artwork-fallback" aria-hidden="true"><span className="orbit orbit-one" /><span className="orbit orbit-two" /><span className="orbit orbit-three" /><AudioLines strokeWidth={1.1} /></div>}
  </div>;
}
