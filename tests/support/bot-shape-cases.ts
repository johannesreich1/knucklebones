// §4's bot shapes, pinned: what a bot of each league IS, what a personality
// may shift, and the cells docs/LADDER.md publishes. Split out of
// tests/ladder.test.ts, which owns the ladder's own arithmetic — points,
// groups, settlement — while this owns the strength curve those groups carry.
//
// eq/problems arrive from the entry suite so a failure lands in the array its
// exit code reads; a support module with its own would report to nobody.
import { readFileSync } from 'node:fs';
import {
  APEX, GROUPS, GROUPS_V1, LADDER_CURVE_V1, LADDER_CURVE_V2,
  botShapeAt, personalitySlipOffset, type LadderCurveVersion,
} from '../../src/core/ladder.ts';
import { LEAGUE_CELL_BASELINE } from './bot-calibration.ts';

export interface BotShapeCaseHarness {
  eq: (got: unknown, want: unknown, what: string) => void;
  problems: string[];
}

export function runBotShapeCases({ eq, problems }: BotShapeCaseHarness): void {
  /* ---- §4 difficulty and matchmaking ------------------------------------- */
  /* A bot plays the shape of its OWN group — the label IS the strength. The
     numbers were tuned by simulation (2026-08-20; full curve corrected
     2026-08-26 after the 0–0 seat-perspective report); botbench keeps the
     human-favoured outcome curve honest, this table just pins the shapes. */
  eq(GROUPS.map((g) => [
    g.bot.depth, g.bot.risk, g.bot.oppW, g.bot.slip, g.bot.openerSlip, g.bot.castDemand,
    Number.isFinite(g.bot.freeUpgrade) ? g.bot.freeUpgrade : 'any column',
  ]), [
    [1, 0, -0.5, 0.70, 0.70, 16, 'any column'], [1, 0, 0, 0.70, 0.70, 16, 'any column'],
    [1, 0.25, 0.05, 0.70, 0.70, 16, 8], [1, 0.6, 1, 0.84, 0.795, 32, 8], [2, 1.2, 1, 0.78, 0.74, 20, 8],
    [3, 1.2, 1, 0.74, 0.70, 16, 8], [4, 1.2, 1, 0.58, 0.61, 24, 8],
  ], 'the per-group bot shapes drifted from LADDER.md §4');
  const standing = (points: number, apex = false) => ({ points, apex });
  eq(botShapeAt(standing(148)), GROUPS[0].bot, 'a bot with STONE points must play the STONE shape');
  /* NEON is a POSITION for bots too: a bot whose points outgrow OBSIDIAN keeps
     OBSIDIAN's shape until the board's rank says otherwise (boardGroup's rule,
     consumed by botShapeAt). Live 2026-09-02: nine v1 bots at 4,369–4,600
     badged OBSIDIAN were playing NEON, and the v1→v2 remap carries them to
     6,121–6,497 against a 6,090 floor. */
  eq(botShapeAt(standing(9999, true)), APEX.bot, 'the apex position grants the NEON shape');
  eq(botShapeAt(standing(6100)), GROUPS[GROUPS.length - 2].bot,
    'a 6,100-point bot without the apex position must play the OBSIDIAN shape');
  eq(botShapeAt(standing(500, true), LADDER_CURVE_V2), APEX.bot,
    'the apex is a POSITION — points do not veto the NEON shape');
  eq(botShapeAt(standing(4400), LADDER_CURVE_V1), GROUPS_V1[GROUPS_V1.length - 2].bot,
    'the live 4,369–4,600 v1 bots without the position play OBSIDIAN');
  /* the floor's floor: slip alone bottoms out at random-parity (a half-greedy
     still wins 60% vs random, measured), so STONE is KILL-AVERSE — negative
     oppW prefers placements that spare the player's dice, the one below-random
     weakness that reads as a beginner rather than a drunk */
  eq(botShapeAt(standing(0)).oppW < 0, true, 'the STONE bot must actively spare the player');
  eq(botShapeAt(standing(0)).slip >= 0.3, true, 'a brand-new player must meet a bot that blunders');
  /* ---- personalities: a league is a distribution, not a single opponent ----
     From GOLD up a bot with a profile id plays its own slip rate, drawn once
     from that id and fixed for its life. The league is still the identity: the
     draw moves slip alone, never depth, sight or knowledge, and never past the
     mean of the league above. */
  const idShape = (points: number, id?: string, apex = false,
                   version: LadderCurveVersion = LADDER_CURVE_V2) =>
    botShapeAt({ points, apex, id }, version);
  eq(idShape(GROUPS[3].floor, 'any-id'), GROUPS[3].bot,
    'SILVER and below must play their league mean exactly: onboarding is unconditional');
  eq(idShape(GROUPS[4].floor), GROUPS[4].bot,
    'a bot with no id must get the registry shape itself');
  {
    /* The raw draw, before any league's cap trims it. */
    const offsets = new Map<number, number>();
    for (let n = 0; n < 2000; n++) {
      const offset = personalitySlipOffset(`personality-${n}`);
      offsets.set(offset, (offsets.get(offset) ?? 0) + 1);
    }
    const share = (test: (offset: number) => boolean) => [...offsets.entries()]
      .filter(([offset]) => test(offset)).reduce((sum, [, n]) => sum + n, 0) / 2000;
    const mean = [...offsets.entries()].reduce((sum, [offset, n]) => sum + offset * n, 0) / 2000;
    eq([share((o) => Math.abs(o) <= 0.02) >= 0.85, share((o) => o === -0.04) >= 0.05,
      share((o) => o === -0.08) >= 0.005, mean < 0 && mean > -0.01], [true, true, true, true],
    'the personality draw lost its shape: most bots near their league, a few sharper, rarely one much sharper');
    let strongest: string | null = null;
    for (let n = 0; n < 10_000 && !strongest; n++) {
      if (idShape(GROUPS[4].floor, `personality-${n}`).slip === GROUPS[5].bot.slip) {
        strongest = `personality-${n}`;
      }
    }
    eq(strongest !== null, true, 'no GOLD id reached the cap in 10,000 draws — the tail vanished');
    if (strongest) {
      const capped = idShape(GROUPS[4].floor, strongest);
      eq([capped.slip, capped.openerSlip], [GROUPS[5].bot.slip, GROUPS[5].bot.openerSlip],
        "the strongest GOLD personality must stop at OBSIDIAN's mean, never pass it");
      eq([capped.depth, capped.risk, capped.oppW, capped.castDemand],
        [GROUPS[4].bot.depth, GROUPS[4].bot.risk, GROUPS[4].bot.oppW, GROUPS[4].bot.castDemand],
        'a personality moved something other than slip');
      /* Points map to different leagues on the two curves, so the same id is
         asked at each curve's own GOLD floor. */
      eq(idShape(GROUPS_V1[4].floor, strongest, false, LADDER_CURVE_V1).slip,
        GROUPS_V1[5].bot.slip, 'the same bot must have the same personality on either curve');
    }
    /* The apex is a POSITION, so its personality is asked of a bot the board
       actually ranks there. */
    let apexTail: string | null = null;
    for (let n = 0; n < 10_000 && !apexTail; n++) {
      if (personalitySlipOffset(`apex-${n}`) === -0.08) apexTail = `apex-${n}`;
    }
    eq(apexTail !== null, true, 'no NEON id drew the heavy tail in 10,000 draws');
    if (apexTail) {
      eq(idShape(GROUPS[6].floor, apexTail, true).slip, +(GROUPS[6].bot.slip - 0.04).toFixed(3),
        'the apex has no league above it, so its own tail must stop at -0.04');
    }
  }

  /* Search understanding still tightens on the way up. Slip is the measured
     counterweight that keeps deeper search from making any bot the favourite. */
  {
    let pv = GROUPS[0].bot;
    for (const g of GROUPS) {
      if (g.bot.depth < pv.depth) problems.push(`${g.id}: search depth fell`);
      if (g.bot.risk < pv.risk - 1e-9) problems.push(`${g.id}: risk sense fell`);
      if (g.bot.oppW < pv.oppW) problems.push(`${g.id}: board sight fell`);
      pv = g.bot;
    }
  }

  /* ---- §4's published cells are the bench's ------------------------------- */
  /* docs/LADDER.md §4 prints the human-share cells botbench measures; the
     bench pins them in bot-calibration and this check holds the doc to the pin,
     so the table can never again publish a number the gate no longer measures
     (GOLD's bot-opens cell read 55.0 while the bench measured 53.4). Paste the
     bench's `ladderSection4` rows into the doc when the baseline moves. */
  {
    const ladder = readFileSync('docs/LADDER.md', 'utf8');
    const section4 = ladder.split('\n## 4b.')[0].split('\n## 4.')[1] ?? '';
    for (const [id, cell] of Object.entries(LEAGUE_CELL_BASELINE)) {
      const row = new RegExp(`^\\| ${id.toUpperCase()} \\|.*\\*\\*([\\d.]+)%\\*\\* \\| \\*\\*([\\d.]+)%\\*\\* \\|$`, 'm')
        .exec(section4);
      eq(row && [Number(row[1]), Number(row[2])], [cell.humanOpens, cell.botOpens],
        `docs/LADDER.md §4's ${id} row is stale — paste botbench's ladderSection4 output`);
    }
  }
}
