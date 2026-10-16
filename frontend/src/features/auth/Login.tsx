import { ArrowRight, AudioLines, LoaderCircle, Music2, RefreshCw, ShieldCheck } from 'lucide-react';
import { Brand } from '../../components/common/Brand';
import { Button } from '../../components/ui/button';

export interface LoginProps {
  error: string;
  retry: () => void;
  loading: boolean;
}

export function Login({ error, retry, loading }: LoginProps) {
  return (
    <div className="login-page">
      <div className="login-brand">
        <Brand />
        <span className="private-badge">
          <ShieldCheck size={13} /> ESPACIO PRIVADO
        </span>
      </div>
      <main className="login-main">
        <div className="login-copy">
          <span className="eyebrow">BUENA MÚSICA. BUENA COMPAÑÍA.</span>
          <h1>
            El mejor lugar
            <br />
            para <em>darle play.</em>
          </h1>
          <p>
            Tu servidor tiene su propio ritmo. Controla la música, reúne tus favoritas y comparte el momento.
          </p>
          {loading ? (
            <Button disabled>
              <LoaderCircle className="spin" size={18} /> Conectando con tu espacio
            </Button>
          ) : (
            <Button asChild className="discord-login">
              <a href="/auth/discord">
                <DiscordIcon /> Continuar con Discord <ArrowRight size={18} />
              </a>
            </Button>
          )}
          <small>
            <ShieldCheck size={13} /> Solo para miembros autorizados de tu servidor.
          </small>
          {error && (
            <div className="login-error" role="alert">
              <p>{error}</p>
              <Button variant="secondary" size="sm" onClick={retry}>
                <RefreshCw size={14} /> Reintentar conexión
              </Button>
            </div>
          )}
        </div>
        <div className="login-visual" aria-hidden="true">
          <div className="record-glow" />
          <div className="record">
            <div className="record-label">
              <AudioLines size={48} strokeWidth={1.3} />
              <span>SONORA</span>
            </div>
          </div>
          <span className="floating-note">
            <Music2 size={20} /> HECHO PARA ESCUCHAR JUNTOS
          </span>
          <div className="visual-bars">
            {Array.from({ length: 28 }, (_, i) => (
              <span
                key={i}
                style={{ height: `${16 + Math.sin(i * 1.7) ** 2 * 42}px`, animationDelay: `${i * 0.09}s` }}
              />
            ))}
          </div>
        </div>
      </main>
      <footer className="login-footer">
        <span>MENOS RUIDO, MÁS MÚSICA.</span>
        <span>
          Discord Music Dashboard <span className="tiny-dot" /> SONORA
        </span>
      </footer>
    </div>
  );
}

function DiscordIcon() {
  return (
    <svg width="21" height="21" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true">
      <path d="M19.7 5.3a18 18 0 0 0-4.4-1.4l-.6 1.2a16.2 16.2 0 0 0-5.4 0l-.6-1.2a18 18 0 0 0-4.4 1.4C1.5 9.4.7 13.4 1.1 17.3a18 18 0 0 0 5.4 2.8l1.1-1.8-1.7-.8.4-.3a12.8 12.8 0 0 0 11.4 0l.4.3-1.7.8 1.1 1.8a18 18 0 0 0 5.4-2.8c.5-4.5-.8-8.5-3.2-12ZM8.5 14.8c-1 0-1.8-.9-1.8-2s.8-2 1.8-2 1.8.9 1.8 2-.8 2-1.8 2Zm7 0c-1 0-1.8-.9-1.8-2s.8-2 1.8-2 1.8.9 1.8 2-.8 2-1.8 2Z" />
    </svg>
  );
}
