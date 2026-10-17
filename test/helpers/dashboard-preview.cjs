// Explicit QA fixture: simulated snapshots/ORIGINAL test lyrics, no Discord or LRCLIB network.
// npm run build; node test/helpers/dashboard-preview.cjs
// Optional isolated ports: SONORA_QA_PORT=4176 (login/scenarios use port+1).
const path = require('node:path');
const { randomUUID } = require('node:crypto');
const { createWebServer } = require('../../dist/web/server');
const { openWebDatabase } = require('../../dist/web/database');
const port = Number(process.env.SONORA_QA_PORT || 4174);
if (!Number.isInteger(port) || port < 1024 || port > 65534) throw new Error('Invalid QA port');
const userId = '100000000000000001', guildId = '100000000000000002';
const database = openWebDatabase(':memory:');
const art = (warm = false) => 'data:image/svg+xml,' + encodeURIComponent(
  '<svg xmlns="http://www.w3.org/2000/svg" width="600" height="600" viewBox="0 0 600 600"><defs><linearGradient id="g" x2="1" y2="1"><stop stop-color="' + (warm ? '#913e58' : '#315373') + '"/><stop offset="1" stop-color="' + (warm ? '#1d2445' : '#172e37') + '"/></linearGradient></defs><path fill="url(#g)" d="M0 0h600v600H0z"/><circle cx="390" cy="190" r="110" fill="' + (warm ? '#edb77c' : '#b4d8c5') + '"/><path fill="' + (warm ? '#522b53' : '#377d80') + '" d="M0 480 240 170 600 600H0z"/><path fill="#111f34" d="m120 600 300-320 180 320z"/><text x="36" y="55" fill="#f5f3e8" font-family="sans-serif" font-size="16" letter-spacing="5">SONORA SESSIONS</text></svg>');
const song = (id,title,artist,duration,thumbnail = null) => ({id,title,artist,duration,url:'https://www.youtube.com/watch?v='+id,thumbnail,source:'youtube'});
const original = ['La tarde dibuja caminos','Y el ruido se queda detrás','Guardamos un poco de cielo','Para volver a empezar','Las luces encuentran su sitio','La noche nos deja escuchar','Un pulso recorre la sala','Y todo comienza a girar'];
const source = {name:'LRCLIB',url:'https://lrclib.net',recordId:1};
const snapshot = { guildId,status:'playing',current:null,queue:[],currentTime:18,volume:65,repeat:0,autoplay:false,voice:{id:'100000000000000003',name:'Lounge',members:4},health:{connected:true,ping:42,voiceConnected:true,mode:'playing',attempts:0,recentFailures:0,monitor:true,breaker:true},incidents:[],playbackId:randomUUID(),sequence:0,snapshotEpoch:randomUUID(),sampledAt:Date.now() };
let scenario = 'synced', anchoredAt = Date.now(), providerQueries = 0, eventConnections = 0, totalEventConnections = 0, controls = 0;
const names = ['synced','plain','instrumental','not-found','ambiguous','no-artwork','broken-artwork','paused','warm','provider-error','idle','member','long','album-artwork','radio-on','recommend-empty','recommend-error','radio-error'];
function advance() {
  const now = Date.now();
  if(snapshot.status==='playing' && snapshot.current) snapshot.currentTime = Math.min(snapshot.current.duration,snapshot.currentTime+(now-anchoredAt)/1000);
  anchoredAt = now;
}
function select(name) {
  if(!names.includes(name)) return;
  scenario = name;
  snapshot.playbackId = randomUUID();
  snapshot.currentTime = 18;
  snapshot.status = name==='idle' ? 'idle' : name==='paused' ? 'paused' : 'playing';
  snapshot.autoplay = name==='radio-on';
  snapshot.current = name==='idle' ? null : song('AAAAAAAAAAA',name==='warm'?'Después de la lluvia':'Caminos de luz', 'SONORA Sessions · prueba original',240,name==='no-artwork'?null:name==='broken-artwork'?'https://i.ytimg.com/vi/AAAAAAAAAAA/hqdefault.jpg':art(name==='warm'));
  snapshot.queue = [song('BBBBBBBBBBB','Después de la lluvia','SONORA Sessions',200,art(true)),song('CCCCCCCCCCC','Sin prisa','SONORA Sessions',240,art())];
  snapshot.permissions={role:name==='member'?'member':'admin',isMember:true,inVoiceChannel:name!=='member',canControl:name!=='member',isAdmin:name!=='member',canRead:true,canManageLibrary:true,canViewDiagnostics:name!=='member',canManageConfig:name!=='member'};
  anchoredAt = Date.now();
}
select('synced');
const bridge = {
  async assertGuildAccess(user,guild) { if(user!==userId || guild!==guildId) throw Object.assign(new Error('Forbidden'),{statusCode:403}); },
  async listGuilds(){return[{id:guildId,name:'The Listening Room',icon:null}];},
  async getState(){advance();snapshot.sampledAt=Date.now();snapshot.sequence++;return structuredClone(snapshot);},
  async control(_user,_guild,action){
    if(!snapshot.permissions.canControl)throw Object.assign(new Error('Join voice'),{errorCode:'CONTROL_CHANNEL_REQUIRED'});
    advance();controls++;
    switch(action.action){
      case'autoplay':if(scenario==='radio-error')throw new Error('Simulated radio failure');snapshot.autoplay=action.enabled;return{autoplay:snapshot.autoplay};
      case'recommend':
        if(scenario==='recommend-error')throw Object.assign(new Error('Simulated extractor failure'),{errorCode:'RECOMMEND_UNAVAILABLE'});
        if(scenario==='recommend-empty')return{recommendationsAdded:0};
        snapshot.queue.push(song('DDDDDDDDDDD','La siguiente estación','SONORA Sessions',220,art(true)),song('EEEEEEEEEEE','Otra luz','SONORA Sessions',190,art(false)));
        return{recommendationsAdded:2};
      case'pause':snapshot.status='paused';break;
      case'resume':snapshot.status='playing';break;
      case'skip':snapshot.current=snapshot.queue.shift()??null;snapshot.currentTime=0;snapshot.playbackId=randomUUID();scenario='warm';if(!snapshot.current)snapshot.status='idle';break;
      case'stop':snapshot.current=null;snapshot.queue=[];snapshot.status='idle';snapshot.playbackId=null;break;
      case'volume':snapshot.volume=action.volume;break;
      case'repeat':snapshot.repeat=action.mode;break;
      case'remove':snapshot.queue.splice(action.index-1,1);break;
      case'move':snapshot.queue.splice(action.to-1,0,snapshot.queue.splice(action.from-1,1)[0]);break;
      case'shuffle':snapshot.queue.reverse();break;
      case'play':snapshot.queue.push(song('DDDDDDDDDDD',action.query,'Vista de prueba',240));break;
    }
  },
};
const lyricsService = {
  async findLyrics(){
    providerQueries++;
    if(scenario==='plain')return{status:'plain',plainLyrics:original.join('\n\n'),source};
    if(scenario==='instrumental')return{status:'instrumental',source};
    if(scenario==='not-found')return{status:'not_found'};
    if(scenario==='ambiguous')return{status:'ambiguous'};
    if(scenario==='provider-error')return{status:'temporary_error',retryAfterMs:1500};
    const text=scenario==='long'?Array.from({length:1200},(_,i)=>original[i%original.length]+' '+(i+1)):original;
    return{status:'synced',lines:text.map((text,i)=>({timeMs:i*6000,text})),source};
  },
  async searchLyrics(query){
    providerQueries++;
    return {status:'results',candidates:[
      {id:1,title:query.title,artist:query.artist,album:'SONORA Sessions',duration:240,synced:true,plain:true,instrumental:false},
      {id:2,title:query.title,artist:query.artist,album:'Sesión acústica',duration:240,synced:false,plain:true,instrumental:false},
      {id:3,title:query.title+' (Live)',artist:query.artist,album:'En concierto',duration:300,synced:true,plain:true,instrumental:false,warning:'Esta versión puede estar desincronizada con la canción actual.'},
    ]};
  },
  async selectLyrics(id){
    providerQueries++;
    return id===2?{status:'plain',plainLyrics:original.join('\n\n'),source:{...source,recordId:id}}:{status:'synced',lines:original.map((text,i)=>({timeMs:i*6000,text})),source:{...source,recordId:id}};
  },close(){},
};
(async()=>{
  const origin='http://127.0.0.1:'+port;
  const config={enabled:true,host:'127.0.0.1',port,origin,oauthClientId:userId,oauthClientSecret:'qa-fixture-not-a-credential',oauthRedirectUri:origin+'/auth/discord/callback',allowedUserIds:[userId],databasePath:':memory:',sessionTtlMs:3600000,secureCookies:false,staticRoot:path.resolve(__dirname,'../../frontend/dist')};
  const app=await createWebServer({config,bridge,database,lyricsService});
  app.server.on('request',(request,response)=>{
    if(request.url?.endsWith('/events')){eventConnections++;totalEventConnections++;response.once('close',()=>eventConnections--);}
  });
  const session=database.createSession({id:userId,username:'Alex · vista de prueba',avatar:null},Date.now(),3600000);
  const playlist=database.createPlaylist(userId,guildId,'Noches sin prisa',Date.now());
  for(const item of[snapshot.current,...snapshot.queue]){const{id:_id,...metadata}=item;database.addPlaylistTrack(userId,guildId,playlist.id,metadata);}
  const{id:_favoriteId,thumbnail:_thumbnail,...favorite}=snapshot.queue[1];
  database.addFavorite(userId,guildId,{...favorite,thumbnail:_thumbnail},Date.now());
  const login=require('node:http').createServer((request,response)=>{
    const route=new URL(request.url,'http://127.0.0.1').pathname;
    if(route==='/metrics'){response.writeHead(200,{'Content-Type':'application/json'});response.end(JSON.stringify({scenario,eventConnections,totalEventConnections,providerQueries,controls}));return;}
    if(route==='/scenarios'){response.writeHead(200,{'Content-Type':'text/html; charset=utf-8'});response.end('<h1>SONORA QA: snapshots y letras originales simuladas</h1>'+names.map(name=>'<p><a href="/scenario/'+name+'">'+name+'</a></p>').join(''));return;}
    if(route.startsWith('/scenario/'))select(route.split('/').pop());
    response.writeHead(302,{'Set-Cookie':'music_session='+session.token+'; Path=/; HttpOnly; SameSite=Lax',Location:origin});response.end();
  });
  await app.listen({host:config.host,port});
  login.listen(port+1,'127.0.0.1',()=>console.log('QA fixture: http://127.0.0.1:'+(port+1)+'/scenarios (simulated music and ORIGINAL test lyrics, in-memory SQLite)'));
  const close=async()=>{login.close();await app.close();database.close();};
  process.once('SIGINT',()=>{void close();});process.once('SIGTERM',()=>{void close();});
})().catch(error=>{console.error(error);database.close();process.exitCode=1;});
