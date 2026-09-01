// Versioned league thresholds and their calibrated bot identities. Numeric
// settlement remains in ladder.ts; this registry owns classification only.

export const LADDER_CURVE_V1 = 1 as const;
export const LADDER_CURVE_V2 = 2 as const;
export type LadderCurveVersion = typeof LADDER_CURVE_V1 | typeof LADDER_CURVE_V2;
export const LADDER_CURVE_VERSION: LadderCurveVersion = LADDER_CURVE_V2;

/* How a bot of this group plays. The shape belongs to the GROUP, not to the
   player it faces: the rank badge is the strength rather than theatre.
     depth — expectimax plies
     risk  — how much it fears what the opponent can destroy
     oppW  — how much of the opponent board its evaluation sees
     slip / openerSlip — random-build share for either seat. */
export interface BotShape {
  depth: number;
  risk: number;
  oppW: number;
  slip: number;
  openerSlip: number;
}

export interface Group {
  id: string;
  floor: number;
  width: number;
  bot: BotShape;
}

/* Bot shapes are deliberately unchanged by the curve migration: v2 changes
   progression cadence, not calibrated play. The production-weighted bench
   owns these values (docs/LADDER.md, tests/botbench.test.ts). */
const GROUP_BOTS: readonly BotShape[] = Object.freeze([
  Object.freeze({ depth: 1, risk: 0, oppW: -0.5, slip: 0.70, openerSlip: 0.70 }),
  Object.freeze({ depth: 1, risk: 0, oppW: 0, slip: 0.70, openerSlip: 0.70 }),
  Object.freeze({ depth: 1, risk: 0.25, oppW: 0.05, slip: 0.60, openerSlip: 0.60 }),
  Object.freeze({ depth: 1, risk: 0.6, oppW: 1, slip: 0.72, openerSlip: 0.675 }),
  Object.freeze({ depth: 2, risk: 1.2, oppW: 1, slip: 0.68, openerSlip: 0.67 }),
  Object.freeze({ depth: 3, risk: 1.2, oppW: 1, slip: 0.68, openerSlip: 0.66 }),
  Object.freeze({ depth: 4, risk: 1.2, oppW: 1, slip: 0.66, openerSlip: 0.65 }),
]);

const makeGroup = (id: string, floor: number, width: number, botIndex: number): Readonly<Group> =>
  Object.freeze({ id, floor, width, bot: GROUP_BOTS[botIndex] });

export const GROUPS_V1: readonly Readonly<Group>[] = Object.freeze([
  makeGroup('stone', 0, 300, 0),
  makeGroup('bone', 300, 420, 1),
  makeGroup('ivory', 720, 540, 2),
  makeGroup('silver', 1260, 750, 3),
  makeGroup('gold', 2010, 990, 4),
  makeGroup('obsidian', 3000, 1350, 5),
  makeGroup('neon', 4350, 0, 6),
]);

export const GROUPS_V2: readonly Readonly<Group>[] = Object.freeze([
  makeGroup('stone', 0, 360, 0),
  makeGroup('bone', 360, 480, 1),
  makeGroup('ivory', 840, 650, 2),
  makeGroup('silver', 1490, 1000, 3),
  makeGroup('gold', 2490, 1400, 4),
  makeGroup('obsidian', 3890, 2200, 5),
  makeGroup('neon', 6090, 0, 6),
]);

/** Active/default registry. Rollout-aware callers pass an explicit version. */
export const GROUPS = GROUPS_V2;
export const LEGACY_LADDER_GROUPS_V1 = GROUPS_V1;

export function groupsForCurve(
  version: LadderCurveVersion = LADDER_CURVE_VERSION,
): readonly Readonly<Group>[] {
  if (version === LADDER_CURVE_V1) return GROUPS_V1;
  if (version === LADDER_CURVE_V2) return GROUPS_V2;
  throw new RangeError(`Unknown ladder curve version: ${String(version)}`);
}

/** Preserve the v1 league and its local ring progress on the v2 curve. */
export function remapLadderPointsV1ToV2(oldPoints: number): number {
  if (!Number.isInteger(oldPoints) || oldPoints < 0) {
    throw new RangeError('Ladder points must be a non-negative integer.');
  }
  let index = 0;
  for (let candidate = 1; candidate < GROUPS_V1.length - 1; candidate++) {
    if (oldPoints >= GROUPS_V1[candidate].floor) index = candidate;
  }
  const oldGroup = GROUPS_V1[index];
  const newGroup = GROUPS_V2[index];
  const progress = (oldPoints - oldGroup.floor) / oldGroup.width;
  return newGroup.floor + Math.round(progress * newGroup.width);
}

/* NEON is positional. Its numeric floor is only the small-population fallback
   used before a top one percent is meaningful. */
export const APEX = GROUPS[GROUPS.length - 1];
export const APEX_SHARE = 0.01;

export function apexForCurve(
  version: LadderCurveVersion = LADDER_CURVE_VERSION,
): Readonly<Group> {
  const groups = groupsForCurve(version);
  return groups[groups.length - 1];
}
