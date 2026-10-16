const labels: Record<string, string> = {
  connected: 'Conexión con Discord', voiceConnected: 'Conexión de voz', ping: 'Latencia',
  mode: 'Modo del reproductor', attempts: 'Intentos de recuperación', recentFailures: 'Fallos en los últimos 5 min',
  lastProgressAt: 'Último progreso de audio', monitor: 'Monitor de reproducción', breaker: 'Protección ante fallos',
  requested: 'Precargas solicitadas', urlsReady: 'Enlaces preparados', buffersStarted: 'Búferes iniciados',
  buffersReady: 'Búferes preparados', reusedBuffer: 'Búferes reutilizados', reusedUrl: 'Enlaces reutilizados',
  fallback: 'Reproducciones de respaldo', failures: 'Fallos de precarga', cancellations: 'Precargas canceladas',
  transitions: 'Transiciones de canción', tracked: 'Colas supervisadas', preparations: 'Preparaciones pendientes',
  activeResolutions: 'Búsquedas activas', activeBuffers: 'Búferes activos', bufferSuccessPercent: 'Precargas correctas',
  gapMsTotal: 'Espera acumulada entre canciones',
};
const modes: Record<string, string> = { idle: 'En espera', preparing: 'Preparando audio', playing: 'Reproduciendo', paused: 'En pausa', recovering: 'Recuperando audio', alternative: 'Buscando alternativa', blocked: 'Pausado por fallos', ended: 'Cola terminada', disconnected: 'Desconectado' };

export function healthRows(health: Record<string, unknown>): Array<{ key: string; label: string; value: string }> {
  return Object.entries(health).filter(([, value]) => value === null || ['boolean', 'number', 'string'].includes(typeof value)).map(([key, value]) => {
    let display: string;
    if (value === null) display = 'Sin datos todavía';
    else if (key.endsWith('At') && typeof value === 'string') {
      const date = new Date(value);
      display = Number.isNaN(date.getTime()) ? 'Sin datos todavía' : date.toLocaleString('es-MX', { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit', second: '2-digit' });
    } else if (key === 'mode' && typeof value === 'string') display = modes[value] || value;
    else if (typeof value === 'boolean') display = ['connected', 'voiceConnected'].includes(key) ? value ? 'Conectada' : 'Desconectada' : value ? 'Activo' : 'Inactivo';
    else if (typeof value === 'number') {
      const formatted = value.toLocaleString('es-MX', { maximumFractionDigits: key === 'bufferSuccessPercent' ? 1 : 0 });
      display = key === 'ping' || key.endsWith('MsTotal') ? `${formatted} ms` : key.endsWith('Percent') ? `${formatted}%` : formatted;
    } else display = String(value);
    return { key, label: labels[key] || key.replace(/([A-Z])/g, ' $1').replace(/_/g, ' '), value: display };
  });
}
