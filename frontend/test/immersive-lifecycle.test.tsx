// @vitest-environment jsdom
import { act, useState } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { ImmersivePlayer } from '../src/features/immersive/ImmersivePlayer';
import { AmbientBackground } from '../src/features/immersive/AmbientBackground';
import { useArtworkPalette, FALLBACK_PALETTE } from '../src/features/immersive/use-artwork-palette';
import type { PlaybackBindings } from '../src/components/player/PlayerBar';
import { snapshot } from './regression-fixtures';
import { api } from '../src/lib/api';

vi.mock('../src/lib/api', async (original) => ({ ...(await original<typeof import('../src/lib/api')>()), api: vi.fn() }));
let roots: Root[], images: TestImage[], testId = 0;
class TestImage {
  onload: (() => void) | null = null;
  onerror: (() => void) | null = null;
  crossOrigin = '';
  referrerPolicy = '';
  src = '';
  removeAttribute = vi.fn();
  constructor() { images.push(this); }
}
let pixels: Uint8ClampedArray;
function playback(): PlaybackBindings {
  return { state: snapshot({ status: 'paused', guildId: `modal-guild-${testId}`, playbackId: `modal-play-${testId}` }), busy: '', controlsDisabled: false, volumeDraft: null, setVolumeDraft: vi.fn(), action: vi.fn().mockResolvedValue(undefined), isFavorite: () => false, toggleFavorite: vi.fn(), onSaveTrack: vi.fn() };
}
beforeEach(() => {
  roots = []; images = []; testId += 1;
  (globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
  vi.useFakeTimers();
  vi.stubGlobal('Image', TestImage);
  vi.mocked(api).mockReset().mockImplementation(() => new Promise(() => {}));
  pixels = new Uint8ClampedArray([230, 70, 20, 255, 230, 70, 20, 255]);
  vi.spyOn(HTMLCanvasElement.prototype, 'getContext').mockImplementation(() => ({ drawImage: vi.fn(), getImageData: () => ({ data: pixels }) }) as unknown as CanvasRenderingContext2D);
});
afterEach(async () => {
  await act(async () => { roots.forEach((root) => root.unmount()); await vi.runOnlyPendingTimersAsync(); });
  document.body.innerHTML = ''; vi.restoreAllMocks(); vi.unstubAllGlobals(); vi.useRealTimers();
});
async function createTestRoot() {
  const container = document.createElement('div'); document.body.append(container);
  const root = createRoot(container); roots.push(root);
  return { container, root };
}
describe('immersive dialog lifecycle', () => {
  async function modal() {
    const bindings = playback();
    function Harness() {
      const [open, setOpen] = useState(false);
      return <><button data-trigger onClick={() => setOpen(true)}>Abrir experiencia</button><input aria-label="Campo fuera del reproductor" /><ImmersivePlayer open={open} onOpenChange={setOpen} playback={bindings} connection="live" error="" guildName="Servidor de prueba" /></>;
    }
    const screen = await createTestRoot();
    await act(async () => screen.root.render(<Harness />));
    const trigger = screen.container.querySelector<HTMLButtonElement>('[data-trigger]')!;
    trigger.focus(); await act(async () => trigger.click());
    return { ...screen, trigger, bindings };
  }
  it('moves focus into the dialog and restores the external trigger on close', async () => {
    const screen = await modal();
    const dialog = document.querySelector<HTMLElement>('[role="dialog"]')!;
    expect(dialog).not.toBeNull(); expect(dialog.contains(document.activeElement)).toBe(true);
    expect(dialog.getAttribute('aria-modal')).toBe('true');
    expect(dialog.textContent).toContain('Servidor de prueba');
    await act(async () => document.querySelector<HTMLButtonElement>('[aria-label="Cerrar reproductor inmersivo"]')!.click());
    await act(async () => vi.advanceTimersByTimeAsync(1));
    expect(document.querySelector('[role="dialog"]')).toBeNull();
    expect(document.activeElement).toBe(screen.trigger);
    expect(screen.bindings.action).not.toHaveBeenCalled();
  });
  it('closes through Escape without issuing any music command or creating SSE', async () => {
    const EventSourceSpy = vi.fn(); vi.stubGlobal('EventSource', EventSourceSpy);
    const screen = await modal();
    await act(async () => document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true })));
    await act(async () => vi.advanceTimersByTimeAsync(1));
    expect(document.querySelector('[role="dialog"]')).toBeNull();
    expect(screen.bindings.action).not.toHaveBeenCalled(); expect(EventSourceSpy).not.toHaveBeenCalled();
  });
  it('returns focus inside if an outside element receives programmatic focus', async () => {
    const screen = await modal();
    await act(async () => screen.container.querySelector<HTMLInputElement>('input')!.focus());
    expect(document.querySelector('[role="dialog"]')?.contains(document.activeElement)).toBe(true);
  });
  it('preserves the song while switching the mobile view', async () => {
    const screen = await modal();
    const dialog = document.querySelector<HTMLElement>('[role="dialog"]')!;
    const tabs = [...dialog.querySelectorAll<HTMLButtonElement>('.immersive-mobile-switch button')];
    await act(async () => tabs[1].click());
    expect(dialog.querySelector('.immersive-stage')?.getAttribute('data-mobile-view')).toBe('lyrics');
    expect(tabs[1].getAttribute('aria-pressed')).toBe('true');
    expect(screen.bindings.action).not.toHaveBeenCalled();
    await act(async () => tabs[0].click());
    expect(dialog.querySelector('.immersive-stage')?.getAttribute('data-mobile-view')).toBe('artwork');
  });
});
describe('artwork extraction effects', () => {
  async function palette(initialUrl: string) {
    let url = initialUrl, current = FALLBACK_PALETTE;
    function Harness() { current = useArtworkPalette(url); return <output>{current.primary}</output>; }
    const screen = await createTestRoot();
    const render = () => screen.root.render(<Harness />);
    await act(async () => render());
    return { ...screen, get current() { return current; }, async setUrl(next: string) { url = next; await act(async () => render()); } };
  }
  it('samples a 24px canvas once with anonymous CORS and does not overwrite success at timeout', async () => {
    const screen = await palette(`https://art.test/success-${testId}.jpg`);
    expect(images[0].crossOrigin).toBe('anonymous'); expect(images[0].referrerPolicy).toBe('no-referrer');
    await act(async () => images[0].onload?.());
    const result = screen.current.primary;
    expect(result).not.toBe(FALLBACK_PALETTE.primary);
    const canvas = vi.mocked(HTMLCanvasElement.prototype.getContext).mock.instances[0] as HTMLCanvasElement;
    expect(canvas.width).toBe(24); expect(canvas.height).toBe(24);
    await act(async () => vi.advanceTimersByTimeAsync(5001));
    expect(screen.current.primary).toBe(result);
  });
  it('falls back when the image fails and never processes a late image after timeout', async () => {
    const failed = await palette(`https://art.test/fail-${testId}.jpg`);
    await act(async () => images[0].onerror?.());
    expect(failed.current).toEqual(FALLBACK_PALETTE);
    const timed = await palette(`https://art.test/timeout-${testId}.jpg`);
    await act(async () => vi.advanceTimersByTimeAsync(5001));
    const calls = vi.mocked(HTMLCanvasElement.prototype.getContext).mock.calls.length;
    await act(async () => images[1].onload?.());
    expect(timed.current).toEqual(FALLBACK_PALETTE);
    expect(vi.mocked(HTMLCanvasElement.prototype.getContext)).toHaveBeenCalledTimes(calls);
    // A late network image does no additional canvas work after timeout.
  });
  it('uses the fallback if canvas readback is blocked by CORS', async () => {
    vi.mocked(HTMLCanvasElement.prototype.getContext).mockImplementation(() => ({ drawImage() { throw new DOMException('Tainted canvas', 'SecurityError'); } }) as unknown as CanvasRenderingContext2D);
    const screen = await palette(`https://art.test/cors-${testId}.jpg`);
    await act(async () => images[0].onload?.());
    expect(screen.current).toEqual(FALLBACK_PALETTE);
  });
  it('ignores late A callbacks after B is current and cancels detached image work', async () => {
    const screen = await palette(`https://art.test/a-${testId}.jpg`), lateA = images[0].onload!;
    await screen.setUrl(`https://art.test/b-${testId}.jpg`);
    expect(images[0].onload).toBeNull(); expect(images[0].removeAttribute).toHaveBeenCalledWith('src');
    await act(async () => lateA());
    expect(screen.current).toEqual(FALLBACK_PALETTE);
    pixels = new Uint8ClampedArray([20, 70, 240, 255]);
    await act(async () => images[1].onload?.());
    expect(screen.current.primary).toBe('rgb(10, 34, 116)');
  });
  it('reuses a cached palette across unmount without another image request', async () => {
    const url = `https://art.test/reopen-${testId}.jpg`, screen = await palette(url);
    await act(async () => images[0].onload?.());
    await act(async () => screen.root.unmount()); roots = roots.filter((root) => root !== screen.root);
    const reopened = await palette(url);
    expect(images).toHaveLength(1); expect(reopened.current.primary).toBe('rgb(116, 35, 10)');
  });
  it('removes the outgoing ambient layer after the chromatic transition', async () => {
    const screen = await createTestRoot();
    await act(async () => screen.root.render(<AmbientBackground thumbnail={`https://art.test/ambient-${testId}.jpg`} />));
    await act(async () => images[0].onload?.());
    expect(screen.container.querySelector('.is-leaving')).not.toBeNull();
    await act(async () => vi.advanceTimersByTimeAsync(851));
    expect(screen.container.querySelector('.is-leaving')).toBeNull();
  });
  it('propagates extracted ambient CSS custom properties to the parent element', async () => {
    const screen = await createTestRoot();
    await act(async () => screen.root.render(<AmbientBackground thumbnail={`https://art.test/ambient-${testId}.jpg`} />));
    pixels = new Uint8ClampedArray([180, 50, 40, 255]);
    await act(async () => images[0].onload?.());
    const primary = screen.container.style.getPropertyValue('--ambient-primary');
    expect(primary).toBeTruthy();
    expect(primary).toContain('rgb(');
  });
  it('adapts layout state data-has-lyrics when lyrics are present vs absent', async () => {
    const bindings = playback();
    let resolveLyrics!: (value: unknown) => void;
    vi.mocked(api).mockImplementation((path) => {
      if (path.includes('/lyrics/current')) {
        return new Promise((resolve) => { resolveLyrics = resolve; }) as ReturnType<typeof api>;
      }
      return new Promise(() => {}) as ReturnType<typeof api>;
    });
    function Harness() {
      const [open, setOpen] = useState(true);
      return <ImmersivePlayer open={open} onOpenChange={setOpen} playback={bindings} connection="live" error="" guildName="Servidor de prueba" />;
    }
    const screen = await createTestRoot();
    await act(async () => screen.root.render(<Harness />));
    const dialog = document.querySelector<HTMLElement>('[role="dialog"]')!;
    const stage = dialog.querySelector<HTMLElement>('.immersive-stage')!;
    expect(stage.getAttribute('data-has-lyrics')).toBe('false');

    await act(async () => resolveLyrics({
      guildId: bindings.state!.guildId,
      trackId: bindings.state!.current!.id,
      playbackId: bindings.state!.playbackId,
      status: 'instrumental',
      source: { name: 'LRCLIB', url: 'https://lrclib.net', recordId: 1 },
    }));
    expect(stage.getAttribute('data-has-lyrics')).toBe('false');
    expect(dialog.getAttribute('data-has-lyrics')).toBe('false');
    expect(dialog.textContent).toContain('Esta pista es instrumental.');
  });
  it('sets data-has-lyrics="true" and preserves split layout when synced lyrics resolve', async () => {
    const bindings = playback();
    let resolveLyrics!: (value: unknown) => void;
    vi.mocked(api).mockImplementation((path) => {
      if (path.includes('/lyrics/current')) {
        return new Promise((resolve) => { resolveLyrics = resolve; }) as ReturnType<typeof api>;
      }
      return new Promise(() => {}) as ReturnType<typeof api>;
    });
    function Harness() {
      const [open, setOpen] = useState(true);
      return <ImmersivePlayer open={open} onOpenChange={setOpen} playback={bindings} connection="live" error="" guildName="Servidor de prueba" />;
    }
    const screen = await createTestRoot();
    await act(async () => screen.root.render(<Harness />));
    const dialog = document.querySelector<HTMLElement>('[role="dialog"]')!;
    const stage = dialog.querySelector<HTMLElement>('.immersive-stage')!;

    await act(async () => resolveLyrics({
      guildId: bindings.state!.guildId,
      trackId: bindings.state!.current!.id,
      playbackId: bindings.state!.playbackId,
      status: 'synced',
      lines: [{ timeMs: 0, text: 'Línea uno' }],
      source: { name: 'LRCLIB', url: 'https://lrclib.net', recordId: 1 },
    }));
    expect(stage.getAttribute('data-has-lyrics')).toBe('true');
    expect(dialog.getAttribute('data-has-lyrics')).toBe('true');
    expect(dialog.querySelector('.immersive-lyric-lines')).not.toBeNull();
  });
  it('preserves retry action and displays error reason in no-lyrics temporary error state', async () => {
    const bindings = playback();
    let resolveLyrics!: (value: unknown) => void;
    vi.mocked(api).mockImplementation((path) => {
      if (path.includes('/lyrics/current')) {
        return new Promise((resolve) => { resolveLyrics = resolve; }) as ReturnType<typeof api>;
      }
      return new Promise(() => {}) as ReturnType<typeof api>;
    });
    function Harness() {
      const [open, setOpen] = useState(true);
      return <ImmersivePlayer open={open} onOpenChange={setOpen} playback={bindings} connection="live" error="" guildName="Servidor de prueba" />;
    }
    const screen = await createTestRoot();
    await act(async () => screen.root.render(<Harness />));
    const dialog = document.querySelector<HTMLElement>('[role="dialog"]')!;

    await act(async () => resolveLyrics({
      guildId: bindings.state!.guildId,
      trackId: bindings.state!.current!.id,
      playbackId: bindings.state!.playbackId,
      status: 'temporary_error',
      retryAfterMs: 2000,
      reason: 'timeout',
    }));
    expect(dialog.textContent).toContain('Las letras no están disponibles ahora');
    expect(dialog.textContent).toContain('tardó demasiado');
    const retryBtn = dialog.querySelector<HTMLButtonElement>('.immersive-retry')!;
    expect(retryBtn).not.toBeNull();
    expect(retryBtn.disabled).toBe(true);

    await act(async () => vi.advanceTimersByTimeAsync(2005));
    expect(retryBtn.disabled).toBe(false);
  });
});
