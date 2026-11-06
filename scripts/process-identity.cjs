'use strict';
const fs = require('node:fs');
const { execFileSync } = require('node:child_process');

/** Fail closed if process identity cannot be read. Never trust a PID supplied by IPC alone. */
function processIdentity(pid) {
  if (!Number.isSafeInteger(pid) || pid <= 1) return null;
  try {
    if (process.platform === 'win32') {
      const output = execFileSync('powershell.exe', ['-NoProfile', '-NonInteractive', '-Command', `$p = Get-CimInstance Win32_Process -Filter 'ProcessId=${pid}'; if ($p) { [Console]::Write(('{0}|{1}' -f $p.ParentProcessId, $p.CreationDate.ToUniversalTime().Ticks)) }`], { encoding: 'utf8', windowsHide: true, timeout: 3000, stdio: ['ignore', 'pipe', 'ignore'] }).trim();
      const match = /^(\d+)\|(\d+)$/.exec(output);
      return match ? { parent: Number(match[1]), created: match[2] } : null;
    }
    if (process.platform === 'linux') {
      const fields = fs.readFileSync(`/proc/${pid}/stat`, 'utf8').split(/\) /).at(-1).split(' ');
      return { parent: Number(fields[1]), created: fields[19] };
    }
    const output = execFileSync('ps', ['-p', String(pid), '-o', 'ppid=', '-o', 'lstart='], { encoding: 'utf8', timeout: 3000, stdio: ['ignore', 'pipe', 'ignore'] }).trim();
    const match = /^(\d+)\s+(.+)$/.exec(output);
    return match ? { parent: Number(match[1]), created: match[2] } : null;
  } catch { return null; }
}
module.exports = { processIdentity };
