// Computer rune choice and its visible tell. The shared spell controller owns
// casting; this module owns only when and where the machine elects to cast.
import { type CharmSt, type GameState, type Player } from '../core/rules.ts';
import {
  machineCastPlan,
  NORMAL_CHARM_COORDINATION_SLIP_RATE,
  spellById,
  type CastCtx,
  type SpellSpec,
} from '../core/spells.ts';
import { S } from '../state.ts';

export { NORMAL_CHARM_COORDINATION_SLIP_RATE };

const CPU_SPELL_DELAY_MIN = 320;
const CPU_SPELL_DELAY_SPREAD = 580;
const DEMANDS = { easy: 30, medium: 16, hard: 10 } as const;

const pause = (milliseconds: number): Promise<void> =>
  new Promise((resolve) => setTimeout(resolve, milliseconds));

export interface AiSpellPorts {
  chargesOf: (who: Player, id: string) => number;
  castContext: () => CastCtx;
  previewPlacement?: (rootCharm?: CharmSt) => number;
  random?: () => number;
  castBy: (
    who: Player,
    spell: SpellSpec,
    column: number,
    context: CastCtx,
  ) => Promise<boolean>;
}

export interface AiSpellTurnResult {
  gameOver: boolean;
  /* Hard reuses every coordinated preview exactly. Normal coordinates a
     root-charm spell except for its explicit rare slip. Easy never previews. */
  placement: number | null;
}

/* A chosen computer cast gets a small tell: enough time to see its card in
   hand before it turns, never enough to read as a stall. Injecting the sample
   keeps the bounds directly testable without making production deterministic. */
export function aiSpellDelay(random: () => number = Math.random): number {
  const sample = Math.max(0, Math.min(0.999999, random()));
  return CPU_SPELL_DELAY_MIN + Math.floor(sample * (CPU_SPELL_DELAY_SPREAD + 1));
}

/* The machine never enters a player-visible aim state, so its cast reserves
   and spends in one step through the controller's typed cast port. */
export async function runAiSpellTurn(
  who: Player,
  ports: AiSpellPorts,
  waitForTell = true,
): Promise<AiSpellTurnResult> {
  const random = ports.random ?? Math.random;
  const id = Object.keys(S.spellCharges[who]).find((key) => ports.chargesOf(who, key) > 0);
  const spell = spellById(id);
  if (!spell || S.spellCastThisTurn === who) return { gameOver: false, placement: null };
  if (S.diff === 'easy' && random() < 0.5) return { gameOver: false, placement: null };
  const context = ports.castContext();
  const plan = machineCastPlan(
    S.boards as GameState,
    who,
    spell,
    context,
    DEMANDS[S.diff],
    S.diff === 'easy' ? undefined : ports.previewPlacement,
  );
  let placement = S.diff === 'hard' ? plan.placement : null;
  if (S.diff === 'medium' && plan.target !== null && plan.rootCharm && plan.placement !== null
      && random() >= NORMAL_CHARM_COORDINATION_SLIP_RATE) {
    placement = plan.placement;
  }
  if (plan.target === null) return { gameOver: false, placement };
  if (waitForTell) {
    const generation = S.gen;
    await pause(aiSpellDelay());
    if (S.gen !== generation || S.turn !== who || S.phase === 'over') {
      return { gameOver: false, placement: null };
    }
  }
  return {
    gameOver: await ports.castBy(who, spell, plan.target, context),
    placement,
  };
}
