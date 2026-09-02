// A bot's personality: how much this particular bot's attention wanders,
// fixed for its life. Two GOLD bots have always been the same opponent wearing
// different names; a league that is a single point is not how a league of
// people feels, and a bot that is consistently a little sharper becomes a
// rival you recognise — "NovaDice434 again" — which is only possible if the
// difference belongs to the BOT and stays put.
//
// So this is a per-BOT draw, never a per-move one: keyed by the profile id, so
// the same bot is always this strong, on either curve, in every match. It
// moves SLIP alone — the one knob measured to move strength (docs/LADDER.md
// §4) — never depth, never board sight, never what the bot knows. And it is
// bounded by the league above, so the badge on the other side of the table
// never lies by more than one league's mean.
//
// The variance is self-limiting in production: bots settle real points, so a
// bot whose shape wins drifts up toward the group that plays like it, and
// pairing hands out bots by points.
import { randStream } from './dice.ts';
import { type BotShape, type Group } from './ladder-groups.ts';

/** GOLD. STONE through SILVER play their league's mean exactly: the
    onboarding promise is unconditional, and a beginner meeting a bot that
    happens to be a sharp one is exactly what it protects against. */
export const PERSONALITY_FIRST_INDEX = 4;

/* The apex has no league above to bound it, so its tail is bounded here
   instead: at −0.08 the strongest NEON bot would sit under the payout
   break-even against a newcomer, which is the one thing no league may do. */
export const APEX_MAX_OFFSET = -0.04;

/* Heavy-tailed and one-sided toward strength: most bots are within a point of
   their league, a few are a noticeably harder game, and rarely one is the bot
   people remember. Quantised to a thousandth so a shape stays printable and
   pinnable. */
export function personalitySlipOffset(botId: string): number {
  const u = randStream(`${botId}#personality`)();
  if (u < 0.02) return -0.08;
  if (u < 0.10) return -0.04;
  return Math.round((-0.02 + 0.04 * ((u - 0.10) / 0.90)) * 1000) / 1000;
}

/* The shape this particular bot plays. Without an id — the bench measuring a
   league, a test naming a shape — the registry object comes back untouched,
   identity and all. */
export function personalShape(group: Readonly<Group>, groups: readonly Readonly<Group>[],
                              botId?: string): BotShape {
  if (botId === undefined) return group.bot;
  const index = groups.indexOf(group);
  if (index < PERSONALITY_FIRST_INDEX) return group.bot;
  const next = groups[index + 1]?.bot;
  const offset = next ? personalitySlipOffset(botId)
    : Math.max(personalitySlipOffset(botId), APEX_MAX_OFFSET);
  if (offset === 0) return group.bot;
  /* Never sharper than the mean of the league above: a bot may be the hardest
     GOLD there is, and never a quiet OBSIDIAN. */
  const bound = (rate: number, ceiling: number | undefined) =>
    Math.round(Math.max(rate + offset, ceiling ?? -Infinity) * 1000) / 1000;
  return Object.freeze({
    ...group.bot,
    slip: bound(group.bot.slip, next?.slip),
    openerSlip: bound(group.bot.openerSlip, next?.openerSlip),
  });
}
