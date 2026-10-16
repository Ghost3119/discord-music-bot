import { memo, useEffect, useState, useRef, type CSSProperties } from 'react';
import { useArtworkPalette, type ArtworkPalette } from './use-artwork-palette';

export const AmbientBackground = memo(function AmbientBackground({ thumbnail }: { thumbnail?: string | null }) {
  const palette = useArtworkPalette(thumbnail);
  const [displayed, setDisplayed] = useState(palette);
  const paletteRef = useRef(palette);
  const [previous, setPrevious] = useState<ArtworkPalette | null>(null);
  const containerRef = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const before = paletteRef.current;
    if (palette.primary === before.primary && palette.secondary === before.secondary) return;
    setPrevious(before);
    paletteRef.current = palette;
    setDisplayed(palette);
    const timer = setTimeout(() => setPrevious(null), 850);
    return () => clearTimeout(timer);
  }, [palette]);
  useEffect(() => {
    const parent = containerRef.current?.parentElement;
    if (parent) {
      parent.style.setProperty('--ambient-primary', displayed.primary);
      parent.style.setProperty('--ambient-secondary', displayed.secondary);
    }
  }, [displayed]);
  const layerStyle = (colors: ArtworkPalette) => ({ '--ambient-primary': colors.primary, '--ambient-secondary': colors.secondary } as CSSProperties);
  return <div ref={containerRef} className="immersive-ambient" aria-hidden="true">
    <div key={`${displayed.primary}:${displayed.secondary}`} className="immersive-ambient-color" style={layerStyle(displayed)} />
    {previous && <div key={`previous:${previous.primary}:${previous.secondary}`} className="immersive-ambient-color is-leaving" style={layerStyle(previous)} />}
    <div className="immersive-ambient-veil" />
  </div>;
});
