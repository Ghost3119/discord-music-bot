// @vitest-environment jsdom
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { PlayerExperience } from '../src/components/player/PlayerExperience';
import { usePlayback } from '../src/hooks/use-playback';
import { api } from '../src/lib/api';
import type { StreamSource } from '../src/lib/playback-stream';
import { snapshot } from './regression-fixtures';

vi.mock('../src/lib/api', async original => ({
  ...(await original<typeof import('../src/lib/api')>()), api: vi.fn(),
}));
const onError = vi.fn();
let roots: Root[] = [], instances: FakeSource[] = [], requests: string[] = [], serial = 0, sequence = 0;
class FakeSource implements StreamSource {
  onopen: StreamSource['onopen'] = null;
  onerror: StreamSource['onerror'] = null;
  closed = false;
  listener?: (event: MessageEvent) => void;
  constructor(readonly url: string) { instances.push(this); }
  addEventListener(_type: string, listener: (event: MessageEvent) => void) { this.listener = listener; }
  close() { this.closed = true; }
}
function Harness({ guildId = 'guild-a', editorOpen = false }: { guildId?: string; editorOpen?: boolean }) {
  const { state, connection } = usePlayback(guildId, onError);
  return <PlayerExperience playback={{ state, busy: '', controlsDisabled: !state, volumeDraft: null, setVolumeDraft: vi.fn(), action: vi.fn(), isFavorite: () => false, toggleFavorite: vi.fn(), onSaveTrack: vi.fn() }} connection={connection} error="" editorOpen={editorOpen} onShowQueue={vi.fn()} />;
}
beforeEach(() => {
  roots = []; instances = []; requests = []; serial++; sequence = 0;
  (globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
  vi.stubGlobal('EventSource', FakeSource);
  vi.stubGlobal('matchMedia', vi.fn(() => ({ matches: true, addEventListener: vi.fn(), removeEventListener: vi.fn() })));
  vi.mocked(api).mockImplementation(async (path) => {
    requests.push(path);
    const guildId = path.split('/')[3];
    const playbackId = 'integration-' + serial + '-' + guildId;
    if (path.endsWith('/lyrics/current')) return { guildId, trackId: 'track-a', playbackId, status: 'plain', plainLyrics: 'Original integration lyric', source: { name: 'LRCLIB', url: 'https://lrclib.net', recordId: 1 } } as never;
    return { ...snapshot({ guildId }), playbackId, sequence: ++sequence, snapshotEpoch: 'test-epoch' } as never;
  });
});
afterEach(async () => {
  await act(async () => roots.forEach(root => root.unmount()));
  await new Promise(resolve => setTimeout(resolve, 5));
  document.body.innerHTML = '';
  vi.unstubAllGlobals();
});
async function mount() {
  const container = document.createElement('div'); document.body.append(container);
  const root = createRoot(container); roots.push(root);
  await act(async () => root.render(<Harness />));
  await act(async () => instances[0].onopen?.(new Event('open')));
  return { container, root };
}
async function click(label: string) {
  const button = document.querySelector<HTMLButtonElement>('button[aria-label="' + label + '"]');
  expect(button).not.toBeNull();
  await act(async () => button!.click());
}
describe('immersive integration preserves the existing transport', () => {
  it('repeated opening/closing retains one SSE and reuses lyrics without music actions', async () => {
    await mount();
    const stateRequests = requests.filter(path => path.endsWith('/state')).length;
    for (let i = 0; i < 3; i++) {
      await click('Abrir reproductor inmersivo');
      expect(document.querySelector('[role="dialog"]')).not.toBeNull();
      await click('Cerrar reproductor inmersivo');
      expect(document.querySelector('[role="dialog"]')).toBeNull();
    }
    expect(instances).toHaveLength(1);
    expect(instances[0].closed).toBe(false);
    expect(requests.filter(path => path.endsWith('/state'))).toHaveLength(stateRequests);
    expect(requests.filter(path => path.endsWith('/lyrics/current'))).toHaveLength(1);
    expect(requests.some(path => path.endsWith('/actions'))).toBe(false);
  });
  it('switching guild while open closes only the old transport and rejects old presentation', async () => {
    const { root } = await mount();
    await click('Abrir reproductor inmersivo');
    await act(async () => root.render(<Harness guildId="guild-b" />));
    expect(instances).toHaveLength(2);
    expect(instances[0].closed).toBe(true);
    expect(instances[1].closed).toBe(false);
    await click('Cerrar reproductor inmersivo');
    expect(instances[1].closed).toBe(false);
  });
  it('an existing library editor disables opening instead of nesting two dialogs', async () => {
    const { root } = await mount();
    await act(async () => root.render(<Harness editorOpen />));
    expect(document.querySelector<HTMLButtonElement>('button[aria-label="Abrir reproductor inmersivo"]')?.disabled).toBe(true);
    expect(instances).toHaveLength(1);
  });
});
