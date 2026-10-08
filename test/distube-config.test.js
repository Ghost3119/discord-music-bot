const assert=require('node:assert/strict');
const test=require('node:test');
const fs=require('node:fs');
const os=require('node:os');
const path=require('node:path');
const {createServer}=require('node:http');
const {spawn}=require('node:child_process');
const {once}=require('node:events');
const {Client,GatewayIntentBits}=require('discord.js');
const ffmpeg=require('ffmpeg-static');
const {createDisTube}=require('../dist/music/distube');
const {registerDisTubeEvents}=require('../dist/music/events');
const {registerEmptyVoice}=require('../dist/music/emptyVoice');
const {QueueRecovery}=require('../dist/music/queueRecovery');
const {classifyMusicError}=require('../dist/music/errors');

test('production observers fit a finite listener budget without accumulating at startup',async t=>{
  const directory=fs.mkdtempSync(path.join(os.tmpdir(),'music-listeners-test-'));
  t.after(()=>{assert.ok(path.resolve(directory).startsWith(path.resolve(os.tmpdir())+path.sep));fs.rmSync(directory,{recursive:true,force:true});});
  const client=new Client({intents:[GatewayIntentBits.Guilds,GatewayIntentBits.GuildVoiceStates]});
  t.after(()=>client.destroy());
  const distube=createDisTube(client);
  const stopEvents=registerDisTubeEvents(distube);t.after(stopEvents);
  const stopEmpty=registerEmptyVoice(client,distube);t.after(stopEmpty);
  const recovery=new QueueRecovery(client,distube,path.join(directory,'queues.json'));t.after(()=>recovery.stop());
  assert.equal(distube.getMaxListeners(),10);
  assert.equal(distube.listenerCount('initQueue'),2);
  assert.equal(distube.listenerCount('playSong'),2);
  assert.equal(distube.listenerCount('addSong'),2);
  assert.equal(distube.listenerCount('addList'),2);
  assert.equal(distube.listenerCount('deleteQueue'),3);
  for(const event of distube.eventNames())assert.ok(distube.listenerCount(event)<=distube.getMaxListeners());
});

test('the installed FFmpeg returns the decoded HTTP 403 exit tag for a real rejected request',async t=>{
  const server=createServer((_request,response)=>{response.writeHead(403);response.end('Forbidden');});
  server.listen(0,'127.0.0.1');await once(server,'listening');
  t.after(()=>{server.closeAllConnections();server.close();});
  const child=spawn(ffmpeg,['-hide_banner','-loglevel','error','-i',`http://127.0.0.1:${server.address().port}/audio`,'-f','null','-'],{windowsHide:true,stdio:['ignore','ignore','pipe']});
  t.after(()=>{if(child.exitCode===null)child.kill();});
  const timer=setTimeout(()=>child.kill(),5000);t.after(()=>clearTimeout(timer));
  let stderr='';child.stderr.on('data',chunk=>{stderr+=chunk;});
  const [code]=await once(child,'close');
  assert.match(stderr,/403 Forbidden/);
  if(process.platform==='win32')assert.equal(classifyMusicError({errorCode:'FFMPEG_EXITED',message:`ffmpeg exited with code ${code}`}), 'SOURCE_BLOCKED');
  else assert.notEqual(code,0);
});
