import type { CastCtx } from '../core/spells.ts';
import type { Player } from '../core/rules.ts';
import { S } from '../state.ts';
import { renderBag } from '../ui/bag.ts';
import { setStageDie } from '../ui/die.ts';

/* One live context for every caster. Local supply intentionally uses
   Math.random; LIMITED consumes the real finite bag. */
export function currentCastContext(): CastCtx {
  return {
    mode: S.scoring,
    die: S.die,
    setDie: (value) => {
      S.die = value;
      setStageDie(value, S.turn as Player);
    },
    draw: () => {
      if (!S.pool) return 1 + ((Math.random() * 6) | 0);
      const value = S.pool.shift()!;
      renderBag(S.pool.length);
      return value;
    },
    bagLeft: S.pool ? S.pool.length : null,
    charm: S.charm,
  };
}
