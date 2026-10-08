const { spawn } = require('node:child_process');
const path = require('node:path');
require('dotenv').config();
const directory = process.env.YTDLP_DIR || path.join(path.dirname(require.resolve('@distube/yt-dlp')), '..', 'bin');
const filename = process.env.YTDLP_FILENAME || (process.platform === 'win32' ? 'yt-dlp.exe' : 'yt-dlp');
const child = spawn(path.join(directory, filename), ['--update'], { stdio: 'inherit', windowsHide: true, timeout: 60000 });
child.on('error', (error) => { console.error('No se pudo actualizar yt-dlp:', error); process.exitCode = 1; });
child.on('exit', (code) => { process.exitCode = code === 0 ? 0 : 1; });
