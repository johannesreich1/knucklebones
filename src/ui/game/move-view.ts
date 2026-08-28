// One visible move pipeline for every driver. Callers supply cancellation,
// charm and cadence; placement, scoring, protection and destruction stay shared.
import {
  BOUNTY,
  SPEC,
  boardTotalMode,
  isShielded,
  openStrikes,
  type CharmSt,
  type Player,
} from '../../core/rules.ts';
import { formatNumber } from '../../i18n/index.ts';
import { S } from '../../state.ts';
import { Sfx, vibrate } from '../audio.ts';
import { setStageDie } from '../die.ts';
import { $, colEl, slotEl, slotIdx } from '../dom.ts';
import { REDUCED, burst, floatPts } from '../fx.ts';
import { colorOf, heatOf } from '../identity.ts';
import { spellHue } from '../spellicons.ts';
import { renderSide } from './board.ts';
import { bountyPresentationNow, clearBountyPresentation } from './bounty-presentation.ts';
import { destroyAt, destroySunderStrikes } from './destruction-view.ts';
import { shieldBlocked } from './seals.ts';
import { playWardStrike } from './ward-strike.ts';
import { flyDieToSlot } from './motion.ts';
import { settleWardBreak } from './ward-score.ts';
import { clearSunderPresentation } from './sunder-presentation.ts';

const pause = (ms: number): Promise<void> => new Promise((resolve) => setTimeout(resolve, ms));

export interface GameViewSpec {
  /* Captures a local generation or an exact ranked-match identity. */
  isCurrent: () => boolean;
  /* Ranked may paint a remotely supplied face before its flight. */
  stageDieBeforeFlight?: boolean;
  /* A reconstructed/full authoritative column must not target a fourth slot. */
  flyOnlyIntoOpenSlot?: boolean;
  placeVibration?: boolean;
  celebrateMultiplier?: boolean;
  afterPlacementMs?: number;
  afterMoveMs?: number;
  /* Local spells supply their charm; plain/ranked games omit it. */
  charm?: CharmSt;
  onPlaced?: () => void;
}

export interface GameViewResult {
  placed: boolean;
  interrupted: boolean;
  destroyed: number;
}

export async function animateGameMove(
  who: Player,
  col: number,
  die: number,
  spec: GameViewSpec,
): Promise<GameViewResult> {
  /* A superseded move/restart may have removed the old board before its async
     owner observed cancellation. Start every shared move from a clean grid. */
  clearBountyPresentation();
  const sundered = !!spec.charm?.sunder[who];
  if (spec.stageDieBeforeFlight) setStageDie(die, who);
  const openSlot = S.boards[who][col].length < SPEC.rows;
  if (openSlot || !spec.flyOnlyIntoOpenSlot) await flyDieToSlot(who, col, die);
  if (!spec.isCurrent()) {
    if (sundered) clearSunderPresentation();
    return { placed: false, interrupted: true, destroyed: 0 };
  }

  const wards = spec.charm?.wards[who];
  const nativeBefore = boardTotalMode(S.boards[who], S.scoring);
  const before = boardTotalMode(S.boards[who], S.scoring, wards);
  S.boards[who][col].push(die);
  spec.onPlaced?.();
  Sfx.place();
  if (spec.placeVibration) vibrate(12);
  setStageDie(0);
  $('#dieStage').classList.remove('sundered');
  renderSide(who, !REDUCED);
  const placementLandedAt = bountyPresentationNow();

  const nativeGain = boardTotalMode(S.boards[who], S.scoring) - nativeBefore;
  const gain = boardTotalMode(S.boards[who], S.scoring, wards) - before;
  const wardDelta = gain - nativeGain;
  // A WARD distinct-face bonus is not native ×2 matching feedback.
  const multiplied = nativeGain > die;
  const signedGain = (gain < 0 ? '−' : '+') + formatNumber(Math.abs(gain));
  floatPts(who, col, signedGain, wardDelta ? spellHue('ward') : multiplied ? heatOf(who) : colorOf(who));
  if (multiplied && spec.celebrateMultiplier) {
    Sfx.mult();
    const rect = colEl(who, col)?.getBoundingClientRect();
    if (rect) burst(rect.left + rect.width / 2, rect.top + rect.height / 2, heatOf(who), 10);
  }

  if (spec.afterPlacementMs) await pause(spec.afterPlacementMs);
  if (!spec.isCurrent()) {
    if (sundered) clearSunderPresentation();
    return { placed: true, interrupted: true, destroyed: 0 };
  }

  // openStrikes consumes SUNDER once and is replay truth; ranked omits charm.
  const strikes = openStrikes(S.boards, who, col, die, S.scoring, spec.charm);
  const foe = (1 - who) as Player;
  const wardAnswersShield = strikes.some((strike) => strike.col === col && strike.warded);
  if (!wardAnswersShield && isShielded(S.boards[foe][col], S.scoring) && S.boards[foe][col].includes(die)) {
    shieldBlocked(foe, col);
  }

  let destroyed = 0;
  try {
    /* Wards answer first, then every unwarded SUNDER victim collapses in one
       batch. Ordinary placement keeps its established per-column pipeline. */
    for (const strike of strikes) {
      if (!spec.isCurrent()) return { placed: true, interrupted: true, destroyed };
      if (strike.warded && spec.charm) {
        const sourceIndex = S.boards[who][col].length - 1;
        const source = slotEl(who, col, slotIdx(who, sourceIndex))?.firstElementChild as HTMLElement | null;
        const completed = await playWardStrike({
          attacker: who,
          target: foe,
          targetColumn: strike.col,
          source,
          isCurrent: spec.isCurrent,
          impact: () => settleWardBreak(foe, strike.col, () => spec.charm!.wards[foe][strike.col]--),
        });
        if (!completed || !spec.isCurrent()) {
          return { placed: true, interrupted: true, destroyed };
        }
        renderSide(foe, true);
        continue;
      }
      if (sundered) continue;
      const result = await destroyAt(who, foe, strike.col, die, placementLandedAt, spec.isCurrent);
      if (result.interrupted) return { placed: true, interrupted: true, destroyed };
      destroyed += result.destroyed;
    }
    if (sundered) {
      const result = await destroySunderStrikes(
        who,
        foe,
        strikes.filter((strike) => !strike.warded),
        spec.isCurrent,
      );
      if (result.interrupted) return { placed: true, interrupted: true, destroyed };
      destroyed += result.destroyed;
    }
  } finally {
    clearBountyPresentation();
    if (sundered) clearSunderPresentation();
  }

  if (S.scoring === BOUNTY && destroyed) {
    S.bounty[who] += destroyed;
    floatPts(who, col, '+' + formatNumber(destroyed) + ' ✦', heatOf(who));
    renderSide(who, true);
  }
  if (spec.afterMoveMs) await pause(spec.afterMoveMs);
  return { placed: true, interrupted: !spec.isCurrent(), destroyed };
}
