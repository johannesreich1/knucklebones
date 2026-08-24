// Computer rune choice and its visible tell. The shared spell controller owns
// casting; this module owns only when and where the machine elects to cast.
import { type GameState, type Player } from '../core/rules.ts';
import { machineCast, spellById, type CastCtx, type SpellSpec } from '../core/spells.ts';
import { S } from '../state.ts';

const CPU_SPELL_DELAY_MIN = 320;
const CPU_SPELL_DELAY_SPREAD = 580;
const DEMANDS = { easy: 30, medium: 16, hard: 10 } as const;

const pause = (milliseconds: number): Promise<void> =>
  new Promise((resolve) => setTimeout(resolve, milliseconds));

export interface AiSpellPorts {
  chargesOf: (who: Player, id: string) => number;
  castContext: () => CastCtx;
  castBy: (
    who: Player,
    spell: SpellSpec,
    column: number,
    context: CastCtx,
  ) => Promise<boolean>;
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
): Promise<boolean> {
  const id = Object.keys(S.spellCharges[who]).find((key) => ports.chargesOf(who, key) > 0);
  const spell = spellById(id);
  if (!spell) return false;
  if (S.diff === 'easy' && Math.random() < 0.5) return false;
  const context = ports.castContext();
  const column = machineCast(
    S.boards as GameState,
    who,
    spell,
    context,
    DEMANDS[S.diff],
  );
  if (column === null) return false;
  if (waitForTell) {
    const generation = S.gen;
    await pause(aiSpellDelay());
    if (S.gen !== generation || S.turn !== who || S.phase === 'over') return false;
  }
  return ports.castBy(who, spell, column, context);
}
