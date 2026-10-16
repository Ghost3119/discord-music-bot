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
  const session = db.createSession({ id: USER, username: 'QA', avatar: null }, Date.now(),60000);
  const app = await createWebServer({ config,database:db,
    bridge: { async listGuilds(){return[{id:GUILD,name:'QA',icon:null}];}, async assertGuildAccess(){ if(!data.allowed) throw Object.assign(new Error('Denied'),{statusCode:403}); }, async getState(){return structuredClone(data.state);}, async control(){data.controls++;} },
    lyricsService:{ async findLyrics(query,signal){ data.queries.push(query); return overrides.find ? overrides.find(query,signal) : {status:'synced',lines:[{timeMs:0,text:'Original test line'}],source:{name:'LRCLIB',url:'https://lrclib.net',recordId:1}};}, close(){} }
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
  assert.deepEqual(h.data.queries,[{title:track.title,artist:track.artist,duration:120}]);
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
