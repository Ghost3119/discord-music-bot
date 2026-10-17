import { useEffect, useState } from 'react';
import { ImmersivePlayer } from '../../features/immersive/ImmersivePlayer';
import { PlayerBar, type PlaybackBindings } from './PlayerBar';

interface Props {
  playback: PlaybackBindings;
  connection: 'connecting' | 'live' | 'reconnecting';
  error: string;
  notice?: string;
  guildName?: string;
  editorOpen: boolean;
  onShowQueue: () => void;
}

/** Presentation only. Keeping the dashboard mounted preserves its SSE and editor drafts. */
export function PlayerExperience({ playback, connection, error, notice, guildName, editorOpen, onShowQueue }: Props) {
  const [open, setOpen] = useState(false);
  useEffect(() => { if (editorOpen) setOpen(false); }, [editorOpen]);
  return <>
    <PlayerBar playback={playback} onShowQueue={onShowQueue} onOpenImmersive={() => setOpen(true)} immersiveDisabled={editorOpen} />
    <ImmersivePlayer open={open && !editorOpen} onOpenChange={setOpen} playback={playback} connection={connection} error={error} notice={notice} guildName={guildName} />
  </>;
}
