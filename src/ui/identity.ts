// Names and colours follow the PLAYER identity, never the screen half.
import { ME, type Player } from '../core/rules';
import { S } from '../state';

export function nameOf(who: Player): string {
  if (S.mode === 'duo') return who === ME ? 'PLAYER 1' : 'PLAYER 2';
  return who === ME ? 'YOU' : 'CPU';
}

export function colorOf(who: Player): string {
  return who === ME ? 'var(--cy)' : 'var(--mg)';
}
