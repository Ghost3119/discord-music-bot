const test = require('node:test');
const assert = require('node:assert/strict');
const { createWebServer } = require('../dist/web/server');
const { openWebDatabase } = require('../dist/web/database');
const USER = '111111111111111111', GUILD = '333333333333333333';
const URL = '/api/guilds/' + GUILD + '/lyrics/current';
const track = { id: 'test', url: 'https://www.youtube.com/watch?v=AAAAAAAAAAA', title: 'Original test song', artist: 'Test artist', duration: 120, thumbnail: null, source: 'youtube' };
const deferred = () => { let resolve, reject; const promise = new Promise((a,b) => {resolve=a;reject=b;}); return {promise,resolve,reject}; };
async function setup(t, overrides = {}) {
  const db = openWebDatabase(':memory:');
  const data = { allowed: true, queries: [], controls: 0, state: { guildId: GUILD, playbackId: 'instance-A', status: 'playing', current: track, queue: [], currentTime: 4, volume: 50, repeat: 0, voice: null, health: {}, incidents: [] } };
  const config = { enabled:true, host:'127.0.0.1', port:8080, origin:'http://127.0.0.1:8080', oauthClientId:USER, oauthClientSecret:'qa-only-secret', oauthRedirectUri:'http://127.0.0.1:8080/auth/discord/callback', allowedUserIds:[USER], databasePath:':memory:', sessionTtlMs:60000, secureCookies:false, ...overrides.config };
  const session = db.createSession({ id: USER, username: 'QA', avatar: null }, Date.now(),overrides.sessionTtlMs ?? 60000);
  const app = await createWebServer({ config,database:db,now:overrides.now,
    bridge: { async listGuilds(){return[{id:GUILD,name:'QA',icon:null}];}, async assertGuildAccess(){ if(!data.allowed) throw Object.assign(new Error('Denied'),{statusCode:403}); }, async getState(){return structuredClone(data.state);}, async control(){data.controls++;} },
    lyricsService:{ async findLyrics(query,signal){ data.queries.push(query); return overrides.find ? overrides.find(query,signal) : {status:'synced',lines:[{timeMs:0,text:'Original test line'}],source:{name:'LRCLIB',url:'https://lrclib.net',recordId:1}};},
      async searchLyrics(query,signal){data.queries.push(query);return overrides.search ? overrides.search(query,signal) : {status:'results',candidates:[{id:1,title:track.title,artist:track.artist,album:'Test',duration:120,synced:true,plain:true,instrumental:false}]};},
      async selectLyrics(id,signal){data.queries.push({recordId:id});return overrides.select ? overrides.select(id,signal) : {status:'plain',plainLyrics:'Selected original line',source:{name:'LRCLIB',url:'https://lrclib.net',recordId:id}};}, close(){} }
  });
  t.after(async()=>{await app.close();db.close();});
  const get = (url=URL) => app.inject({url,headers:{cookie:'music_session='+session.token}});
  return {app,db,data,get,session};
}
test('lyrics requires session and current guild membership before querying provider',async t=>{
  const h=await setup(t);
  assert.equal((await h.app.inject(URL)).statusCode,401);
  h.data.allowed=false;
  assert.equal((await h.get()).statusCode,403);
  assert.equal(h.data.queries.length,0);
});

const manualUrl = (kind, extra = {}) => URL.replace('current',kind) + '?' + new URLSearchParams({trackId:track.id,playbackId:'instance-A',...(kind==='search'?{title:track.title,artist:track.artist}:{recordId:'1'}),...extra});
test('manual search requires auth, guild access and bounded structured parameters',async t=>{
  const h=await setup(t);
  assert.equal((await h.app.inject(manualUrl('search'))).statusCode,401);
  for(const extra of [{title:''},{title:'a'.repeat(201)},{artist:'\u0000bad'},{url:'http://127.0.0.1'}]){
    assert.equal((await h.get(manualUrl('search',extra))).statusCode,400);
  }
  h.data.allowed=false;
  assert.equal((await h.get(manualUrl('search'))).statusCode,403);
  assert.equal(h.data.queries.length,0);
});
test('manual search exposes metadata and selection only admits returned IDs for this playback/session',async t=>{
  const h=await setup(t);
  assert.equal((await h.get(manualUrl('selection'))).statusCode,409);
  const result=await h.get(manualUrl('search'));
  assert.equal(result.statusCode,200);assert.equal(result.json().status,'results');
  assert.equal(result.headers['cache-control'],'no-store');
  assert.equal((await h.get(manualUrl('selection',{recordId:'2'}))).statusCode,409);
  assert.equal((await h.get(manualUrl('selection',{recordId:'https://evil'}))).statusCode,400);
  const selected=await h.get(manualUrl('selection'));
  assert.equal(selected.json().status,'plain');assert.equal(selected.json().plainLyrics,'Selected original line');
  assert.equal(selected.json().playbackId,'instance-A');assert.equal(h.data.controls,0);
  const other=h.db.createSession({id:USER,username:'Other',avatar:null},Date.now(),60000);
  assert.equal((await h.app.inject({url:manualUrl('selection'),headers:{cookie:'music_session='+other.token}})).statusCode,409);
});
for(const kind of ['search','selection']){
  test('manual '+kind+' rejects stale identity before provider and discards a late response after repeat',async t=>{
    const waiting=deferred(),started=deferred();
    const h=await setup(t,{[kind==='selection'?'select':kind]:()=>{started.resolve();return waiting.promise;}});
    if(kind==='selection')await h.get(manualUrl('search'));
    const stale=await h.get(manualUrl(kind,{playbackId:'old'}));
    assert.equal(stale.json().status,'stale');
    const request=h.get(manualUrl(kind));await started.promise;
    h.data.state.playbackId='instance-repeat';
    waiting.resolve(kind==='search'?{status:'results',candidates:[]}:{status:'plain',plainLyrics:'Old private text',source:{name:'LRCLIB',url:'https://lrclib.net',recordId:1}});
    const result=await request;
    assert.equal(result.json().status,'stale');assert.doesNotMatch(result.body,/Old private text/);
  });
  for(const revoked of ['membership','session'])test('manual '+kind+' revalidates '+revoked+' after provider wait',async t=>{
    const waiting=deferred(),started=deferred();
    const h=await setup(t,{[kind==='selection'?'select':kind]:()=>{started.resolve();return waiting.promise;}});
    if(kind==='selection')await h.get(manualUrl('search'));
    const request=h.get(manualUrl(kind));await started.promise;
    if(revoked==='membership')h.data.allowed=false;else h.db.deleteSession(h.session.token);
    waiting.resolve(kind==='search'?{status:'results',candidates:[]}:{status:'plain',plainLyrics:'Old private text',source:{name:'LRCLIB',url:'https://lrclib.net',recordId:1}});
    const result=await request;assert.equal(result.statusCode,revoked==='membership'?403:401);assert.doesNotMatch(result.body,/Old private text/);
  });
}
test('manual search rate limit stops requests before reaching the provider',async t=>{
  const h=await setup(t);let result;
  for(let i=0;i<21;i++)result=await h.get(manualUrl('search'));
  assert.equal(result.statusCode,429);assert.equal(h.data.queries.length,20);
});
test('manual choices expire and remain isolated between guilds with identical playback IDs',async t=>{
  let clock=Date.now();const h=await setup(t,{now:()=>clock,sessionTtlMs:600000});
  await h.get(manualUrl('search'));
  assert.equal((await h.get(manualUrl('selection').replace(GUILD,'444444444444444444'))).statusCode,409);
  clock+=120001;
  assert.equal((await h.get(manualUrl('selection'))).statusCode,409);
  assert.equal(h.data.queries.length,1);
});
test('manual warnings compare edited search results with the actual playing version',async t=>{
  const h=await setup(t);h.data.state.current={...track,title:track.title+' (Live)'};
  const result=await h.get(manualUrl('search',{title:track.title}));
  assert.equal(result.json().status,'results');
  assert.match(result.json().candidates[0].warning,/desincronizadas/);
});
test('member read access respects guild_members mode and server allowlist',async t=>{
  const h=await setup(t,{config:{accessMode:'guild_members',allowedUserIds:[],allowedGuildIds:[GUILD],adminUserIds:[]}});
  const r=await h.get();
  assert.equal(r.statusCode,200);
  assert.equal(r.json().status,'synced');
  const other=await h.get(URL.replace(GUILD,'444444444444444444'));
  assert.equal(other.statusCode,403);
  assert.equal(h.data.controls,0);
});
test('lyrics uses authoritative metadata only and returns typed instance identity with no-store',async t=>{
  const h=await setup(t);
  const r=await h.get(URL+'?trackId=evil&url=http://127.0.0.1/private&title=forged');
  assert.equal(r.statusCode,200);
  assert.deepEqual(h.data.queries,[{title:track.title,artist:track.artist,duration:120,durationReliable:false}]);
  assert.equal(r.json().playbackId,'instance-A');
  assert.equal(r.json().trackId,'test');
  assert.equal(r.headers['cache-control'],'no-store');
  assert.equal(h.data.controls,0);
  assert.doesNotMatch(r.body,/qa-only-secret|127.0.0.1\/private/);
});
test('lyrics idle and missing playback identity never query provider',async t=>{
  const h=await setup(t);
  h.data.state.current=null;h.data.state.status='idle';
  assert.equal((await h.get()).json().status,'idle');
  h.data.state.current=track;h.data.state.status='playing';delete h.data.state.playbackId;
  assert.equal((await h.get()).json().status,'stale');
  assert.equal(h.data.queries.length,0);
});
test('song changed during lyrics request discards text even if same track title or repeated recording',async t=>{
  const waiting=deferred(),started=deferred();
  const h=await setup(t,{find:()=>{started.resolve();return waiting.promise;}});
  const request=h.get(); await started.promise;
  h.data.state.playbackId='instance-B';
  waiting.resolve({status:'plain',plainLyrics:'Old original test text',source:{name:'LRCLIB',url:'https://lrclib.net',recordId:1}});
  const r=await request;
  assert.deepEqual(r.json(),{guildId:GUILD,trackId:'test',playbackId:'instance-B',status:'stale'});
});
for(const revoke of ['membership','session']) test('lyrics revalidates '+revoke+' after upstream request',async t=>{
  const waiting=deferred(),started=deferred();
  const h=await setup(t,{find:()=>{started.resolve();return waiting.promise;}});
  const request=h.get(); await started.promise;
  if(revoke==='membership')h.data.allowed=false;
  else h.db.deleteSession(h.session.token);
  waiting.resolve({status:'plain',plainLyrics:'Must stay private',source:{name:'LRCLIB',url:'https://lrclib.net',recordId:1}});
  const r=await request;
  assert.equal(r.statusCode,revoke==='membership'?403:401,r.body);
  assert.doesNotMatch(r.body,/Must stay private/);
});
test('temporary provider errors remain typed and do not perform music actions',async t=>{
  const h=await setup(t,{find:async()=>({status:'temporary_error',retryAfterMs:2000})});
  const r=await h.get();
  assert.equal(r.json().status,'temporary_error');
  assert.equal(r.json().retryAfterMs,2000);
  assert.equal(h.data.controls,0);
});
