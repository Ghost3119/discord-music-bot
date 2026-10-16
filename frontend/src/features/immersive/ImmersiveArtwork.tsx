import { memo, useEffect, useState } from 'react';
import { AudioLines } from 'lucide-react';
import type { Track } from '../../lib/api';

export const ImmersiveArtwork = memo(function ImmersiveArtwork({ track }: { track?: Track | null }) {
  const [failedUrl, setFailedUrl] = useState('');
  const key = track?.thumbnail || track?.id || 'idle';
  const [previous, setPrevious] = useState<{ key: string; url: string } | null>(null);
  const [displayed, setDisplayed] = useState({ key, url: track?.thumbnail || '' });
  useEffect(() => {
    if (key === displayed.key) return;
    setPrevious(displayed.url ? displayed : null);
    setDisplayed({ key, url: track?.thumbnail || '' });
    // The outgoing artwork alone fades; titles and lyrics always use the current identity.
  }, [key, displayed, track?.thumbnail]);
  useEffect(() => {
    if (!previous) return;
    const timer = setTimeout(() => setPrevious(null), 260);
    return () => clearTimeout(timer);
  }, [previous]);
  return <div className="immersive-artwork" aria-label={track ? `Portada de ${track.title}` : 'Sin portada'}>
    {track?.thumbnail && failedUrl !== track.thumbnail
      ? <img key={key} className="immersive-cover-image" src={track.thumbnail} alt="" decoding="async" referrerPolicy="no-referrer" onError={() => setFailedUrl(track.thumbnail || '')} />
      : <div key={key} className="immersive-cover-fallback" aria-hidden="true"><AudioLines strokeWidth={.8} /><span>SONORA</span></div>}
    {previous && previous.url !== failedUrl && <img className="immersive-cover-previous" src={previous.url} alt="" aria-hidden="true" referrerPolicy="no-referrer" />}
  </div>;
});
