// Names and colours follow the PLAYER identity, never the screen half.
import { ME, type Player } from '../core/rules.ts';
import { t } from '../i18n/index.ts';
import { S } from '../state.ts';

export type PlayerNameResolver = (who: Player) => string | null;
let claimedNames: PlayerNameResolver | null = null;

/** Ranked play may claim the shared plates/ARIA with server-owned nicknames. */
export function claimPlayerNames(resolve: PlayerNameResolver): () => void {
  claimedNames = resolve;
  return () => { if (claimedNames === resolve) claimedNames = null; };
}

export function nameOf(who: Player): string {
  const claimed = claimedNames?.(who);
  if (claimed) return claimed;
  if (S.mode === 'duo') return who === ME
    ? t('game', 'player.player1') : t('game', 'player.player2');
  return who === ME ? t('game', 'player.you') : t('game', 'player.ai');
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
