// @vitest-environment jsdom
import { StrictMode, act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import App from '../src/App';
import { api, type GuildSummary, type PlaybackSnapshot } from '../src/lib/api';
import { playlist, session, snapshot, track } from './regression-fixtures';

vi.mock('../src/lib/api', async (original) => ({
  ...(await original<typeof import('../src/lib/api')>()),
  api: vi.fn(),
}));

class FakeEventSource {
  static instances: FakeEventSource[] = [];
  readonly url: string;
  onopen: ((event: Event) => void) | null = null;
  onerror: ((event: Event) => void) | null = null;
  closed = false;
  private listeners = new Map<string, Array<(event: MessageEvent) => void>>();

  constructor(url: string) {
    this.url = url;
    FakeEventSource.instances.push(this);
  }

  addEventListener(type: string, listener: (event: MessageEvent) => void) {
    const list = this.listeners.get(type) ?? [];
    list.push(listener);
    this.listeners.set(type, list);
  }

  emitState(state: PlaybackSnapshot) {
    for (const listener of this.listeners.get('state') ?? []) {
      listener({ data: JSON.stringify(state) } as MessageEvent);
    }
  }

  close() {
    this.closed = true;
  }
}

const GUILDS: GuildSummary[] = [
  { id: '111111111111111111', name: 'Servidor Alfa', icon: null },
  { id: '222222222222222222', name: 'Servidor Beta', icon: null },
];

describe('multi-server switching and SSE isolation in web panel', () => {
  let roots: Root[] = [];
  const originalEventSource = globalThis.EventSource;

  beforeEach(() => {
    (globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
    roots = [];
    FakeEventSource.instances = [];
    window.localStorage.clear();
    vi.clearAllMocks();
    globalThis.EventSource = FakeEventSource as unknown as typeof EventSource;
  });

  afterEach(async () => {
    await act(async () => {
      for (const root of roots) root.unmount();
    });
    document.body.innerHTML = '';
    globalThis.EventSource = originalEventSource;
  });

  async function mountApp() {
    const container = document.createElement('div');
    document.body.append(container);
    const root = createRoot(container);
    roots.push(root);
    await act(async () => {
      root.render(
        <StrictMode>
          <App />
        </StrictMode>,
      );
    });
    return container;
  }

  it('restores the last authorized guild per user, switches cleanly with a single SSE stream, and discards in-flight operations or late SSE snapshots from the previous guild', async () => {
    window.localStorage.setItem(`sonora:last-guild:${session.user.id}`, GUILDS[1]!.id);

    let resolvePlayOnBeta!: (value: unknown) => void;
    let playSignalOnBeta: AbortSignal | null | undefined;

    vi.mocked(api).mockImplementation((path, options = {}) => {
      if (path === '/api/session') return Promise.resolve(session) as ReturnType<typeof api>;
      if (path === '/api/guilds') return Promise.resolve({ guilds: GUILDS }) as ReturnType<typeof api>;
      if (path === `/api/guilds/${GUILDS[1]!.id}/state`) {
        return Promise.resolve(
          snapshot({
            guildId: GUILDS[1]!.id,
            current: track('beta-1', { title: 'Canción Beta' }),
          }),
        ) as ReturnType<typeof api>;
      }
      if (path === `/api/guilds/${GUILDS[0]!.id}/state`) {
        return Promise.resolve(
          snapshot({
            guildId: GUILDS[0]!.id,
            current: track('alfa-1', { title: 'Canción Alfa' }),
          }),
        ) as ReturnType<typeof api>;
      }
      if (path === `/api/guilds/${GUILDS[1]!.id}/playlists`) {
        return Promise.resolve({ playlists: [playlist({ id: 'pl-beta', name: 'Lista Beta' })] }) as ReturnType<
          typeof api
        >;
      }
      if (path === `/api/guilds/${GUILDS[0]!.id}/playlists`) {
        return Promise.resolve({ playlists: [playlist({ id: 'pl-alfa', name: 'Lista Alfa' })] }) as ReturnType<
          typeof api
        >;
      }
      if (path.endsWith('/favorites')) {
        return Promise.resolve({ favorites: [] }) as ReturnType<typeof api>;
      }
      if (path === `/api/guilds/${GUILDS[1]!.id}/actions` && options.method === 'POST') {
        playSignalOnBeta = options.signal;
        return new Promise((resolve, reject) => {
          resolvePlayOnBeta = resolve;
          options.signal?.addEventListener(
            'abort',
            () => reject(new DOMException('Aborted', 'AbortError')),
            { once: true },
          );
        }) as ReturnType<typeof api>;
      }
      return Promise.resolve({}) as ReturnType<typeof api>;
    });

    const container = await mountApp();
    await act(async () => {
      await Promise.resolve();
      await Promise.resolve();
    });

    // Restored Servidor Beta from localStorage and opened exactly one active EventSource
    const activeSourcesAfterMount = FakeEventSource.instances.filter((item) => !item.closed);
    expect(activeSourcesAfterMount).toHaveLength(1);
    expect(activeSourcesAfterMount[0]!.url).toBe(`/api/guilds/${GUILDS[1]!.id}/events`);
    expect(container.textContent).toContain('Canción Beta');
    expect(container.textContent).toContain('Lista Beta');
    const betaSource = activeSourcesAfterMount[0]!;

    // Start an in-flight enqueue mutation on Servidor Beta (sets busy = 'play')
    const input = container.querySelector('#music-search') as HTMLInputElement;
    const form = container.querySelector('form.search-bar') as HTMLFormElement;
    await act(async () => {
      const valueSetter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')!.set!;
      valueSetter.call(input, 'https://www.youtube.com/watch?v=dQw4w9WgXcQ');
      input.dispatchEvent(new Event('input', { bubbles: true }));
      input.dispatchEvent(new Event('change', { bubbles: true }));
    });
    await act(async () => {
      form.dispatchEvent(new Event('submit', { bubbles: true, cancelable: true }));
    });
    expect(playSignalOnBeta).toBeDefined();
    expect(playSignalOnBeta?.aborted).toBe(false);

    // Guild selector remains enabled even while Servidor Beta has an operation in flight
    const trigger = container.querySelector('#guild-select') as HTMLButtonElement;
    expect(trigger.disabled).toBe(false);

    // Switch to Servidor Alfa
    await act(async () => {
      trigger.click();
    });
    const alfaOption = [...document.querySelectorAll('[role="option"]')].find((el) =>
      el.textContent?.includes('Servidor Alfa'),
    ) as HTMLElement;
    expect(alfaOption).toBeDefined();
    await act(async () => {
      alfaOption.click();
    });
    await act(async () => {
      await Promise.resolve();
      await Promise.resolve();
    });

    // Previous SSE closed, previous mutation aborted, new single SSE opened for Servidor Alfa, localStorage updated
    expect(betaSource.closed).toBe(true);
    expect(playSignalOnBeta?.aborted).toBe(true);
    const activeSourcesAfterSwitch = FakeEventSource.instances.filter((item) => !item.closed);
    expect(activeSourcesAfterSwitch).toHaveLength(1);
    const alfaSource = activeSourcesAfterSwitch[0]!;
    expect(alfaSource.url).toBe(`/api/guilds/${GUILDS[0]!.id}/events`);
    expect(window.localStorage.getItem(`sonora:last-guild:${session.user.id}`)).toBe(GUILDS[0]!.id);
    expect(container.textContent).toContain('Canción Alfa');
    expect(container.textContent).toContain('Lista Alfa');
    expect(container.textContent).not.toContain('Lista Beta');

    // Late SSE snapshots from Servidor Beta (or a mismatched guildId on Alfa's stream) never contaminate Servidor Alfa
    await act(async () => {
      betaSource.emitState(
        snapshot({
          guildId: GUILDS[1]!.id,
          current: track('beta-late', { title: 'Fantasma Beta' }),
          sequence: 999,
        }),
      );
      alfaSource.emitState(
        snapshot({
          guildId: GUILDS[1]!.id,
          current: track('beta-cross', { title: 'Cruce Beta' }),
          sequence: 1000,
        }),
      );
      resolvePlayOnBeta?.({ ok: true });
    });

    expect(container.textContent).toContain('Canción Alfa');
    expect(container.textContent).not.toContain('Fantasma Beta');
    expect(container.textContent).not.toContain('Cruce Beta');
    expect(container.textContent).not.toContain('Canción enviada a la cola.');
  });
});
