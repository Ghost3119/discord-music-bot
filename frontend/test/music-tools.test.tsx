// @vitest-environment jsdom
import { StrictMode, act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { beforeEach, afterEach, expect, it, vi } from 'vitest';
import { MusicTools } from '../src/components/player/MusicTools';
import { Artwork } from '../src/components/artwork';
import { ImmersiveArtwork } from '../src/features/immersive/ImmersiveArtwork';
import { unavailableYouTubeImage } from '../src/lib/artwork';
import { useSonoraApp } from '../src/hooks/use-sonora-app';
import { api } from '../src/lib/api';
import { snapshot, session, track } from './regression-fixtures';

const mocks=vi.hoisted(()=>({auth:{} as Record<string,unknown>,playback:{} as Record<string,unknown>,reportError:vi.fn(),refresh:vi.fn()}));
vi.mock('../src/features/auth/use-session',()=>({useSession:()=>mocks.auth}));
vi.mock('../src/hooks/use-playback',()=>({usePlayback:()=>mocks.playback}));
vi.mock('../src/features/library/use-library',()=>({useLibrary:()=>({})}));
vi.mock('../src/lib/api',async original=>({...await original<typeof import('../src/lib/api')>(),api:vi.fn()}));
let roots:Root[],requests:Array<{path:string;options:RequestInit;resolve:(value:unknown)=>void;reject:(error:unknown)=>void}>;
beforeEach(()=>{
  (globalThis as typeof globalThis & {IS_REACT_ACT_ENVIRONMENT:boolean}).IS_REACT_ACT_ENVIRONMENT=true;
  roots=[];requests=[];vi.clearAllMocks();
  mocks.auth={session,guildId:'guild-a',setGuildId:vi.fn(),reportError:mocks.reportError,guilds:[]};
  mocks.playback={state:snapshot({autoplay:false}),connection:'live',refresh:mocks.refresh.mockResolvedValue(undefined)};
  vi.mocked(api).mockImplementation((path,options={})=>new Promise((resolve,reject)=>{
    requests.push({path,options,resolve,reject});
    options.signal?.addEventListener('abort',()=>reject(new DOMException('Cancelled','AbortError')),{once:true});
  }) as ReturnType<typeof api>);
});
afterEach(async()=>{await act(async()=>roots.forEach(root=>root.unmount()));document.body.innerHTML='';});
async function mount(){
  let app!:ReturnType<typeof useSonoraApp>;
  function Harness(){app=useSonoraApp();return <><MusicTools playback={{...app,onSaveTrack:()=>{}}} /><output>{app.notice}</output></>;}
  const container=document.createElement('div');document.body.append(container);const root=createRoot(container);roots.push(root);
  const render=()=>root.render(<StrictMode><Harness /></StrictMode>);await act(async()=>render());
  return {container,get app(){return app;},async render(){await act(async()=>render());}};
}
it('Radio follows authoritative snapshots and sends a desired state without optimistic toggling',async()=>{
  const view=await mount();const radio=view.container.querySelector('button')!;
  expect(radio.getAttribute('aria-pressed')).toBe('false');
  await act(async()=>radio.click());expect(JSON.parse(requests[0].options.body as string)).toEqual({action:'autoplay',enabled:true});
  expect(radio.disabled).toBe(true);expect(radio.getAttribute('aria-pressed')).toBe('false');
  await act(async()=>requests[0].resolve({autoplay:true}));expect(view.container.textContent).toContain('Radio activada.');
  mocks.playback.state=snapshot({autoplay:true});await view.render();expect(radio.getAttribute('aria-pressed')).toBe('true');
});
it('Recommend is direct, reports no results, and blocks same-turn duplicate actions',async()=>{
  const view=await mount();expect(view.container.querySelector('form')).toBeNull();
  await act(async()=>{void view.app.action({action:'recommend'});void view.app.action({action:'recommend'});});
  expect(requests).toHaveLength(1);expect(JSON.parse(requests[0].options.body as string)).toEqual({action:'recommend'});
  await act(async()=>requests[0].resolve({recommendationsAdded:0}));expect(view.container.textContent).toContain('No encontramos recomendaciones nuevas');
  await act(async()=>{void view.app.action({action:'recommend'});});
  await act(async()=>requests[1].resolve({recommendationsAdded:3}));expect(view.container.textContent).toContain('Añadidas 3 recomendaciones');
});
it('guild changes abort the HTTP mutation and discard its late notices and failures',async()=>{
  const view=await mount();await act(async()=>{void view.app.action({action:'recommend'});});
  mocks.auth.guildId='guild-b';mocks.playback.state=snapshot({guildId:'guild-b',autoplay:false});await view.render();
  expect(requests[0].options.signal?.aborted).toBe(true);expect(mocks.reportError).not.toHaveBeenCalled();
  await act(async()=>requests[0].resolve({recommendationsAdded:10}));expect(view.app.notice).toBe('');expect(view.app.busy).toBe('');
});
it('controls expose missing permissions and remain disabled without playback or radio state',async()=>{
  const view=await mount();mocks.playback.state=snapshot({current:null,autoplay:false});await view.render();
  expect([...view.container.querySelectorAll('button')].every(button=>button.disabled)).toBe(true);
  mocks.playback.state=snapshot({permissions:{canControl:false} as never});await view.render();
  expect(view.container.textContent).toContain('Únete al canal de voz');expect(view.container.querySelector('button')!.disabled).toBe(true);
  mocks.playback.state=snapshot();await view.render();expect(view.container.querySelector('button')!.disabled).toBe(true);
});
it('errors are forwarded and the action can be retried after failure',async()=>{
  const view=await mount();await act(async()=>{void view.app.action({action:'recommend'});});
  await act(async()=>requests[0].reject(new Error('Service unavailable')));expect(mocks.reportError).toHaveBeenCalledOnce();
  expect(view.app.busy).toBe('');await act(async()=>{void view.app.action({action:'recommend'});});expect(requests).toHaveLength(2);
  await act(async()=>requests[1].resolve({recommendationsAdded:1}));
});
it('unavailable images fall back once and late errors cannot replace the next track cover',async()=>{
  const container=document.createElement('div');document.body.append(container);const root=createRoot(container);roots.push(root);
  const a=track('AAAAAAAAAAA',{thumbnail:'https://i.ytimg.com/vi/AAAAAAAAAAA/hqdefault.jpg'}),b=track('BBBBBBBBBBB',{thumbnail:'https://i.ytimg.com/vi/BBBBBBBBBBB/hqdefault.jpg'});
  await act(async()=>root.render(<Artwork track={a}/>));const previous=container.querySelector('img')!;
  await act(async()=>root.render(<Artwork track={b}/>));
  await act(async()=>previous.dispatchEvent(new Event('error')));expect(container.querySelector('img')!.src).toBe(b.thumbnail);
  await act(async()=>container.querySelector('img')!.dispatchEvent(new Event('error')));expect(container.querySelector('img')).toBeNull();
  await act(async()=>root.render(<Artwork track={b}/>));expect(container.querySelector('img')).toBeNull();
  await act(async()=>root.render(<Artwork track={track('missing')}/>));expect(container.querySelector('.artwork-fallback')).not.toBeNull();
});
it('YouTube missing-image JPEGs cannot masquerade as a high-resolution cover',async()=>{
  const container=document.createElement('div');document.body.append(container);const root=createRoot(container);roots.push(root);
  const missing=track('AAAAAAAAAAA',{thumbnail:'https://i.ytimg.com/vi/AAAAAAAAAAA/hqdefault.jpg'});
  await act(async()=>root.render(<><Artwork track={missing}/><ImmersiveArtwork track={missing}/></>));
  const images=[...container.querySelectorAll('img')];
  for(const image of images){Object.defineProperty(image,'naturalWidth',{value:120});Object.defineProperty(image,'naturalHeight',{value:90});}
  await act(async()=>images.forEach(image=>image.dispatchEvent(new Event('load'))));
  expect(container.querySelector('img')).toBeNull();expect(container.querySelector('.artwork-fallback')).not.toBeNull();expect(container.querySelector('.immersive-cover-fallback')).not.toBeNull();
});
it('keeps genuine high-quality images and intentional default-size thumbnails',()=>{
  const image=document.createElement('img');image.src='https://i.ytimg.com/vi/AAAAAAAAAAA/hqdefault.jpg';
  Object.defineProperty(image,'naturalWidth',{value:480,configurable:true});Object.defineProperty(image,'naturalHeight',{value:360,configurable:true});
  expect(unavailableYouTubeImage(image)).toBe(false);
  Object.defineProperty(image,'naturalWidth',{value:120});Object.defineProperty(image,'naturalHeight',{value:90});
  image.src='https://i.ytimg.com/vi/AAAAAAAAAAA/default.jpg';expect(unavailableYouTubeImage(image)).toBe(false);
  image.src='https://other.example/hqdefault.jpg';expect(unavailableYouTubeImage(image)).toBe(false);
});
