import { useEffect, useState } from 'react';

export type ArtworkPalette = { primary: string; secondary: string };
export const FALLBACK_PALETTE: ArtworkPalette = { primary: '#3f475a', secondary: '#423747' };
const palettes = new Map<string, ArtworkPalette>();
const MAX_PALETTES = 48;
/** Small quantized sample, with luminance capped before it reaches the text backdrop. */
export function paletteFromPixels(pixels: Uint8ClampedArray): ArtworkPalette {
  const buckets = new Map<string, { r: number; g: number; b: number; count: number; weight: number }>();
  for (let i = 0; i < pixels.length; i += 4) {
    if (pixels[i + 3] < 180) continue;
    const [r, g, b] = [pixels[i], pixels[i + 1], pixels[i + 2]];
    const hi = Math.max(r, g, b), lo = Math.min(r, g, b);
    if (hi < 28 || lo > 232) continue;
    const key = [r, g, b].map((channel) => Math.floor(channel / 48)).join(',');
    const item = buckets.get(key) || { r: 0, g: 0, b: 0, count: 0, weight: 0 };
    item.r += r; item.g += g; item.b += b; item.count += 1;
    item.weight += .4 + (hi - lo) / 255;
    buckets.set(key, item);
  }
  const ranked = [...buckets.values()].sort((a, b) => b.weight - a.weight);
  if (!ranked.length) return FALLBACK_PALETTE;
  const color = (item: typeof ranked[number]) => {
    const rgb = [item.r, item.g, item.b].map((value) => value / item.count);
    const scale = Math.min(1, 116 / Math.max(...rgb));
    return `rgb(${rgb.map((value) => Math.round(value * scale)).join(', ')})`;
  };
  const first = ranked[0];
  const second = ranked.find((item) => Math.abs(item.r / item.count - first.r / first.count) + Math.abs(item.g / item.count - first.g / first.count) + Math.abs(item.b / item.count - first.b / first.count) > 100) || ranked[1] || first;
  return { primary: color(first), secondary: color(second) };
}
export function useArtworkPalette(url?: string | null): ArtworkPalette {
  const [result, setResult] = useState<{ url: string; palette: ArtworkPalette } | null>(null);
  useEffect(() => {
    if (!url) return;
    const cached = palettes.get(url);
    if (cached) { setResult({ url, palette: cached }); return; }
    let live = true;
    let completed = false;
    let timer: ReturnType<typeof setTimeout>;
    const image = new Image();
    image.crossOrigin = 'anonymous';
    image.referrerPolicy = 'no-referrer';
    const finish = (palette: ArtworkPalette) => {
      if (!live || completed) return;
      completed = true;
      clearTimeout(timer);
      palettes.set(url, palette);
      while (palettes.size > MAX_PALETTES) palettes.delete(palettes.keys().next().value!);
      setResult({ url, palette });
    };
    image.onload = () => {
      if (!live || completed) return;
      try {
        const canvas = document.createElement('canvas');
        canvas.width = 24; canvas.height = 24;
        const context = canvas.getContext('2d', { willReadFrequently: true });
        if (!context) { finish(FALLBACK_PALETTE); return; }
        context.drawImage(image, 0, 0, 24, 24);
        finish(paletteFromPixels(context.getImageData(0, 0, 24, 24).data));
      } catch { finish(FALLBACK_PALETTE); }
    };
    image.onerror = () => finish(FALLBACK_PALETTE);
    image.src = url;
    timer = setTimeout(() => finish(FALLBACK_PALETTE), 5000);
    return () => {
      live = false; clearTimeout(timer);
      image.onload = null; image.onerror = null;
      image.removeAttribute('src');
    };
  }, [url]);
  return result && result.url === url ? result.palette : FALLBACK_PALETTE;
}
