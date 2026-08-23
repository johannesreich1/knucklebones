import type { Player } from '../core/rules.ts';

/* A physical spell target keeps the board owner as well as the numeric
   column. Dropping the owner was enough to let an opposite-board column with
   the same index activate a legal target on the caster's side. */
export type SpellInputTarget =
  | { kind: 'stage' }
  | { kind: 'column'; who: Player; column: number };
