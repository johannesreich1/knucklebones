// One attacking die's flight into a painted ward clasp: approach, contact and
// W3's long recoil. The seal's own geometry and one-shot beats stay in
// seals.ts, which this owner only asks for the clasp's page-space target; the
// travelling copy, its timing vocabulary and its interrupt contract are here.
import { type Player } from '../../core/rules.ts';
import { faceRotated } from '../dom.ts';
import { REDUCED } from '../fx.ts';
import { wardClaspRect } from './seals.ts';
import { pinDieGhost, playSpellAnimation } from './spell-motion.ts';

const WARD_APPROACH_MS = 640;
const WARD_RECOIL_MS = 1024;
const WARD_REBOUND_MS = 384;
const WARD_CONTACT_GAP = 4;
const WARD_REBOUND_PROGRESS = 130 / 174;
const WARD_HIT_EASING = 'cubic-bezier(.3,1.5,.4,1)';

export interface WardStrikeSpec {
  attacker: Player;
  target: Player;
  targetColumn: number;
  source: HTMLElement | null;
  isCurrent: () => boolean;
  impact: () => void;
}

/* Only a hostile action that openStrikes has proved reaches WARD calls this.
   Usually it would take victims; on a full COLUMN SHIELD column it instead
   burns the scoring WARD while the permanent shield keeps every die. The copy
   starts on the settled attacker, meets the transformed centre-facing clasp,
   then follows W3's long recoil while that spendable clasp snaps. */
export async function playWardStrike(spec: WardStrikeSpec): Promise<boolean> {
  const target = wardClaspRect(spec.target, spec.targetColumn);
  if (REDUCED || !spec.source || !target) {
    if (!spec.isCurrent()) return false;
    spec.impact();
    return true;
  }

  const classes = ['ward-strike-ghost'];
  if (faceRotated(spec.attacker)) classes.push('p2flip');
  const pinned = pinDieGhost(spec.source, { classes, zIndex: 66 });
  const centreDelta = pinned.deltaTo(target);
  const distance = Math.hypot(centreDelta.x, centreDelta.y) || 1;
  const unit = { x: centreDelta.x / distance, y: centreDelta.y / distance };
  /* W3 lands the die's leading edge just shy of the clasp. Centre-to-centre
     made a full die dive halfway through the tiny rivet and obscured the one
     piece of the seal the strike is meant to explain. */
  const edge = Math.abs(unit.x) * pinned.sourceRect.width / 2
    + Math.abs(unit.y) * pinned.sourceRect.height / 2;
  const contact = {
    x: centreDelta.x - unit.x * (edge + WARD_CONTACT_GAP),
    y: centreDelta.y - unit.y * (edge + WARD_CONTACT_GAP),
  };
  const translated = (amount: number): string =>
    `translate(${contact.x * amount}px,${contact.y * amount}px)`;

  try {
    const arrived = await playSpellAnimation(pinned.ghost, [
      { transform: translated(0), opacity: 1, easing: WARD_HIT_EASING },
      { transform: translated(1), opacity: 1, easing: WARD_HIT_EASING },
    ], { duration: WARD_APPROACH_MS, easing: 'linear' }, spec.isCurrent);
    if (!arrived || !spec.isCurrent()) return false;

    spec.impact();

    const recoiled = await playSpellAnimation(pinned.ghost, [
      {
        transform: translated(1),
        opacity: 1,
        easing: WARD_HIT_EASING,
      },
      {
        transform: translated(WARD_REBOUND_PROGRESS),
        offset: WARD_REBOUND_MS / WARD_RECOIL_MS,
        opacity: .72,
        easing: WARD_HIT_EASING,
      },
      {
        transform: translated(0),
        opacity: 0,
        easing: WARD_HIT_EASING,
      },
    ], { duration: WARD_RECOIL_MS, easing: 'linear' }, spec.isCurrent);
    return recoiled;
  } finally {
    pinned.remove();
  }
}
