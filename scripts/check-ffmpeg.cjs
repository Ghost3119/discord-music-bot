const { createServer } = require('node:http');
const { execFile } = require('node:child_process');
const { once } = require('node:events');

// A version check cannot detect static Linux binaries that crash in name resolution.
// Only loopback is contacted; no Discord session, credentials or media are involved.
async function checkFfmpeg() {
  const executable = process.env.FFMPEG_PATH || require('ffmpeg-static');
  const server = createServer((_request, response) => {
    response.writeHead(403);
    response.end('Forbidden');
  });
  try {
    server.listen(0, '127.0.0.1');
    await once(server, 'listening');
    await new Promise((resolve, reject) => {
      execFile(executable, [
        '-hide_banner', '-loglevel', 'error',
        '-i', `http://localhost:${server.address().port}/audio`, '-f', 'null', '-',
      ], { timeout: 6000, windowsHide: true }, (error, _stdout, stderr) => {
        if (!error || error.signal || !stderr.includes('403 Forbidden')) {
          reject(new Error('FFmpeg HTTP hostname smoke test failed'));
        } else resolve();
      });
    });
    console.log('FFmpeg HTTP hostname smoke test passed');
  } finally {
    server.closeAllConnections();
    await new Promise(resolve => server.close(resolve));
  }
}
checkFfmpeg().catch(() => {
  console.error('FFmpeg failed the HTTP hostname smoke test; use a compatible binary via FFMPEG_PATH.');
  process.exitCode = 1;
});
