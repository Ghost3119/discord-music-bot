const {json} = require('@distube/yt-dlp');
const videoId = 'pXRviuL6vMY'; // The Strokes - Reptilia
const mixUrl = `https://www.youtube.com/watch?v=${videoId}&list=RD${videoId}`;

json(mixUrl, {
  dumpSingleJson: true,
  noWarnings: true,
  flatPlaylist: true,
  skipDownload: true,
  simulate: true,
}).then(r => {
  console.log('Playlist title:', r.title);
  console.log('Entry count:', r.entries?.length);
  if (r.entries) {
    r.entries.slice(0, 10).forEach((e, i) => {
      console.log((i + 1) + '. ' + e.title + ' | ' + (e.url || e.webpage_url));
    });
  }
}).catch(e => console.error('ERROR:', e.message));
