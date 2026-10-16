const test = require('node:test');
const assert = require('node:assert/strict');
const { createWebServer } = require('../dist/web/server');
const { openWebDatabase } = require('../dist/web/database');
const USER='111111111111111111', GUILD='333333333333333333';
const ORIGIN='http://127.0.0.1:8080';
const pause=ms=>new Promise(resolve=>setTimeout(resolve,ms));
async function fixture(t, control, timeout) {
  const database=openWebDatabase(':memory:');
  const session=database.createSession({id:USER,username:'Test',avatar:null},Date.now(),60000);
  const playlist=database.createPlaylist(USER,GUILD,'Slow playlist',Date.now());
  for(let i=0;i<3;i++)database.addPlaylistTrack(USER,GUILD,playlist.id,{url:'https://www.youtube.com/watch?v=AAAAAAAAAA'+i,title:'Original test '+i,artist:'Test',duration:120,source:'youtube',thumbnail:null});
  const calls=[];
  const app=await createWebServer({
    config:{enabled:true,host:'127.0.0.1',port:8080,origin:ORIGIN,oauthClientId:USER,oauthClientSecret:'test-only',oauthRedirectUri:ORIGIN+'/auth/discord/callback',allowedUserIds:[USER],databasePath:':memory:',sessionTtlMs:60000,secureCookies:false},
    database,
    ...(timeout===undefined?{}:{musicOperationTimeoutMs:timeout}),
    bridge:{async assertGuildAccess(){},async listGuilds(){return[];},async getState(){return{guildId:GUILD,status:'idle',current:null,queue:[],currentTime:0,volume:50,repeat:0,voice:null,health:{},incidents:[]};},async control(_u,_g,action,signal){calls.push({action,signal});await control(signal);}},
  });
  t.after(async()=>{await app.close();database.close();});
  const url='/api/guilds/'+GUILD+'/playlists/'+playlist.id+'/load';
  const headers={cookie:'music_session='+session.token,origin:ORIGIN,'x-csrf-token':require('../dist/web/database').csrfTokenFor(session.token)};
  return{app,calls,url,headers};
}
test('authenticated slow playlist loading survives the server idle timeout on a real HTTP socket',async t=>{
  const h=await fixture(t,()=>pause(60));
  await h.app.listen({host:'127.0.0.1',port:0});
  h.app.server.setTimeout(20);
  const response=await fetch('http://127.0.0.1:'+h.app.server.address().port+h.url,{method:'POST',headers:h.headers,signal:AbortSignal.timeout(2000)});
  assert.equal(response.status,200);
  assert.equal((await response.json()).loaded,3);
  assert.equal(h.calls.length,3);
});
test('playlist operation deadline returns structured 504, cancels work and never starts another track',async t=>{
  const h=await fixture(t,()=>pause(100),25);
  const response=await h.app.inject({method:'POST',url:h.url,headers:h.headers});
  assert.equal(response.statusCode,504,response.body);
  assert.match(response.json().error,/tiempo|tard/i);
  assert.equal(h.calls[0].signal.aborted,true);
  await pause(110);
  assert.equal(h.calls.length,1);
});
