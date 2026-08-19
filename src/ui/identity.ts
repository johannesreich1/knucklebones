// Names and colours follow the PLAYER identity, never the screen half.
import { ME, type Player } from '../core/rules.ts';
import { S } from '../state.ts';

export function nameOf(who: Player): string {
  if (S.mode === 'duo') return who === ME ? 'PLAYER 1' : 'PLAYER 2';
  return who === ME ? 'YOU' : 'AI';
}

export function colorOf(who: Player): string {
  return who === ME ? 'var(--cy)' : 'var(--mg)';
}
