'use strict';
const path = require('node:path');
const fs = require('node:fs/promises');
const { createHash, randomUUID } = require('node:crypto');

/** Maintenance only: neither the release version nor the expected digest comes from the download. */
async function updateYtDlp({ version, sha256, directory, filename, fetchImpl = fetch }) {
  if (!/^\d{4}\.\d{2}\.\d{2}(?:\.\d+)?$/.test(version || '') || !/^[a-f\d]{64}$/i.test(sha256 || '')) throw new Error('Indica --version YYYY.MM.DD y --sha256 con un digest revisado de esa versión.');
  if (typeof filename !== 'string' || !filename || ['.', '..'].includes(filename) || filename !== path.basename(filename) || /[\u0000-\u001f]/.test(filename)) throw new Error('Nombre de binario yt-dlp inválido.');
  const target = path.join(path.resolve(directory), filename);
  const asset = process.platform === 'win32' ? 'yt-dlp.exe' : process.platform === 'darwin' ? 'yt-dlp_macos' : 'yt-dlp';
  const response = await fetchImpl(`https://github.com/yt-dlp/yt-dlp/releases/download/${version}/${asset}`, { signal: AbortSignal.timeout(60_000) });
  if (!response.ok || !response.body) throw new Error('No se pudo descargar la versión fijada de yt-dlp.');
  const chunks = []; let length = 0;
  for await (const chunk of response.body) {
    length += chunk.length;
    if (length > 100 * 1024 * 1024) throw new Error('El binario supera el tamaño permitido.');
    chunks.push(Buffer.from(chunk));
  }
  const data = Buffer.concat(chunks);
  if (createHash('sha256').update(data).digest('hex') !== sha256.toLowerCase()) throw new Error('SHA-256 no coincide; se conserva el binario instalado.');
  const temporary = `${target}.${randomUUID()}.tmp`;
  try {
    await fs.writeFile(temporary, data, { flag: 'wx', mode: 0o755 });
    await fs.rename(temporary, target);
  } finally { await fs.rm(temporary, { force: true }); }
}

module.exports = { updateYtDlp };
if (require.main === module) {
  require('dotenv').config({ quiet: true });
  const args = process.argv.slice(2);
  const value = name => args[args.indexOf(name) + 1];
  const version = args.includes('--version') ? value('--version') : undefined;
  const sha256 = args.includes('--sha256') ? value('--sha256') : undefined;
  const directory = process.env.YTDLP_DIR || path.join(path.dirname(require.resolve('@distube/yt-dlp')), '..', 'bin');
  const filename = process.env.YTDLP_FILENAME || (process.platform === 'win32' ? 'yt-dlp.exe' : 'yt-dlp');
  updateYtDlp({ version, sha256, directory, filename }).then(() => console.log('yt-dlp actualizado con SHA-256 verificado.'), error => {
    console.error(error.message); process.exitCode = 1;
  });
}
