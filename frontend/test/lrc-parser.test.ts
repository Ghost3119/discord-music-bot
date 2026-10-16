import { describe, expect, it } from 'vitest';
import { parseLrc } from '../../src/web/lyrics/lrc';
import { findActiveLine } from '../src/features/lyrics/playback-clock';

describe('LRC parser', () => {
  it('converts variable timestamp precision consistently to milliseconds', () => {
    expect(parseLrc('[00:01]Uno\n[01:02.1]Dos\n[01:02.12]Tres\n[01:02.1236]Cuatro')).toEqual([
      { timeMs: 1000, text: 'Uno' }, { timeMs: 62100, text: 'Dos' },
      { timeMs: 62120, text: 'Tres' }, { timeMs: 62124, text: 'Cuatro' },
    ]);
  });

  it('expands multiple timestamps, sorts chronologically and preserves source order on ties', () => {
    expect(parseLrc('[00:05][00:01.50]Repetida\n[00:03]Primera voz\n[00:03]Segunda voz')).toEqual([
      { timeMs: 1500, text: 'Repetida' }, { timeMs: 3000, text: 'Primera voz' },
      { timeMs: 3000, text: 'Segunda voz' }, { timeMs: 5000, text: 'Repetida' },
    ]);
  });

  it('removes exact timestamp/text duplicates without losing repeated lyrics at different times', () => {
    expect(parseLrc('[00:01][00:01]Una\n[00:01]Una\n[00:02]Una')).toEqual([
      { timeMs: 1000, text: 'Una' }, { timeMs: 2000, text: 'Una' },
    ]);
  });

  it('retains timed silence, Unicode and literal brackets inside lyric text', () => {
    expect(parseLrc('\uFEFF[ar:SONORA]\r\n[ti:Prueba original]\r\n\r\n[00:01]¡Corazón! 音楽 & <luz> [eco]\r\n[00:02]  ')).toEqual([
      { timeMs: 1000, text: '¡Corazón! 音楽 & <luz> [eco]' },
      { timeMs: 2000, text: '' },
    ]);
  });

  it('uses the last valid global offset in milliseconds and clamps negative timestamps', () => {
    expect(parseLrc('[offset:500]\n[00:00.1]Uno\n[offset:-200]\n[00:01]Dos\n[offset:invalid]')).toEqual([
      { timeMs: 0, text: 'Uno' }, { timeMs: 800, text: 'Dos' },
    ]);
  });

  it('ignores malformed timestamps and metadata while recovering valid leading tags', () => {
    expect(parseLrc('[00:99]No\n[00:1]No\n[xx:02]No\n[00:02.X]No\nTexto\n[bad][00:03.50]Sí\n[by:Prueba]\n[00:04')).toEqual([
      { timeMs: 3500, text: 'Sí' },
    ]);
  });

  it('bounds output for untrusted provider input', () => {
    const source = Array.from({ length: 5500 }, (_, index) => `[00:01]Línea original ${index}`).join('\n');
    expect(parseLrc(source)).toHaveLength(5000);
  });
});

describe('active line selection', () => {
  const lines = [{ timeMs: 1000, text: 'Uno' }, { timeMs: 2000, text: '' }, { timeMs: 3000, text: 'Dos' }, { timeMs: 3000, text: 'Otra voz' }];
  it('handles boundaries, silence and repeated timestamps deterministically', () => {
    expect(findActiveLine(lines, 999)).toBe(-1);
    expect(findActiveLine(lines, 1000)).toBe(0);
    expect(findActiveLine(lines, 2500)).toBe(1);
    expect(findActiveLine(lines, 3000)).toBe(3);
    expect(findActiveLine(lines, 99999)).toBe(3);
  });
  it('handles empty lists and invalid positions without highlighting a line', () => {
    expect(findActiveLine([], 1000)).toBe(-1);
    expect(findActiveLine(lines, -1)).toBe(-1);
    expect(findActiveLine(lines, NaN)).toBe(-1);
    expect(findActiveLine(lines, Infinity)).toBe(-1);
  });
});
