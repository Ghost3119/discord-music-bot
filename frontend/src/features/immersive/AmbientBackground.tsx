import { memo, useEffect, useState, useRef, type CSSProperties } from 'react';
import { useArtworkPalette, FALLBACK_PALETTE, type ArtworkPalette } from './use-artwork-palette';

/** Outgoing palette lifetime; matches `immersive-ambient-leave` in immersive.css. */
export const AMBIENT_CROSSFADE_MS = 1200;
const same = (a: ArtworkPalette, b: ArtworkPalette) => a.primary === b.primary && a.secondary === b.secondary && a.accent === b.accent;
const vars = (colors: ArtworkPalette) => ({ '--ambient-primary': colors.primary, '--ambient-secondary': colors.secondary, '--ambient-accent': colors.accent } as CSSProperties);

/**
 * Dark base + palette layer (halo behind the cover, stage wash, lyrics-side tint) + legibility veil.
 * On a song change the new palette blooms in while the previous one dissolves on top of it.
 */
export const AmbientBackground = memo(function AmbientBackground({ thumbnail }: { thumbnail?: string | null }) {
  const palette = useArtworkPalette(thumbnail);
  const [displayed, setDisplayed] = useState(palette);
  const paletteRef = useRef(palette);
  const [previous, setPrevious] = useState<ArtworkPalette | null>(null);
  const containerRef = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const before = paletteRef.current;
    if (same(palette, before)) return;
    setPrevious(before);
    paletteRef.current = palette;
    setDisplayed(palette);
    const timer = setTimeout(() => setPrevious(null), AMBIENT_CROSSFADE_MS);
    return () => clearTimeout(timer);
  }, [palette]);
  useEffect(() => {
    // The player shell reads the same tones for the cover backlight and the no-lyrics status chip.
    const parent = containerRef.current?.parentElement;
    if (!parent) return;
    parent.style.setProperty('--ambient-primary', displayed.primary);
    parent.style.setProperty('--ambient-secondary', displayed.secondary);
    parent.style.setProperty('--ambient-accent', displayed.accent);
  }, [displayed]);
  const source = same(displayed, FALLBACK_PALETTE) ? 'fallback' : 'artwork';
  return <div ref={containerRef} className="immersive-ambient" data-palette={source} aria-hidden="true">
    <div key={`${displayed.primary}:${displayed.secondary}:${displayed.accent}`} className="immersive-ambient-color" style={vars(displayed)} />
    {previous && <div key={`previous:${previous.primary}:${previous.secondary}:${previous.accent}`} className="immersive-ambient-color is-leaving" style={vars(previous)} />}
    <div className="immersive-ambient-veil" />
  </div>;
});
