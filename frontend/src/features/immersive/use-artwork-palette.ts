import { useEffect, useState } from 'react';

/**
 * Three atmospheric tones derived from the cover:
 * - primary: halo behind the artwork (brightest, still capped for legibility)
 * - secondary: wide ambient wash across the stage
 * - accent: deep tint that carries the colour into the lyrics side
 */
export type ArtworkPalette = { primary: string; secondary: string; accent: string };
/** Slate / plum / moss: neutral enough for any track, with a faint echo of SONORA's lime accent. */
export const FALLBACK_PALETTE: ArtworkPalette = { primary: 'rgb(52, 63, 88)', secondary: 'rgb(56, 45, 70)', accent: 'rgb(38, 50, 36)' };
const palettes = new Map<string, ArtworkPalette>();
const MAX_PALETTES = 48;
const SAMPLE = 24;

type Rgb = [number, number, number];
type Hsl = [number, number, number];
type Bucket = { r: number; g: number; b: number; count: number; weight: number };
type ToneBand = { minL: number; maxL: number; minS: number; maxS: number; maxLum: number };

/**
 * Lightness/saturation band per layer plus a WCAG relative-luminance ceiling, so that
 * #f3f3f1 text keeps ≥ 4.5:1 even against a fully opaque layer (the veil only adds margin).
 */
const PRIMARY: ToneBand = { minL: .3, maxL: .42, minS: .26, maxS: .66, maxLum: .16 };
const SECONDARY: ToneBand = { minL: .22, maxL: .32, minS: .22, maxS: .6, maxLum: .09 };
const ACCENT: ToneBand = { minL: .16, maxL: .26, minS: .18, maxS: .52, maxLum: .06 };

const clamp = (value: number, min: number, max: number) => Math.min(max, Math.max(min, value));
const mean = (bucket: Bucket): Rgb => [bucket.r / bucket.count, bucket.g / bucket.count, bucket.b / bucket.count];
const css = (rgb: Rgb) => `rgb(${rgb.map((value) => Math.round(clamp(value, 0, 255))).join(', ')})`;
const hueGap = (a: number, b: number) => { const gap = Math.abs(a - b) % 360; return gap > 180 ? 360 - gap : gap; };

function toHsl([r, g, b]: Rgb): Hsl {
  const [rn, gn, bn] = [r / 255, g / 255, b / 255];
  const hi = Math.max(rn, gn, bn), lo = Math.min(rn, gn, bn), l = (hi + lo) / 2, d = hi - lo;
  if (!d) return [0, 0, l];
  const s = d / (1 - Math.abs(2 * l - 1));
  const h = hi === rn ? ((gn - bn) / d + 6) % 6 : hi === gn ? (bn - rn) / d + 2 : (rn - gn) / d + 4;
  return [h * 60, s, l];
}
function fromHsl([h, s, l]: Hsl): Rgb {
  const c = (1 - Math.abs(2 * l - 1)) * s, x = c * (1 - Math.abs((h / 60) % 2 - 1)), m = l - c / 2;
  const sector = Math.floor((((h % 360) + 360) % 360) / 60);
  const [r, g, b] = [[c, x, 0], [x, c, 0], [0, c, x], [0, x, c], [x, 0, c], [c, 0, x]][sector];
  return [(r + m) * 255, (g + m) * 255, (b + m) * 255];
}
function luminance(rgb: Rgb) {
  const [r, g, b] = rgb.map((value) => { const c = value / 255; return c <= .03928 ? c / 12.92 : ((c + .055) / 1.055) ** 2.4; });
  return .2126 * r + .7152 * g + .0722 * b;
}
/** Re-light a hue into its band: dark covers are lifted so the hue reads, bright or neon ones are tamed. */
function tone([h, s, l]: Hsl, band: ToneBand): Rgb {
  const sat = clamp(s, band.minS, band.maxS);
  let light = clamp(l, band.minL, band.maxL);
  let rgb = fromHsl([h, sat, light]);
  // Yellows and greens are perceptually bright: step lightness down until under the ceiling.
  while (luminance(rgb) > band.maxLum && light > .08) { light -= .01; rgb = fromHsl([h, sat, light]); }
  return rgb;
}
function graphite(l: number, tint?: Hsl): ArtworkPalette {
  // Monochrome covers get an intentional cool silver/graphite atmosphere instead of the generic fallback.
  const base = clamp(l, .32, .5);
  return {
    primary: css(tone([218, .1, base * .82], { ...PRIMARY, minS: .06, maxS: .12 })),
    secondary: css(tone([226, .08, base * .58], { ...SECONDARY, minS: .05, maxS: .1 })),
    accent: css(tint ? tone(tint, { ...ACCENT, maxS: .34 }) : tone([210, .07, .2], { ...ACCENT, minS: .05, maxS: .09 })),
  };
}

/**
 * Quantized 24×24 sample → three atmospheric tones. Chromatic pixels are ranked by
 * vividness and centre weight so a colourful subject beats a dark backdrop; neutral
 * pixels only drive the result when the cover is genuinely monochrome.
 */
export function paletteFromPixels(pixels: Uint8ClampedArray): ArtworkPalette {
  const chromatic = new Map<string, Bucket>(), neutral = new Map<string, Bucket>();
  const grid = pixels.length === SAMPLE * SAMPLE * 4;
  let chromaticCount = 0, counted = 0;
  for (let i = 0; i < pixels.length; i += 4) {
    if (pixels[i + 3] < 180) continue;
    const r = pixels[i], g = pixels[i + 1], b = pixels[i + 2];
    const hi = Math.max(r, g, b), lo = Math.min(r, g, b), chroma = hi - lo, sat = hi ? chroma / hi : 0;
    if (hi < 22 || lo > 238) continue; // clipped blacks / whites carry no atmosphere
    counted += 1;
    let spatial = 1;
    if (grid) {
      const index = i / 4, x = index % SAMPLE, y = Math.floor(index / SAMPLE);
      spatial = x >= 4 && x < SAMPLE - 4 && y >= 4 && y < SAMPLE - 4 ? 1.35 : .65;
    }
    const isChromatic = chroma >= 24 && sat >= .18 && hi >= 46;
    const map = isChromatic ? chromatic : neutral;
    const step = isChromatic ? 36 : 48;
    const key = `${Math.floor(r / step)},${Math.floor(g / step)},${Math.floor(b / step)}`;
    const item = map.get(key) || { r: 0, g: 0, b: 0, count: 0, weight: 0 };
    item.r += r; item.g += g; item.b += b; item.count += 1;
    if (isChromatic) {
      chromaticCount += 1;
      item.weight += spatial * (.35 + sat * 1.65) * (.45 + chroma / 255 * 1.55);
    } else {
      const midTone = 1 - Math.abs((hi + lo) / 2 - 128) / 140;
      item.weight += spatial * Math.max(.2, midTone * .6);
    }
    map.set(key, item);
  }
  if (!counted) return FALLBACK_PALETTE;
  const rank = (map: Map<string, Bucket>) => [...map.values()].sort((a, b) => b.weight - a.weight).map((bucket) => toHsl(mean(bucket)));
  const colours = rank(chromatic), neutrals = rank(neutral);
  // A tiny logo on a grey sleeve should tint the accent, not repaint the whole stage.
  if (!colours.length || chromaticCount / counted < .05) return graphite(neutrals[0]?.[2] ?? .4, colours[0]);
  const first = colours[0];
  const second = colours.find((hsl) => hueGap(hsl[0], first[0]) >= 22) || [(first[0] + 336) % 360, first[1], first[2] * .8] as Hsl;
  const third = colours.find((hsl) => hueGap(hsl[0], first[0]) >= 22 && hueGap(hsl[0], second[0]) >= 22) || [(first[0] + 18) % 360, first[1], first[2] * .7] as Hsl;
  return { primary: css(tone(first, PRIMARY)), secondary: css(tone(second, SECONDARY)), accent: css(tone(third, ACCENT)) };
}

/**
 * yt-dlp stores `vi_webp/<id>/*.webp` thumbnails, which i.ytimg.com serves without a usable
 * CORS header, so canvas readback is tainted. The same frame under `vi/<id>/hqdefault.jpg`
 * is served with `Access-Control-Allow-Origin: *`. Other hosts are sampled untouched.
 */
export function sampleableArtworkUrl(url: string) {
  return url.replace(/^(https?:\/\/(?:i\d?|img)\.ytimg\.com)\/vi_webp\/([\w-]+)\/[^?#]+\.webp(?:[?#].*)?$/i, '$1/vi/$2/hqdefault.jpg');
}
/** Centre-square crop (what `object-fit: cover` shows); YouTube 4:3 frames also drop their letterbox bars. */
function sourceSquare(image: HTMLImageElement, youtube: boolean) {
  const width = image.naturalWidth || 0, height = image.naturalHeight || 0;
  if (!width || !height) return null;
  const side = Math.min(width, youtube && width / height < 1.5 ? height * .75 : height);
  return [(width - side) / 2, (height - side) / 2, side, side] as const;
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
    const source = sampleableArtworkUrl(url);
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
        canvas.width = SAMPLE; canvas.height = SAMPLE;
        const context = canvas.getContext('2d', { willReadFrequently: true });
        if (!context) { finish(FALLBACK_PALETTE); return; }
        const square = sourceSquare(image, /ytimg\.com/i.test(source));
        if (square) context.drawImage(image, ...square, 0, 0, SAMPLE, SAMPLE);
        else context.drawImage(image, 0, 0, SAMPLE, SAMPLE);
        finish(paletteFromPixels(context.getImageData(0, 0, SAMPLE, SAMPLE).data));
      } catch { finish(FALLBACK_PALETTE); }
    };
    image.onerror = () => finish(FALLBACK_PALETTE);
    image.src = source;
    timer = setTimeout(() => finish(FALLBACK_PALETTE), 5000);
    return () => {
      live = false; clearTimeout(timer);
      image.onload = null; image.onerror = null;
      image.removeAttribute('src');
    };
  }, [url]);
  return result && result.url === url ? result.palette : FALLBACK_PALETTE;
}
