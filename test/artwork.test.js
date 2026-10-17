const test = require('node:test');
const assert = require('node:assert/strict');
const { Song } = require('distube');
const { YtDlpSearchPlugin } = require('../dist/music/ytDlpSearchPlugin');
const { openWebDatabase } = require('../dist/web/database');
const { trackMetadata } = require('../dist/web/validation');
const image = id => `https://i.ytimg.com/vi/${id}/hqdefault.jpg`;
test('thumbnail fallback validates source, URL identity and partial metadata',()=>{
  const {youtubeThumbnail}=require('../dist/music/artwork');
  assert.equal(youtubeThumbnail('youtube','AAAAAAAAAAA'),image('AAAAAAAAAAA'));
  assert.equal(youtubeThumbnail('soundcloud','AAAAAAAAAAA'),undefined);
  assert.equal(youtubeThumbnail('youtube','invalid'),undefined);
  assert.equal(youtubeThumbnail('youtube','AAAAAAAAAAA','https://youtu.be/BBBBBBBBBBB'),undefined);
  assert.equal(youtubeThumbnail('youtube','AAAAAAAAAAA','https://evil.example/watch?v=AAAAAAAAAAA'),undefined);
  assert.equal(youtubeThumbnail('youtube',undefined,'https://music.youtube.com/watch?v=AAAAAAAAAAA'),image('AAAAAAAAAAA'));
  assert.equal(youtubeThumbnail('youtube','AAAAAAAAAAA','https://www.youtube.com/playlist?list=AAAAAAAAAAA'),undefined);
});
test('individual metadata with a cover is preserved and parent album artwork is never inherited',async()=>{
  const plugin=new YtDlpSearchPlugin();const thumbnail=image('AAAAAAAAAAA');
  plugin.fetchInfo=async()=>({id:'AAAAAAAAAAA',extractor:'youtube',webpage_url:'https://www.youtube.com/watch?v=AAAAAAAAAAA',thumbnail});
  assert.equal((await plugin.resolve('https://www.youtube.com/watch?v=AAAAAAAAAAA',{})).thumbnail,thumbnail);
});
test('partial unavailable entries and malformed thumbnail lists do not poison an album',async()=>{
  const plugin=new YtDlpSearchPlugin();
  plugin.fetchInfo=async()=>({extractor:'youtube:tab',entries:[null,{id:'AAAAAAAAAAA',url:'https://music.youtube.com/watch?v=AAAAAAAAAAA',thumbnails:{}},{id:'BBBBBBBBBBB',url:'https://www.youtube.com/watch?v=BBBBBBBBBBB',thumbnails:[null,{url:image('BBBBBBBBBBB')}]}]});
  const playlist=await plugin.resolve('https://music.youtube.com/playlist?list=OLAKexample',{});
  assert.deepEqual(playlist.songs.map(song=>song.thumbnail),[image('AAAAAAAAAAA'),image('BBBBBBBBBBB')]);
});
test('flat YouTube Music albums preserve individual thumbnails and recover missing ones without audio resolution',async()=>{
  const plugin=new YtDlpSearchPlugin();let calls=0;
  plugin.fetchInfo=async (_url,flags)=>{calls++;assert.equal(flags.flatPlaylist,true);return {
    extractor:'youtube:tab',id:'album',thumbnail:image('ZZZZZZZZZZZ'),entries:[
      {id:'AAAAAAAAAAA',title:'A',url:'https://www.youtube.com/watch?v=AAAAAAAAAAA',thumbnail:image('AAAAAAAAAAA')},
      {id:'BBBBBBBBBBB',title:'B',url:'https://music.youtube.com/watch?v=BBBBBBBBBBB',thumbnails:[{url:image('BBBBBBBBBBB')}]},
      {id:'CCCCCCCCCCC',title:'C',url:'https://www.youtube.com/watch?v=CCCCCCCCCCC'},
      {id:'CCCCCCCCCCC',title:'Duplicate C',url:'https://www.youtube.com/watch?v=CCCCCCCCCCC'},
      {id:'invalid',title:'Missing',url:'https://www.youtube.com/watch?v=invalid'},
    ]};};
  const playlist=await plugin.resolve('https://music.youtube.com/playlist?list=OLAKexample',{});
  assert.deepEqual(playlist.songs.map(song=>song.thumbnail),[image('AAAAAAAAAAA'),image('BBBBBBBBBBB'),image('CCCCCCCCCCC'),image('CCCCCCCCCCC'),undefined]);
  assert.equal(calls,1);
});
test('Mix recommendations and autoplay related songs recover artwork from their own IDs',async()=>{
  const plugin=new YtDlpSearchPlugin();let calls=0;
  plugin.fetchInfo=async()=>{calls++;return {entries:[{id:'AAAAAAAAAAA'},{id:'BBBBBBBBBBB',title:'B'},{id:'CCCCCCCCCCC',title:'C',thumbnail:image('CCCCCCCCCCC')} ]};};
  const seed=new Song({id:'AAAAAAAAAAA',source:'youtube',playFromSource:true,plugin,url:'https://music.youtube.com/watch?v=AAAAAAAAAAA'});
  assert.deepEqual((await plugin.getRecommendations(seed)).map(song=>song.thumbnail),[image('BBBBBBBBBBB'),image('CCCCCCCCCCC')]);
  assert.equal((await plugin.getRelatedSongs(seed))[0].thumbnail,image('BBBBBBBBBBB'));assert.equal(calls,1);
});
test('library stores new artwork and projects legacy missing artwork without a migration or row rewrite',()=>{
  const db=openWebDatabase(':memory:');try{
    db.createSession({id:'u',username:'QA',avatar:null},Date.now(),60000);
    const data={url:'https://music.youtube.com/watch?v=AAAAAAAAAAA',title:'A',artist:'Test',duration:120,thumbnail:null,source:'youtube'};
    const normalized=trackMetadata(data);assert.equal(normalized.thumbnail,image('AAAAAAAAAAA'));
    const playlist=db.createPlaylist('u','g','Album',Date.now());
    db.addPlaylistTrack('u','g',playlist.id,data);
    const saved=db.getPlaylist('u','g',playlist.id);assert.equal(saved.tracks[0].thumbnail,image('AAAAAAAAAAA'));
    assert.equal(db.sqlite.prepare('SELECT thumbnail FROM playlist_tracks LIMIT 1').get().thumbnail,null);
  }finally{db.close();}
});
