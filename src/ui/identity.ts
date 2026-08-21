// Names and colours follow the PLAYER identity, never the screen half.
import { ME, type Player } from '../core/rules.ts';
import { S } from '../state.ts';

export function nameOf(who: Player): string {
  if (S.mode === 'duo') return who === ME ? 'PLAYER 1' : 'PLAYER 2';
  return who === ME ? 'YOU' : 'AI';
}

export function colorOf(who: Player): string {
  return who === ME ? 'var(--p1)' : 'var(--p2)';
}

/* the gold-family heat this player's markers wear — or its ice fallback when
   THIS player picked gold (flow/menu.ts sets the per-side token). Floats and
   bursts celebrate in the owner's heat, never a colour the owner is wearing. */
export function heatOf(who: Player): string {
  return who === ME ? 'var(--p1-mx2,var(--gold))' : 'var(--p2-mx2,var(--gold))';
}
