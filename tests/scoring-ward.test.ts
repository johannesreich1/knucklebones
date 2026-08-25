// Focused pure-rule owner for scoring-WARD and its hostile interactions.
// Run: mise exec -- node --experimental-strip-types tests/scoring-ward.test.ts
import {
  AI, ME,
  CLASSIC, ROWSWITCH, ROWMULT, COLSHIELD, SINGLESTRIKE, BOUNTY, LIMITED,
  applyMove, boardTotalMode, distinctPipSum, freshCharm, openStrikes, totalOf,
  type GameState, type Mode,
} from '../src/core/rules.ts';
import {
  machineCast, spellById, swingOf, type CastCtx,
} from '../src/core/spells.ts';

const problems: string[] = [];
const check = (condition: boolean, message: string, detail?: unknown): void => {
  if (!condition) problems.push(`${message} :: ${JSON.stringify(detail)}`);
};
const spell = (id: string) => spellById(id)!;
const context = (over: Partial<CastCtx> = {}): CastCtx => ({
  mode: over.mode ?? CLASSIC,
  die: over.die ?? 3,
  bagLeft: over.bagLeft !== undefined ? over.bagLeft : null,
  charm: over.charm ?? freshCharm(),
  setDie: over.setDie ?? (() => undefined),
  draw: over.draw ?? (() => 5),
});

/* A full distinct COLUMN SHIELD column can earn the scoring half and remains
   answerable. A full matched column offers neither scoring nor defense. */
{
  const ward = spell('ward');
  const distinct: GameState = [[[], [], []], [[4, 5, 6], [2], []]];
  const matched: GameState = [[[], [], []], [[4, 4, 4], [2], []]];
  check(ward.legal(distinct, ME, 0, context({ mode: COLSHIELD })),
    'a full all-distinct COLUMN SHIELD column may be warded for its score bonus');
  check(!ward.legal(matched, ME, 0, context({ mode: COLSHIELD })),
    'a full matched COLUMN SHIELD column is an illegal zero-benefit target');
  check(ward.legal(matched, ME, 1, context({ mode: COLSHIELD })),
    'an OPEN column is still wardable under COLUMN SHIELD');
  check(ward.legal(matched, ME, 0, context()),
    'the same full matched column is defensively wardable outside COLUMN SHIELD');
}

/* WARD adds raw pips once AFTER every native scoring mode. A duplicate
   cancels that addition without consuming the persistent mark. */
{
  const board = [[4, 5, 6], [2, 2], []];
  const wards = [1, 0, 0];
  check(distinctPipSum(board[0]) === 15 && distinctPipSum([4, 4, 6]) === 0,
    'the WARD bonus is the raw sum only for an all-distinct column');
  for (const mode of [
    CLASSIC, ROWSWITCH, ROWMULT, COLSHIELD, SINGLESTRIKE, BOUNTY, LIMITED,
  ] as Mode[]) {
    check(boardTotalMode(board, mode, wards) - boardTotalMode(board, mode) === 15,
      `WARD must add exactly 15 after native mode ${mode} scoring`, {
        plain: boardTotalMode(board, mode), warded: boardTotalMode(board, mode, wards),
      });
  }
  check(totalOf(board, 7, BOUNTY, wards) === boardTotalMode(board, BOUNTY) + 7 + 15,
    'WARD scoring and banked BOUNTY are independent additions');

  const charm = freshCharm();
  charm.wards[AI][0] = 1;
  const st: GameState = [[[4, 5], [], []], [[], [], []]];
  check(boardTotalMode(st[AI], CLASSIC, charm.wards[AI])
      - boardTotalMode(st[AI], CLASSIC) === 9,
    'the live distinct pair receives its WARD bonus before the duplicate');
  applyMove(st, AI, 0, 4, CLASSIC, charm);
  check(charm.wards[AI][0] === 1 && distinctPipSum(st[AI][0]) === 0,
    'an owner duplicate cancels the bonus but does not consume WARD', { st, charm });
}

/* A full COLUMN SHIELD column has no removable victims, but a matching
   hostile placement still dispels WARD and banks no BOUNTY. */
{
  const charm = freshCharm();
  charm.wards[ME][0] = 1;
  const st: GameState = [[[], [], []], [[4, 5, 6], [], []]];
  const previewCharm = freshCharm();
  previewCharm.wards[ME][0] = 1;
  const plan = openStrikes(st, AI, 0, 4, COLSHIELD, previewCharm);
  check(plan.length === 1 && plan[0].warded && plan[0].victims.length === 0,
    'a matching full-shield action is represented as a zero-victim WARD break', plan);
  const killed = applyMove(st, AI, 0, 4, COLSHIELD, charm);
  check(killed === 0 && String(st[ME][0]) === '4,5,6' && charm.wards[ME][0] === 0,
    'the shield preserves every die while the one-hit WARD burns for zero BOUNTY', { killed, st, charm });
}

/* PILFER is a hostile action, so WARD answers before receiver capacity or
   COLUMN SHIELD can prevent the attempted theft. No die may move. */
{
  const pilfer = spell('pilfer');
  const warded: GameState = [[[4, 4, 4], [], []], [[3, 4, 5], [], []]];
  const wardedCtx = context({ mode: COLSHIELD });
  wardedCtx.charm.wards[ME][0] = 1;
  const before = JSON.stringify(warded);
  check(pilfer.legal(warded, AI, 0, wardedCtx),
    'PILFER may attack a WARD even through two full facing columns');
  check(pilfer.previewDieIndex?.(warded, AI, 0, wardedCtx) === null,
    'an intercepted PILFER previews no die flight');
  pilfer.apply(warded, AI, 0, wardedCtx);
  check(JSON.stringify(warded) === before && wardedCtx.charm.wards[ME][0] === 0,
    'PILFER burns WARD and steals nothing, even when its receiver is full', { warded, wardedCtx });

  const scored: GameState = [[[1, 1, 1], [], []], [[4, 5, 6], [], []]];
  const scoredCtx = context({ mode: COLSHIELD });
  scoredCtx.charm.wards[ME][0] = 1;
  check(swingOf(scored, AI, pilfer, 0, COLSHIELD, scoredCtx) === 15,
    'PILFER values removing the enemy scoring WARD even though no die flies',
    swingOf(scored, AI, pilfer, 0, COLSHIELD, scoredCtx));

  const sealed: GameState = [[[6, 6, 6], [2], []], [[1], [], []]];
  const intercepted = context({ mode: COLSHIELD });
  intercepted.charm.wards[AI][0] = 1;
  const sealedBefore = String(sealed[AI][0]);
  check(pilfer.legal(sealed, ME, 0, intercepted),
    'a WARD makes the hostile PILFER attempt legal so it can dispel the mark');
  pilfer.apply(sealed, ME, 0, intercepted);
  check(String(sealed[AI][0]) === sealedBefore && intercepted.charm.wards[AI][0] === 0,
    'intercepted PILFER may not shrink the sealed column', { sealed, intercepted });
}

/* WARD keeps its ×1.5 registry scale. Hard is floored at Normal demand 16,
   while Easy retains its higher 30 demand. */
{
  const ward = spell('ward');
  const threshold: GameState = [[[6, 6], [], []], [[], [], []]];
  check(machineCast(threshold, AI, ward, context(), 16) === 0,
    'Normal WARD casts when bonus plus strikeable score reaches 16 × 1.5');
  check(machineCast(threshold, AI, ward, context(), 10) === 0,
    'Hard WARD demand is floored at Normal 16, retaining the same 24-point threshold');
  check(machineCast(threshold, AI, ward, context(), 30) === null,
    'Easy keeps its higher global demand and 45-point WARD threshold');
  const below: GameState = [[[5, 6], [], []], [[], [], []]];
  check(machineCast(below, AI, ward, context(), 16) === null,
    'a 22-point distinct-plus-strikeable WARD valuation stays below the 24-point floor');
  const fullDistinct: GameState = [[[4, 5, 6], [], []], [[], [], []]];
  check(machineCast(fullDistinct, AI, ward, context({ mode: COLSHIELD }), 16) === null,
    'an already-shielded target is legal but its 15-point score bonus alone does not force a cast');
}

console.log(JSON.stringify({ problems, errs: [] }, null, 2));
process.exit(problems.length ? 1 : 0);
