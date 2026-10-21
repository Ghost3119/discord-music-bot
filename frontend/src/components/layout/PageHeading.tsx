import { Headphones } from 'lucide-react';
import { CustomSelect } from '../common/CustomSelect';
import type { GuildSummary, PlaybackSnapshot, Playlist } from '../../lib/api';
import type { View } from '../../types/app';

export interface PageHeadingProps {
  view: View;
  playlist?: Playlist;
  guilds: GuildSummary[];
  guildId: string;
  guildsLoading: boolean;
  busy: string;
  state: PlaybackSnapshot | null;
  onGuildChange: (guildId: string) => void;
}

export function PageHeading({
  view,
  playlist,
  guilds,
  guildId,
  guildsLoading,
  busy,
  state,
  onGuildChange,
}: PageHeadingProps) {
  const guild = guilds.find((item) => item.id === guildId);
  return (
    <div className="page-heading">
      <div>
        <span className="eyebrow">TU SERVIDOR. TU SOUNDTRACK.</span>
        <h1>
          {view === 'player'
            ? 'Dale ritmo al momento.'
            : view === 'search'
              ? 'Buscar música'
              : view === 'library'
                ? playlist?.name || 'Hecha a tu ritmo.'
                : view === 'favorites'
                  ? 'Siempre vuelves a estas.'
                  : 'Todo bajo control.'}
        </h1>
      </div>
      <CustomSelect
        id="guild-select"
        variant="guild"
        label="ESCUCHANDO EN"
        value={guildId}
        disabled={guildsLoading || !guilds.length || !!busy}
        placeholder={guildsLoading ? 'Buscando servidores…' : 'Sin servidores'}
        leadingIcon={
          guild?.icon ? (
            <img alt="" src={guild.icon} referrerPolicy="no-referrer" />
          ) : (
            <Headphones size={18} />
          )
        }
        options={guilds.map((item) => ({
          value: item.id,
          label: item.name,
          sublabel: item.id === guildId && state?.voice ? state.voice.name : 'Servidor autorizado',
          icon: item.icon ? (
            <img alt="" src={item.icon} referrerPolicy="no-referrer" />
          ) : (
            <Headphones size={15} />
          ),
        }))}
        onChange={onGuildChange}
      />
    </div>
  );
}
