'use strict';
const { fork } = require('node:child_process');
const path = require('node:path');

function supervise(options = {}) {
  const entry = options.entry || path.resolve(__dirname, '../dist/bootstrap.js');
  const minimumDelay = options.minimumDelay ?? 1000;
  const maximumDelay = options.maximumDelay ?? 30000;
  const heartbeatTimeout = options.heartbeatTimeout ?? 60000;
  let child;
  let timer;
  let stopping = false;
  let failures = 0;
  let lastHeartbeat = Date.now();
  let lastStart = 0;
  const audioWorkers = new Set();
  function closeAudioWorkers() {
    for (const pid of audioWorkers) {
      try { process.kill(pid, 'SIGKILL'); }
      catch (error) { if (error.code !== 'ESRCH') console.error('[Supervisor] No se pudo cerrar FFmpeg preparado:', error.code); }
    }
    audioWorkers.clear();
  }

  const finish = (code) => {
    clearInterval(watchdog);
    clearTimeout(timer);
    process.exitCode = code;
  };

  function start() {
    if (stopping) return;
    lastHeartbeat = lastStart = Date.now();
    child = fork(entry, options.args || [], { execArgv: ['--no-deprecation'], windowsHide: true,
      env: { ...process.env, MUSIC_SUPERVISOR_IPC: '1' }, stdio: ['inherit', 'inherit', 'inherit', 'ipc'] });
    child.on('message', (message) => {
      if (message && message.type === 'heartbeat') lastHeartbeat = Date.now();
      if (message && message.type === 'audioWorker' && Number.isSafeInteger(message.pid) && message.pid > 1 &&
        message.pid !== process.pid && message.pid !== child?.pid) {
        if (message.action === 'started') audioWorkers.add(message.pid);
        if (message.action === 'closed') audioWorkers.delete(message.pid);
      }
    });
    child.on('error', (error) => console.error('[Supervisor] No se pudo ejecutar el bot:', error));
    child.on('close', (code, signal) => {
      closeAudioWorkers();
      child = undefined;
      if (stopping || code === 78 || code === 79) {
        if (code === 78) console.error('[Supervisor] Configuración inválida; corrige el error y vuelve a iniciar.');
        if (code === 79) console.error('[Supervisor] Ya hay otra instancia activa; salida sin reinicio.');
        finish(stopping ? 0 : code);
        return;
      }
      if (Date.now() - lastStart > 60000) failures = 0;
      const wait = Math.min(maximumDelay, minimumDelay * 2 ** Math.min(failures++, 10));
      console.error(`[Supervisor] El bot terminó (${code ?? signal}); reinicio en ${wait} ms.`);
      timer = setTimeout(start, wait);
    });
  }

  const watchdog = setInterval(() => {
    if (!stopping && child && Date.now() - lastHeartbeat > heartbeatTimeout) {
      console.error('[Supervisor] El bot dejó de responder; reiniciando.');
      closeAudioWorkers();
      child.kill('SIGKILL');
    }
  }, Math.min(10000, heartbeatTimeout / 2));

  function stop() {
    if (stopping) return;
    stopping = true;
    clearTimeout(timer);
    if (!child) { finish(0); return; }
    if (child.connected) child.send({ type: 'shutdown' }, () => {});
    timer = setTimeout(() => { closeAudioWorkers(); child?.kill('SIGKILL'); }, 6000);
    timer.unref();
  }
  process.once('SIGINT', stop);
  process.once('SIGTERM', stop);
  start();
  return { stop };
}

module.exports = { supervise };
if (require.main === module) {
  require('dotenv/config');
  const logs = require('./logger.cjs').installConsole({ name: 'supervisor' });
  process.once('beforeExit', () => { void logs.close(); });
  supervise();
}
