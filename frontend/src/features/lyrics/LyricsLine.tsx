import { memo } from 'react';
import type { LyricsLine as TimedLine } from '../../../../src/web/lyrics/contracts';

export const LyricsLine = memo(function LyricsLine({ line, index, active, past }: { line: TimedLine; index: number; active: boolean; past: boolean }) {
  return <p className={`immersive-lyric-line${active ? ' is-current' : ''}${past ? ' is-past' : ''}`} data-line-index={index} aria-current={active ? 'true' : undefined}>
    {line.text || <span className="lyric-instrumental-gap" aria-label="Pausa musical">•••</span>}
  </p>;
});
