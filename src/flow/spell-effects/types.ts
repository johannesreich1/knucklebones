import type { Player } from '../../core/rules.ts';

/* Every visible spell effect owns choreography around one authoritative
   mutation. The dispatcher guarantees a single effect; each implementation
   still calls `apply` exactly once at its designed reveal/arrival beat. */
export type SpellEffect = (
  who: Player,
  column: number,
  apply: () => void,
) => Promise<void>;

export const effectPause = (milliseconds: number): Promise<void> =>
  new Promise((resolve) => setTimeout(resolve, milliseconds));
