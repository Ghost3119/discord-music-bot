const assert = require('node:assert/strict');
const { EventEmitter } = require('node:events');
const test = require('node:test');
const { MessageFlags } = require('discord.js');
const { Song } = require('distube');
const { PlayerPanels } = require('../dist/music/playerPanel');
const { createNowPlayingEmbed, createProgressBar, createQueueEmbed, createQueueButtons } = require('../dist/utils/embed');
const { handleButton } = require('../dist/events/buttonHandler');
const { handleInteraction } = require('../dist/events/interactionCreate');
const { nowplaying } = require('../dist/commands/nowplaying');
const { queue: queueCommand } = require('../dist/commands/queue');

const tick = () => new Promise(resolve => setImmediate(resolve));
const snapshot = payload => JSON.parse(JSON.stringify(payload));
function song(name = 'Que Te Vas') {
  return new Song({ plugin: null, source: 'youtube', playFromSource: true, id: name, name, duration: 206,
    url: 'https://www.youtube.com/watch?v=AAAAAAAAAAA', thumbnail: 'https://i.ytimg.com/vi/AAAAAAAAAAA/hqdefault.jpg' });
}
function fixture(t, interval = 0) {
  const sends = [], edits = [], messages = [];
  let editFailure;
  let sendHook = async () => {};
  const queue = { id: 'guild-1', songs: [song(), song('Mente Positiva')], currentTime: 78,
    paused: false, volume: 80, autoplay: false, repeatMode: 0, stopped: false, voiceChannel: { id: 'voice-1' },
    textChannel: { id: 'text-1', send: async payload => {
      sends.push(snapshot(payload)); await sendHook();
      const message = { id: `message-${messages.length + 1}`, url: `https://discord.com/channels/guild-1/text-1/${messages.length + 1}`,
        edit: async payload => { edits.push({ id: message.id, payload: snapshot(payload) }); if (editFailure) throw editFailure; return message; } };
      messages.push(message); return message;
    } },
    pause: async () => { queue.paused = true; }, resume: async () => { queue.paused = false; },
  };
  const distube = new EventEmitter(); distube.getQueue = () => queue;
  const panels = new PlayerPanels(distube, interval);
  t.after(() => panels.dispose());
  return { queue, distube, panels, sends, edits, messages, setEditFailure: value => { editFailure = value; }, setSendHook: value => { sendHook = value; } };
}
function interaction(f, customId = 'btn_pause_resume', message = f.messages[0]) {
  const replies=[], deferred=[], edits=[];
  const value={ guild: { id:'guild-1', members: { cache:new Map([['user-1',{voice:{channel:{id:'voice-1'}}}]]) } },
    guildId:'guild-1', client:{distube:f.distube}, user:{id:'user-1'}, member:{voice:{}}, message, customId,
    reply:async payload=>{replies.push(payload);value.replied=true;},
    deferReply:async payload=>{deferred.push(payload);value.deferred=true;}, deferUpdate:async()=>{value.deferred=true;},
    editReply:async payload=>{edits.push(snapshot(payload));},
    isRepliable:()=>true, isButton:()=>true, replied:false, deferred:false,
  };
  return {value,replies,deferred,edits};
}

test('the player uses a large cover, progress, next track, volume and actual audio source', () => {
  const current = song();
  current.stream.playFromSource = false;
  current.stream.song = song('audio'); current.stream.song.source = 'soundcloud';
  const embed = createNowPlayingEmbed(current, 78_000, { volume:80, nextSong:song('Mente Positiva'), queued:2, autoplay:true }).toJSON();
  assert.equal(embed.title, 'Que Te Vas');
  assert.equal(embed.author.name, '▶ Reproduciendo');
  assert.equal(embed.image.url, current.thumbnail);
  assert.equal(embed.thumbnail, undefined);
  assert.match(embed.description, /01:18.*03:26/);
  assert.equal(embed.fields.find(field=>field.name==='Volumen').value, '80 %');
  assert.match(embed.fields.find(field=>field.name==='A continuación').value, /Mente Positiva/);
  assert.match(embed.footer.text, /SoundCloud · 2 en espera · Radio activada/);
});

test('live streams and invalid progress values render without exceptions or negative bars', () => {
  assert.match(createProgressBar(10, 0), /En vivo/);
  assert.match(createProgressBar(-20, 206_000), /00:00/);
  assert.match(createProgressBar(Infinity, 206_000, NaN), /00:00/);
  assert.match(createProgressBar(999_000, 206_000, -1), /03:26.*03:26/);
  const current=song();current.thumbnail='not-a-url';current.url='javascript:alert(1)';
  const embed=createNowPlayingEmbed(current).toJSON();
  assert.equal(embed.url,undefined);assert.equal(embed.image,undefined);
});

test('legacy restored YouTube tracks retain a large cover without an extra lookup', () => {
  const current = song(); current.thumbnail = undefined; current.id = 'AAAAAAAAAAA';
  assert.equal(createNowPlayingEmbed(current).toJSON().image.url, 'https://i.ytimg.com/vi/AAAAAAAAAAA/hqdefault.jpg');
  current.source = 'soundcloud';
  assert.equal(createNowPlayingEmbed(current).toJSON().image, undefined);
});

test('a metadata track without saved artwork uses the resolved audio cover', () => {
  const current = song(); current.source = 'spotify'; current.thumbnail = undefined; current.stream.playFromSource = false;
  const audio = song(); audio.id = 'BBBBBBBBBBB'; audio.thumbnail = undefined; current.stream.song = audio;
  assert.equal(createNowPlayingEmbed(current).toJSON().image.url, 'https://i.ytimg.com/vi/BBBBBBBBBBB/hqdefault.jpg');
  current.thumbnail = 'https://i.scdn.co/image/original-cover';
  assert.equal(createNowPlayingEmbed(current).toJSON().image.url, current.thumbnail);
});

test('song changes edit one player and unchanged or paused progress does not generate writes', async t => {
  const f=fixture(t);await f.panels.show(f.queue);
  await f.panels.refresh(f.queue);assert.equal(f.edits.length,0);
  f.queue.songs.shift();f.queue.currentTime=0;await f.panels.show(f.queue);
  assert.equal(f.sends.length,1);assert.equal(f.edits[0].payload.embeds[0].title,'Mente Positiva');
  f.queue.paused=true;await f.panels.refresh(f.queue);await f.panels.refresh(f.queue);
  assert.equal(f.edits.length,2);assert.equal(f.edits[1].payload.embeds[0].author.name,'⏸ En pausa');
  assert.equal(f.edits[1].payload.components[0].components[0].label,'Reanudar');
  assert.equal(f.edits[1].payload.components[0].components[1].disabled,true);
});

test('concurrent events coalesce while the first Discord send is pending', async t => {
  const f=fixture(t);let release;f.setSendHook(()=>new Promise(resolve=>{release=resolve;}));
  const first=f.panels.show(f.queue);await tick();
  f.queue.songs[0]=song('Nuevo tema');
  const second=f.panels.show(f.queue);const third=f.panels.refresh(f.queue);
  release();await Promise.all([first,second,third]);
  assert.equal(f.sends.length,1);assert.equal(f.edits.length,1);
  assert.equal(f.edits[0].payload.embeds[0].title,'Nuevo tema');
});

test('ending during the first send disables the arriving message and rejects its controls', async t => {
  const f=fixture(t);let release;f.setSendHook(()=>new Promise(resolve=>{release=resolve;}));
  const first=f.panels.show(f.queue);await tick();
  f.queue.stopped=true;f.queue.songs=[];
  const closed=f.panels.close(f.queue,'✓ Cola terminada');release();await Promise.all([first,closed]);
  assert.equal(f.sends.length,1);
  assert.equal(f.edits.at(-1).payload.embeds[0].author.name,'✓ Cola terminada');
  assert.ok(f.edits.at(-1).payload.components[0].components.every(button=>button.disabled));
  assert.equal(f.panels.owns(f.queue,f.messages[0].id),false);
});

test('a replacement queue waits for old controls to be disabled and ignores late old events', async t => {
  const f=fixture(t);let release;f.setSendHook(()=>new Promise(resolve=>{release=resolve;}));
  const old=f.panels.show(f.queue);await tick();
  const replacement={...f.queue,songs:[song('Sesión nueva')]};
  const started=f.panels.show(replacement);f.setSendHook(async()=>{});release();
  await Promise.all([old,started]);
  assert.equal(f.sends.length,2);assert.ok(f.edits[0].payload.components[0].components.every(button=>button.disabled));
  await f.panels.close(f.queue);assert.equal(f.panels.owns(replacement,f.messages[1].id),true);
  assert.equal(f.panels.owns(replacement,f.messages[0].id),false);
});

test('a deleted player is replaced once and its old message loses ownership', async t => {
  const f=fixture(t);await f.panels.show(f.queue);const old=f.messages[0].id;
  f.setEditFailure({code:10008});f.queue.currentTime=99;await f.panels.refresh(f.queue);
  f.setEditFailure(undefined);await f.panels.refresh(f.queue);
  assert.equal(f.sends.length,2);assert.equal(f.panels.owns(f.queue,old),false);
  assert.equal(f.panels.owns(f.queue,f.messages[1].id),true);
});

test('Discord edit failures are contained, back off and never create duplicate players', async t => {
  t.mock.method(console,'error',()=>{});const f=fixture(t);await f.panels.show(f.queue);
  f.setEditFailure({code:50013});f.queue.currentTime=100;
  await assert.doesNotReject(f.panels.refresh(f.queue));await f.panels.refresh(f.queue);
  assert.equal(f.edits.length,1);assert.equal(f.sends.length,1);assert.equal(f.queue.stopped,false);
  await assert.doesNotReject(f.panels.close(f.queue));assert.equal(f.edits.length,2,'Closing attempts to disable controls despite the cooldown');
});

test('a failed initial send backs off instead of flooding Discord on every event', async t => {
  t.mock.method(console,'error',()=>{});const f=fixture(t);f.setSendHook(async()=>{throw new Error('network error');});
  await f.panels.show(f.queue);await f.panels.show(f.queue);await f.panels.refresh(f.queue);
  assert.equal(f.sends.length,1);assert.equal(f.queue.stopped,false);
});

test('the progress timer updates active players and is removed when a queue ends', async t => {
  const f=fixture(t,10);await f.panels.show(f.queue);f.queue.currentTime=90;
  for(let tries=0;tries<50 && f.edits.length===0;tries++)await new Promise(resolve=>setTimeout(resolve,10));
  assert.equal(f.edits.length,1);assert.match(f.edits[0].payload.embeds[0].description,/01:30/);
  await f.panels.close(f.queue);const count=f.edits.length;f.queue.currentTime=100;
  await new Promise(resolve=>setTimeout(resolve,30));assert.equal(f.edits.length,count);
});

test('obsolete buttons cannot pause the current queue and their controls are removed', async t => {
  const f=fixture(t);await f.panels.show(f.queue);
  const stale={id:'old-message',edit:async payload=>{assert.deepEqual(payload.components,[]);}};
  const i=interaction(f,'btn_pause_resume',stale);await handleButton(i.value);
  assert.equal(f.queue.paused,false);assert.match(i.replies[0].content,/sesión anterior/);
  assert.equal(i.replies[0].flags,MessageFlags.Ephemeral);assert.equal(i.deferred.length,0);
});

test('current buttons acknowledge before audio work and update the same panel privately', async t => {
  const f=fixture(t);await f.panels.show(f.queue);const i=interaction(f);
  f.queue.pause=async()=>{assert.equal(i.value.deferred,true);f.queue.paused=true;};
  await handleButton(i.value);assert.equal(i.deferred[0].flags,MessageFlags.Ephemeral);
  assert.equal(i.replies.length,0);assert.match(i.edits[0].content,/pausada/);
  assert.equal(f.edits.at(-1).payload.embeds[0].author.name,'⏸ En pausa');assert.equal(f.sends.length,1);
});

test('another voice channel cannot use the active player', async t => {
  const f=fixture(t);await f.panels.show(f.queue);const i=interaction(f);
  i.value.guild.members.cache.get('user-1').voice.channel.id='voice-2';await handleButton(i.value);
  assert.equal(f.queue.paused,false);assert.match(i.replies[0].content,/mismo canal/);
});

test('a session replaced during interaction acknowledgement cannot stop or pause its successor', async t => {
  const f=fixture(t);await f.panels.show(f.queue);const old=f.queue;
  let mutations=0;old.stop=async()=>{mutations++;};old.pause=async()=>{mutations++;};
  for(const button of ['btn_stop','btn_pause_resume','btn_skip']) {
    f.distube.getQueue=()=>old;await f.panels.show(old);
    const i=interaction(f,button,f.messages.at(-1));
    i.value.deferReply=async()=>{
      i.value.deferred=true;
      const replacement={...old,songs:[song('Nueva sesión')]};
      f.distube.getQueue=()=>replacement;await f.panels.show(replacement);
    };
    await handleButton(i.value);assert.match(i.edits[0].content,/sesión terminó/);
  }
  assert.equal(mutations,0);
});

test('queue pagination respects Discord text limits and clamps after songs are removed', () => {
  const queue={songs:[song('Actual'),...Array.from({length:25},(_,index)=>song(`${index+1} ${'x'.repeat(500)}`))],paused:false};
  const embed=createQueueEmbed(queue,1).toJSON();
  assert.match(embed.description,/\n\n11\./);assert.ok(embed.description.length<4096);
  assert.match(embed.footer.text,/Página 2\/3/);
  const row=createQueueButtons(queue,'aaaaaaaaaaaaaaaa',1)[0].toJSON();
  assert.equal(row.components[0].custom_id,'queue_page:aaaaaaaaaaaaaaaa:0');
  queue.songs.forEach(song=>{song.name='*_[]~`'.repeat(100);});
  assert.ok(createQueueEmbed(queue).toJSON().description.length<4096,'Escaping Markdown must also fit the embed limit');
  queue.songs.length=3;
  assert.match(createQueueEmbed(queue,999).toJSON().footer.text,/Página 1\/1/);
  assert.deepEqual(createQueueButtons(queue,'aaaaaaaaaaaaaaaa',999),[]);
});

function assertUniqueComponentIds(payload) {
  const ids=(payload.components??[]).flatMap(row=>row.components.map(button=>button.custom_id));
  assert.equal(new Set(ids).size,ids.length,'Discord requires unique custom_id values, including disabled buttons');
  assert.ok(ids.every(id=>id.length<=100));
}

test('queue buttons have unique IDs on first, middle and last pages, even at page boundaries', () => {
  for(const waiting of [0,1,10,11,20,21,500]) {
    const queue={songs:[song(),...Array.from({length:waiting},(_,index)=>song(String(index)))]};
    const pages=Math.max(1,Math.ceil(waiting/10));
    for(const requested of [-1,0,1,pages-1,999,NaN]) {
      const components=createQueueButtons(queue,'aaaaaaaaaaaaaaaa',requested).map(row=>row.toJSON());
      assertUniqueComponentIds({components});
      if(pages===1) {assert.deepEqual(components,[]);continue;}
      const page=Number.isFinite(requested)?Math.max(0,Math.min(pages-1,requested)):0;
      assert.equal(components[0].components[0].disabled,page===0);
      assert.equal(components[0].components[1].disabled,true);
      assert.equal(components[0].components[2].disabled,page===pages-1);
    }
  }
});

test('opening the queue and navigating from first to last page produces Discord-valid components', async t => {
  const f=fixture(t);f.queue.songs.push(...Array.from({length:20},(_,index)=>song(String(index))));
  await f.panels.show(f.queue);
  const open=interaction(f,'btn_queue');
  open.value.editReply=async payload=>{const json=snapshot(payload);assertUniqueComponentIds(json);open.edits.push(json);};
  await handleButton(open.value);assert.equal(open.deferred[0].flags,MessageFlags.Ephemeral);
  assert.match(open.edits[0].embeds[0].footer.text,/Página 1\/3/);
  let payload=open.edits[0];
  for(const expected of [2,3]) {
    const next=interaction(f,payload.components[0].components[2].custom_id);
    next.value.editReply=async reply=>{payload=snapshot(reply);assertUniqueComponentIds(payload);};
    await handleButton(next.value);assert.match(payload.embeds[0].footer.text,new RegExp(`Página ${expected}/3`));
  }
  assert.equal(payload.components[0].components[2].disabled,true);
  f.queue.songs.length=3;
  const previous=interaction(f,payload.components[0].components[0].custom_id);
  previous.value.editReply=async reply=>{payload=snapshot(reply);assertUniqueComponentIds(payload);};
  await handleButton(previous.value);assert.match(payload.embeds[0].footer.text,/Página 1\/1/);
  assert.deepEqual(payload.components,[]);
});

test('/queue sends valid component IDs using the same pagination as the player button', async t => {
  const f=fixture(t);f.queue.songs.push(...Array.from({length:19},(_,index)=>song(String(index))));
  await f.panels.show(f.queue);const i=interaction(f);
  i.value.reply=async payload=>{const json=snapshot(payload);assertUniqueComponentIds(json);i.replies.push(json);};
  await queueCommand.execute(i.value);assert.equal(i.replies[0].flags,MessageFlags.Ephemeral);
  assert.match(i.replies[0].embeds[0].footer.text,/Página 1\/2/);
});

test('queue page buttons belong to their queue session and expire when that session changes', async t => {
  const f=fixture(t);f.queue.songs.push(...Array.from({length:20},(_,index)=>song(String(index))));await f.panels.show(f.queue);
  const session=f.panels.session(f.queue);
  const i=interaction(f,`queue_page:${session}:1`);await handleButton(i.value);
  assert.equal(i.value.deferred,true);assert.match(i.edits[0].embeds[0].footer.text,/Página 2\/3/);
  await f.panels.close(f.queue);await f.panels.show(f.queue);
  const stale=interaction(f,`queue_page:${session}:1`,{id:'queue-message',edit:async()=>{}});
  await handleButton(stale.value);assert.match(stale.replies[0].content,/sesión anterior/);
});

test('/nowplaying links to the existing player without publishing a second card', async t => {
  const f=fixture(t);await f.panels.show(f.queue);const i=interaction(f);
  await nowplaying.execute(i.value);assert.equal(f.sends.length,1);
  assert.equal(i.deferred[0].flags,MessageFlags.Ephemeral);assert.match(i.edits[0].content,/Abrir el reproductor/);
  assert.equal(i.edits[0].components,undefined);
});

test('/nowplaying replaces a deleted paused player even when its progress has not changed', async t => {
  const f=fixture(t);f.queue.paused=true;await f.panels.show(f.queue);
  f.setEditFailure({code:10008});const i=interaction(f);await nowplaying.execute(i.value);
  assert.equal(f.sends.length,2);assert.match(i.edits[0].content,/\/2\)/);
});

test('/nowplaying handles a session ending during Discord acknowledgement', async t => {
  const f=fixture(t);await f.panels.show(f.queue);const i=interaction(f);
  i.value.deferReply=async()=>{f.queue.stopped=true;f.queue.songs=[];await f.panels.close(f.queue);};
  await nowplaying.execute(i.value);assert.match(i.edits[0].content,/sesión terminó/);
});

test('slash pause awaits the operation and synchronizes the panel immediately', async t => {
  const f=fixture(t);await f.panels.show(f.queue);const i=interaction(f);
  i.value.isButton=()=>false;i.value.isAutocomplete=()=>false;i.value.isChatInputCommand=()=>true;i.value.commandName='pause';
  f.queue.pause=async()=>{await tick();f.queue.paused=true;};
  await handleInteraction(i.value);assert.equal(f.queue.paused,true);
  assert.equal(f.edits.at(-1).payload.embeds[0].author.name,'⏸ En pausa');
});
