import { Activity, ExternalLink, Headphones, RefreshCw, ShieldCheck, Wifi } from 'lucide-react';
import { Button } from '../../components/ui/button';
import { playbackLabels as labels } from '../../components/player/NowPlaying';
import { healthRows } from '../../lib/health';
import type { PlaybackSnapshot } from '../../lib/api';

export interface DiagnosticsViewProps {
  state: PlaybackSnapshot | null;
  connection: string;
  refresh: () => void;
}

export function DiagnosticsView({ state, connection, refresh }: DiagnosticsViewProps) {
  const healthEntries = healthRows(state?.health || {});
  const rawPreload = state?.health.preload;
  const preloadEntries =
    rawPreload && typeof rawPreload === 'object' && !Array.isArray(rawPreload)
      ? healthRows(rawPreload as Record<string, unknown>)
      : [];
  return (
    <section className="diagnostics-view">
      <div className="section-heading">
        <p>Una mirada a lo que mantiene la música sonando.</p>
        <Button variant="secondary" size="sm" onClick={refresh}>
          <RefreshCw size={14} /> Actualizar estado
        </Button>
      </div>
      <div className="diagnostics-grid">
        <div className="diagnostic-card">
          <span className="diagnostic-icon">
            <Wifi size={23} />
          </span>
          <span className="eyebrow">CONEXIÓN EN VIVO</span>
          <h3>
            {connection === 'live'
              ? 'Sincronizada'
              : connection === 'reconnecting'
                ? 'Reconectando'
                : 'Conectando'}
          </h3>
          <p>
            {connection === 'live'
              ? 'La cola y el reproductor están actualizados.'
              : 'La conexión se restablece automáticamente.'}
          </p>
        </div>
        <div className="diagnostic-card">
          <span className="diagnostic-icon">
            <Headphones size={23} />
          </span>
          <span className="eyebrow">CANAL DE VOZ</span>
          <h3>{state?.voice?.name || 'Desconectado'}</h3>
          <p>
            {state?.voice
              ? `${state.voice.members} miembros en el canal.`
              : 'Únete a un canal de Discord para iniciar una sesión.'}
          </p>
        </div>
        <div className="diagnostic-card">
          <span className="diagnostic-icon">
            <ShieldCheck size={23} />
          </span>
          <span className="eyebrow">ESTADO DEL MOTOR</span>
          <h3>{state ? labels[state.status] : 'Sincronizando'}</h3>
          <p>
            {state?.status === 'recovering'
              ? 'El bot está intentando recuperar el audio.'
              : state?.status === 'blocked'
                ? 'Revisa los incidentes para conocer el bloqueo.'
                : 'Las protecciones del reproductor siguen activas.'}
          </p>
        </div>
      </div>
      <div className="diagnostic-details">
        <h2>Salud del reproductor</h2>
        {healthEntries.length ? (
          <dl className="health-list">
            {healthEntries.map(({ key, label, value }) => (
              <div key={key}>
                <dt>{label}</dt>
                <dd>{value}</dd>
              </div>
            ))}
          </dl>
        ) : (
          <p className="muted">
            {state
              ? 'El motor no reportó métricas adicionales en esta sesión.'
              : 'Esperando el estado del motor…'}
          </p>
        )}
      </div>
      {preloadEntries.length > 0 && (
        <div className="diagnostic-details">
          <h2>Precarga de audio</h2>
          <dl className="health-list">
            {preloadEntries.map(({ key, label, value }) => (
              <div key={key}>
                <dt>{label}</dt>
                <dd>{value}</dd>
              </div>
            ))}
          </dl>
        </div>
      )}
      <div className="incident-section">
        <div className="section-heading">
          <h2>
            Últimos incidentes <span className="count-badge">{state?.incidents.length || 0}</span>
          </h2>
          <Activity size={18} className="muted" />
        </div>
        {state?.incidents.length ? (
          <div className="incident-list">
            {state.incidents.map((incident, index) => (
              <article key={`${incident.at}-${index}`}>
                <span className="incident-dot" />
                <div>
                  <strong>{incident.code}</strong>
                  <p>{incident.message}</p>
                </div>
                <time dateTime={incident.at}>
                  {new Date(incident.at).toLocaleString('es-MX', {
                    month: 'short',
                    day: 'numeric',
                    hour: '2-digit',
                    minute: '2-digit',
                  })}
                </time>
              </article>
            ))}
          </div>
        ) : (
          <div className="all-good">
            <ShieldCheck size={27} />
            <div>
              <h3>Todo en armonía.</h3>
              <p>No hay incidentes registrados en el estado actual.</p>
            </div>
          </div>
        )}
      </div>
      <p className="diagnostic-note">
        <ExternalLink size={13} /> Para usar los controles debes estar en el canal de voz autorizado del
        servidor.
      </p>
    </section>
  );
}
