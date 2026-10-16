// @vitest-environment jsdom
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { ImmersiveControls } from '../src/features/immersive/ImmersiveControls';
import { paletteFromPixels, FALLBACK_PALETTE } from '../src/features/immersive/use-artwork-palette';
import type { PlaybackBindings } from '../src/components/player/PlayerBar';
import { snapshot } from './regression-fixtures';

let roots: Root[];
function playback(overrides: Partial<PlaybackBindings> = {}): PlaybackBindings {
  return { state: snapshot(), busy: '', controlsDisabled: false, volumeDraft: null, setVolumeDraft: vi.fn(), action: vi.fn().mockResolvedValue(undefined), isFavorite: () => false, toggleFavorite: vi.fn(), onSaveTrack: vi.fn(), ...overrides };
}
async function controls(bindings: PlaybackBindings, connection: 'connecting' | 'live' | 'reconnecting' = 'live') {
  const container = document.createElement('div'); document.body.append(container);
  const root = createRoot(container); roots.push(root);
  await act(async () => root.render(<ImmersiveControls playback={bindings} connection={connection} />));
  return container;
}
beforeEach(() => { roots = []; (globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true; });
afterEach(async () => { await act(async () => roots.forEach((root) => root.unmount())); document.body.innerHTML = ''; });
function button(container: HTMLElement, label: string) { return container.querySelector<HTMLButtonElement>(`button[aria-label="${label}"]`)!; }
describe('real immersive controls', () => {
  it.each(['playing', 'paused'] as const)('dispatches %s pause/resume and the existing queue actions', async (status) => {
    const bindings = playback({ state: snapshot({ status }) }), container = await controls(bindings);
    await act(async () => button(container, status === 'playing' ? 'Pausar reproducción' : 'Continuar reproducción').click());
    await act(async () => button(container, 'Siguiente canción').click());
    await act(async () => button(container, 'Mezclar cola').click());
    await act(async () => button(container, 'Repetición: desactivada. Cambiar modo').click());
    expect(bindings.action).toHaveBeenNthCalledWith(1, { action: status === 'playing' ? 'pause' : 'resume' });
    expect(bindings.action).toHaveBeenNthCalledWith(2, { action: 'skip' });
    expect(bindings.action).toHaveBeenNthCalledWith(3, { action: 'shuffle' });
    expect(bindings.action).toHaveBeenNthCalledWith(4, { action: 'repeat', mode: 1 });
    expect(container.textContent).not.toContain('Anterior'); expect(container.querySelector('[aria-label*="Seek"]')).toBeNull();
  });
  it.each(['connecting', 'reconnecting'] as const)('disables musical commands while %s', async (connection) => {
    const bindings = playback(), container = await controls(bindings, connection);
    expect([...container.querySelectorAll<HTMLButtonElement>('button')].every((item) => item.disabled)).toBe(true);
    expect(container.querySelector<HTMLInputElement>('input')?.disabled).toBe(true);
    await act(async () => button(container, 'Pausar reproducción').click()); expect(bindings.action).not.toHaveBeenCalled();
  });
  it('uses the server permission result to disable all musical commands', async () => {
    const permissions = { role: 'member' as const, isMember: true, inVoiceChannel: false, canControl: false, isAdmin: false, canRead: true, canManageLibrary: true, canViewDiagnostics: false, canManageConfig: false };
    const container = await controls(playback({ state: snapshot({ permissions }) }));
    expect([...container.querySelectorAll<HTMLButtonElement>('button')].every((item) => item.disabled)).toBe(true);
  });
  it('represents busy/empty/blocked state without dispatching unsupported operations', async () => {
    const busy = await controls(playback({ busy: 'pause' }));
    expect(busy.querySelector('[aria-busy="true"]')).not.toBeNull();
    expect(button(busy, 'Pausar reproducción').disabled).toBe(true);
    const idle = await controls(playback({ state: snapshot({ current: null, status: 'idle', queue: [] }) }));
    expect(button(idle, 'Continuar reproducción').disabled).toBe(true);
    expect(button(idle, 'Siguiente canción').disabled).toBe(true);
    const blocked = await controls(playback({ state: snapshot({ status: 'blocked' }) }));
    expect(button(blocked, 'Siguiente canción').disabled).toBe(true);
  });
  it('preserves an explicit zero volume and only commits adjustment keys', async () => {
    const bindings = playback({ volumeDraft: 0 }), container = await controls(bindings);
    const slider = container.querySelector<HTMLInputElement>('input')!;
    expect(slider.value).toBe('0');
    await act(async () => slider.dispatchEvent(new KeyboardEvent('keyup', { bubbles: true, key: 'Tab' })));
    expect(bindings.action).not.toHaveBeenCalled();
    await act(async () => slider.dispatchEvent(new KeyboardEvent('keyup', { bubbles: true, key: 'ArrowLeft' })));
    expect(bindings.action).toHaveBeenCalledWith({ action: 'volume', volume: 0 });
    expect(bindings.setVolumeDraft).toHaveBeenLastCalledWith(null);
  });
});
describe('bounded artwork colors', () => {
  it('uses a neutral fallback for transparent, white, black or invalid image pixels', () => {
    expect(paletteFromPixels(new Uint8ClampedArray([]))).toEqual(FALLBACK_PALETTE);
    expect(paletteFromPixels(new Uint8ClampedArray([255, 255, 255, 255, 0, 0, 0, 255, 255, 0, 0, 0]))).toEqual(FALLBACK_PALETTE);
  });
  it('derives distinct restrained chromatic palettes from artwork', () => {
    const warm = paletteFromPixels(new Uint8ClampedArray([240, 80, 20, 255, 240, 80, 20, 255]));
    const cool = paletteFromPixels(new Uint8ClampedArray([20, 70, 240, 255, 20, 70, 240, 255]));
    expect(warm.primary).not.toBe(cool.primary);
    expect(warm.primary).toBe('rgb(116, 39, 10)');
    expect(cool.primary).toBe('rgb(10, 34, 116)');
  });
});
