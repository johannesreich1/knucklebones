# The Ladder — points, groups, seasons

*Spec, and as of 2026-08-20 the shipped design: ALL of §1–§6 are live —
core/ladder.ts, migrations 0016–0024, pvp-move v13 / pvp-claim v10 /
pvp-join v16, and the profile, avatar picker and match history in the client.
§4 was reworked the same evening: bot strength moved from the human's
percentile to the bot's own group.*

*This is the thing to argue with before more of it becomes code. Every number was measured, not chosen — the
simulations are in `docs/LADDER.md`'s appendix and were run against 800–900
simulated players with skill ~N(0, 180).*

The ladder replaces a plain Elo rating with a **ladder score**: one number,
starting at zero, that a player climbs. It is not Elo any more — Elo is
zero-sum and centred, and this deliberately is neither — but it keeps Elo's
one genuinely good idea: what a match is worth depends on who you played.

---

## 1. Ladder points

| | |
|---|---|
| Start | **0** |
| Floor | **0** — a loss at zero costs nothing |
| Scale | **×5** relative to classic Elo |
| K | **160** (= 32 × 5) |
| Logistic denominator | **2000** (= 400 × 5) |
| Loss multiplier | **0.75** |
| Minimum gain | **+30** |
| Maximum loss | **−120** |

```
expected  = 1 / (1 + 10 ^ ((opponent - me) / 2000))
raw       = round(160 * (score - expected))          score = 1 | 0.5 | 0
delta     = raw > 0 ? max(raw, 30) : max(round(raw * 0.75), -120)
points    = max(0, points + delta)
```

**The denominator must scale with the points.** This is the one thing that is
easy to get wrong and expensive to notice: at scale ×5 a 400-point gap is a
*small* gap, so the 400 in the exponent has to become 2000. Leaving it at 400
compresses the whole range and costs 8 points of skill fidelity (0.902 →
0.821, measured). If the scale ever changes, both K and the denominator change
with it.

### What a match is worth

Never previewed anywhere in the UI — it depends on the opponent, so any number
shown *before* a match is wrong about half the time. It appears after: on the
result screen, and in match history.

| opponent | win | loss |
|---|---|---|
| 2,000 above you | +145 | −11 |
| 1,000 above you | +122 | −28 |
| 500 above you | +102 | −43 |
| level with you | **+80** | **−60** |
| 500 below you | +58 | −76 |
| 1,000 below you | +38 | −91 |
| 2,000 below you | +30 | −109 |

### Why a win pays more than a loss takes

Net drift at a 50% win rate is **+10 points a game**. The ladder climbs for
anyone who keeps playing, which is the intended feel, and it is the reason
seasons are mandatory rather than optional (§3).

| win rate | 45% | 50% | 55% | 60% | 70% |
|---|---|---|---|---|---|
| points/game | +3 | +10 | +17 | +24 | +38 |

Skill fidelity (rank correlation between points and true skill) measures
**0.902** under this rule — the ordering survives; everything simply shifts up.

---

## 2. Groups

Seven groups, and a group is the **whole** rank — there are no divisions
inside it.

Divisions were in the first draft: three per group, to give a nearer milestone
and a promotion that fires three times as often. They were paying for that by
cutting the ring into three segments. Once the ring fills as a **continuous
percentage of the group**, the bar already shows which part of it you are in
and how far the next one is — so "GOLD II" printed beside a ring reading 49%
was a second, worse way of saying the same fact. Nothing functional ever read
them: matchmaking pairs on points, the bots on their own group (§4), the leaderboard and
the apex on points and rank. They are gone.

What that costs is promotion *frequency* — group to group is 37 games at the
bottom and ~120 at OBSIDIAN, and that is now the only "you levelled up"
moment. What replaces it is better: the ring moves on **every single match**,
visibly, which is more feedback than a promotion every twenty-five games. It
does mean the ring has to earn it — it should animate when points land.

| group | floor | width | games to clear* |
|---|---|---|---|
| STONE | 0 | 300 | 37 |
| BONE | 300 | 420 | 36 |
| IVORY | 720 | 540 | 53 |
| SILVER | 1,260 | 750 | 74 |
| GOLD | 2,010 | 990 | 99 |
| OBSIDIAN | 3,000 | 1,350 | 120 |
| NEON | — | — | positional, see below |

\* measured with real matchmaking, so the win rate slides toward 50% as you
climb — that slide is why the later groups cost more than the widths alone
suggest.

Widths grow **×1.35** per group, and no longer need to divide by three. Equal widths were the first proposal and the
measurement killed them: every group took 64–77 games, so leaving STONE cost
the same as reaching OBSIDIAN. Two independent things now make climbing
harder as you go: each *match* pays less when you outrank your opponent, and
each *group* costs more points than the last.

### NEON is a position, not a threshold

**NEON = the top 1% of the current season.** Everything below it is a point
threshold; the apex is not.

This is not decoration. An always-climbing ladder with a floor is a ratchet:
given enough games *everyone* arrives at the top. Simulated over 600 games,
**735 of 900 players** ended above a fixed NEON threshold — at which point
NEON is a participation certificate, not a rank. As a top-1% cut it stays
scarce forever, whatever inflation does. Over one 250-game season: 81 players
on a fixed threshold, **11** on top-1%.

It also costs nothing extra, because the same percentile computation already
has to exist for §4.

### Demotion

**Groups can be lost.** There is no floor above 0.

The asymmetry is already the mercy — at a 50% win rate you drift *upward*, so
falling a group means genuinely losing more than you win. A floor on top of
that would make every group boundary risk-free and the ladder inert exactly
where it should be tense.

---

## 3. Seasons

Mandatory, because §1 inflates forever. Build the schema now even though the
UI shows nothing: retrofitting `season_id` onto matches means backfilling
every match ever played.

```sql
seasons(
  id          smallint primary key,
  name        text        not null,          -- 'Season 1'
  started_at  timestamptz not null default now(),
  ends_at     timestamptz,                   -- NULL = runs endlessly
  soft_reset  numeric     not null default 0.5
)

season_ratings(
  season_id  smallint references seasons,
  player     uuid     references profiles,
  points     integer  not null default 0,
  peak       integer  not null default 0,    -- the gold notch, and what survives a reset
  wins, losses, draws integer not null default 0,
  primary key (season_id, player)
)

matches.season_id smallint references seasons   -- stamped at creation
```

- `profiles.rating` stays as a mirror of the current season's points, so
  everything already reading it keeps working.
- The current season is the row with `ends_at is null`. Season 1 has
  `ends_at = NULL` and therefore runs until somebody decides otherwise.
- `leaderboard(limit_n, from_rank default 1, after_nickname default null)`
  exposes current-season rank windows. `(rank, nickname)` is the stable paging
  cursor because ladder ranks can tie.
- `leaderboard_before(limit_n, before_rank, before_nickname)` walks that same
  total order upward and returns the nearest preceding rows in display order.
  `player_standing()` is projected from the identical visible board, so its
  rank is always a valid anchor even when bot visibility or unplayed rows differ.
- The UI shows no season control until `count(seasons) > 1`. The profile
  already has the slot, hidden (design card 92d).

**Rollover**, whenever it is called: insert a new season, seed each player at
`round(old_points * 0.5)`, carry `peak` forward as a badge. Half is the usual
compromise — a good player starts ahead, but not so far ahead that a new
player can never catch up.

---

## 4. The bot's group is its strength

*Reworked 2026-08-20 (user report: "the bots are much too strong in STONE").
The first design keyed bot difficulty to the **human's percentile** — the
table this section used to hold. Replaying the reporter's nine live matches
from their seeds showed what that actually produced: every bot he faced
played the identical weak shape whoever wore it, so a 98-point STONE bot and
a 784-point IVORY bot were indistinguishable — the rank badge was theater.
And on a 17-row season (13 seeded bots, 4 humans) the "bottom 20%" band
ended at ~99 points, a third of the way through STONE.*

Now **a bot plays the shape of its own group** — the shape is a field of the
group registry (`core/ladder.ts GROUPS[].bot`, read by `botShapeAt(points)`),
so the label IS the strength. Difficulty still tracks the player, but through
**pairing**: `pvp-join` hands out bots within the player's own group width
(`botPairBand`), and mints new ones inside the same cap when none is free.
Bots' points move through real settles, so a bot whose shape loses drifts
down toward the group that plays like it — the label stays honest by
construction.

| group | depth | risk | sees your board | slip | win% vs random |
|---|---|---|---|---|---|
| STONE | 1 | 0 | **spares it** (`oppW -0.5`) | 55% | **42** |
| BONE | 1 | 0 | yes | 45% | 66 |
| IVORY | 1 | 0.25 | yes | 15% | 74 |
| SILVER | 1 | 0.6 | yes | 5% | 74 |
| GOLD | 2 | 1.2 | yes | — | 80 |
| OBSIDIAN | 3 | 1.2 | yes | — | 82 |
| NEON | 4 | 1.2 | yes | — | 81 |

Every number measured (seeded, `tests/botbench.test.ts` in the gate keeps
the ordering honest; `tests/ladder.test.ts` pins the shape numbers). The
deep groups separate against stronger anchors instead — NEON holds ≥50%
against the offline Medium.

**`oppW` is the floor's knob, and NEGATIVE is the floor's floor** (retuned
2026-08-21: "if I lose 50% in the beginning, I quit"). Slip alone cannot
make a gentle bot: the un-slipped half of a depth-1 greedy still takes every
kill, and even at 90% slip it holds random-parity (measured). At `oppW 0`
the eval never *aims* a destroy; below 0 it actively prefers placements that
SPARE the player's dice — passivity, the one below-random weakness that
reads as a beginner rather than a drunk. On a passive bot, slip is where
accidental kills sneak back in, so the gentlest honest shape is high-slip
AND kill-averse. In the production lens (the human is p1 and moves first vs
a bot): a newcomer who merely stacks beats STONE **76.6%** and even a random
mover wins 56.1%; against the slackened BONE the stacker still wins 59.0% —
the first promotion reads "harder now", never "losing now". Both rates are
gate-pinned (botbench §1c).

**Matchmaking width** (humans) is unchanged: few players near you → widen the
band; crowded → keep it tight (`players_near` + `matchBand`). Percentile
still exists where it belongs — `player_standing()` resolves the positional
apex and the profile's rank line.

**The mirror must start at 0.** `profiles.rating` kept its pre-ladder default
of 1000 through the cutover, so every new signup entered matchmaking rated
1000 — under this model that would hand every newcomer an IVORY-strength
first bot. Found live, fixed in migration 0024 (default → 0, stale mirrors
re-mirrored from `season_ratings`).

---

## 5. The profile

Design: card **92d** (`design/screens/product/92d-arc-season.html`). Built in
`online/ladder-screen.ts` + `online/online.css`.

**The ring is the screen.** ONE continuous fill — the percentage of the way
through your current group — and it **sweeps up to its value when the profile
opens**. That animation is load-bearing, not decoration: group promotions are
37 to ~120 games apart, so this fill is the ladder's only continuous feedback,
and a number that is simply *there* on arrival never reads as progress. It is
tweened in JS rather than by a CSS transition, because a conic-gradient's angle
stop does not interpolate reliably across engines; `REDUCED` motion skips
straight to the value.

Its 270° sweep starts at **225°** — 225 + 270 = 495 = 135 — so it runs
lower-left, up the left, over the top, down the right, to lower-right, leaving
a 90° gap centred on six o'clock with both ends at the same height. **The group
name sits in that gap**, which stops it being empty space and makes the ring
self-describing.

**Colour means LIVE.** Gold is the current points and nothing else. The peak
tile reads white and the peak notch is a neutral mark — a gold notch competed
with the live number while marking somewhere the player is no longer at.

**The peak notch**, in three states:

| state | notch |
|---|---|
| peak = current points | none — the fill's leading edge is the peak |
| peak ahead, inside this group | at its true position on the ring |
| peak in a higher group (demoted) | pinned at the far right, the upgrade point |

The invariant behind it: **the notch can never sit behind the fill**, because a
peak is by definition at least the current score. A new peak is simply pushed
along by the fill — one animation, no special case.

**Three facts, not four:** Rank · Best streak · Peak. The win/loss tally moved
to the head of **match history**, which is the list it summarises. It is not
labelled "record": in English that means both a win-loss tally and a personal
best, and in German only the second, so the word was quietly promising the
streak while showing the tally. `best_streak()` (migration 0021) computes the
longest run of wins over the whole season, so it cannot shrink as old matches
scroll out of a window.

There is **no "N to the next group"** line. The ring already says how far
along you are, and the exact remainder was a number nobody was going to act on.

**Avatar.** `profiles.avatar`, e.g. `"die:5:cy"` — a die face 1–6 and a hue, 36
identities, tap the avatar to change it. No storage bucket, no moderation, and
no user-generated-image obligations at App Store review. The string format is
the seam: a later value can be `"img:<storage-path>"` with no schema change.

**"Member since" is hidden for guests** — their account lives on this device
only, so the line would be a promise nobody made.

**Match history** is its own screen: opponent, result, score, and the delta the
match *actually* paid. It goes through the `match_history()` definer function
(migration 0020), because `profiles` is own-row only — a client-side join for
opponent nicknames returns nothing and every row reads "???", which is exactly
why the leaderboard is a definer function too.

**The result screen** names what the match paid in **points**, not Elo, and the
rank comes from `player_standing()` rather than scanning a leaderboard page for
your own nickname — which silently found nothing past rank 50.

**One ask-card** (`ui/askcard.ts`) serves every either/or question: quitting,
forfeiting, and deleting an account. They differ only in their words and
whether the confirm is guarded. Deletion uses that guard — a checkbox — rather
than a two-tap arm, which asks for the second tap in the very place the first
one landed: the one gesture a mis-tap repeats for free.

## 6. Migration plan

Ordered so the app is never broken between steps. Steps 1–3 are additive and
invisible; the ladder does not change behaviour until step 4.

1. **`0016_seasons.sql`** — `seasons`, `season_ratings`, `matches.season_id`.
   Insert Season 1 with `ends_at = NULL`. Backfill: every existing match gets
   `season_id = 1`; every profile gets a `season_ratings` row seeded from its
   current rating. Nothing reads the new tables yet.
2. **`0017_percentile.sql`** — a `player_percentile(uuid)` function and the
   index behind it. Nothing calls it yet.
3. **`core/ladder.ts`** — the pure module: `delta()`, `groupOf()`,
   `divisionOf()`, the band table. Pure, so it runs in the browser, in Node
   for the gate, and in Deno for the Edge Functions, like `core/modes.ts`.
   Ships with a test suite that pins the numbers in §1 and §2, and a
   simulation bench like `bench3` that fails if fidelity drops below 0.89.
4. **`pvp-move` v11** — writes `season_ratings.points` and `peak` through
   `core/ladder.ts`, stamps `matches.season_id`, and swaps its three absolute
   difficulty constants for `player_percentile()`. `profiles.rating` keeps
   being mirrored, so every existing reader survives untouched.
   **This is the step that changes what players see** and the one to verify
   live with throwaway guests before it goes near real accounts.
5. **`0018_leaderboard_seasons.sql`** — `leaderboard()` takes an optional
   season and returns `points`, `group`, `division`. NEON is resolved from
   position, not from the band table.
6. **Client** — the profile screen (card 92d), the avatar picker, match
   history, and the result screen showing the delta the match actually paid.
7. **`0019_avatar.sql`** — `profiles.avatar text default 'die:5:cy'`.

The implementation ledger later replaced the optional-season public overload
with current-season `(rank, nickname)` windows in
`20260823121000_ranked_leaderboard_windows.sql`; historical step 5 above records
the rollout order, not the current Data API signature.

### What the first live run taught

Two things bit, both worth keeping written down:

- **A table created by a migration grants `service_role` nothing.** RLS was
  never the mechanism — service_role bypasses that — plain table privileges
  are. Without the grant the ladder was silently read-only-empty: every read
  returned no rows, `ladderRow()` fell to its `0` default, and two live matches
  settled 0-vs-0 as though both players were unrated, while every write was
  discarded without an error anyone looked at. Any future table the Edge
  Functions touch needs the grant in the same migration that creates it.
- **`profiles.rating` is a mirror and has to be kept one.** 0016 seeded the
  bots across the ladder in `season_ratings` but left the mirror at 0, and
  pvp-join pairs on the mirror — so matchmaking saw a flat pool and the spread
  it had just been given did nothing. Whatever writes points writes both.

### The cutover: retire, do not wipe

Everyone starts Season 1 at **0**. Current ratings are on the old scale and
mean nothing under the new one, and the population is small enough that a
clean start is the honest option — 18 human profiles, of which **7** have ever
finished a match.

Deleting the old data would achieve the same clean start and cost more, so it
is not what happens. Instead the existing history is *retired into a
pre-season*:

- `seasons` gets **two** rows: id 0 `Pre-season`, `ends_at` = the cutover
  moment, and id 1 `Season 1`, `ends_at NULL`.
- All 119 existing matches are stamped `season_id = 0`. Nothing is deleted —
  2,359 moves and every finished game stay exactly where they are.
- `season_ratings` starts empty for Season 1; a row appears at 0 the first
  time a player is paired.
- `profiles.rating` (the mirror) resets to 0. This is the only value actually
  discarded, and it is reconstructible from `matches.p1_rating_delta` if
  anyone ever wants it back.
- The five abandoned `active` matches — all human-vs-bot, idle 4 hours to two
  days — are closed as forfeits before the switch, because a match must not
  span a scale change: it was started under one rating system and would settle
  under another.

This keeps match history working for the seven players who have any, and it
means the season machinery is exercised from day one — with a real pre-season
already sitting behind the current one, which is a far better test of it than
a single season could ever be.

### Seed the bots across the ladder

At Season 1 start every profile is at 0, so percentile is degenerate and there
is nothing to climb *into* — a new player's first opponent, their tenth and
their fiftieth would all be identical. The 13 bots are synthetic opponents and
their ratings were always hidden, so spread them across the groups at season
start: roughly two per group from STONE to the top of OBSIDIAN.

That gives matchmaking a populated ladder immediately, gives percentile
something to measure, and gives a new player a visible climb. It also matches
what migration 0013 already decided for the leaderboard — an empty ladder is a
worse lie than a populated one.

### Names

STONE · BONE · IVORY · SILVER · GOLD · OBSIDIAN · NEON — dice and bone
materials climbing toward the game's own neon. **Agreed 2026-08-20.**

---

## Appendix — the measurements

All runs: skill ~N(0, 180), pairing inside a ±150-at-scale window, seeded so
they reproduce. Scripts were run during design and are not in the repo; the
bench in step 3 is what keeps these honest going forward.

| question | answer |
|---|---|
| Does a bigger K widen the rank range? | **No.** K 32 → 200 widened p10–p90 only 670 → 1049 while fidelity fell 0.918 → 0.838. Elo self-corrects; bigger steps add noise, not range. Scaling the display is what actually widens it, at zero cost. |
| Does starting at 0 work? | **Yes.** p10 1,134 · median 2,677 · p90 4,286 · max 5,783. One player of 800 stuck at the floor. Fidelity 0.902. |
| Do equal group widths feel flat? | **Yes.** 64–77 games per group, every group. Widening ×1.35 gives 37 → 120. |
| Does a fixed top group stay scarce? | **No.** 735 of 900 players cleared it in 600 games. Top-1% is the fix. |
| Does the denominator matter? | **Yes.** Left at 400 instead of 2000: fidelity 0.821, range squashed. |

### Seating — who moves first, and why it is a handicap

**One rule, everywhere: the lower-rated player opens.** Every mode, human
opponent or bot. It is a deliberate equalizer, and its whole appeal is that it
fits in one sentence.

The advantage is **not the opening placement** — an empty board's three columns
are symmetric, so the first die carries no information. It is the **last word**:
who makes the final placement, whose destruction the opponent never answers.
The first mover reaches a full board about half a die sooner and takes that last
word 51–58% of the time.

Measured 2026-08-22 — 60,000 games per mode at the offline Medium anchor (depth
2, risk 0.9), three independent seeds, 95% CI ±0.40 — **first-mover win%**:

| classic | rowswitch | rowmult | colshield | singlestrike | bounty | limited |
|---|---|---|---|---|---|---|
| 50.74 | 51.37 | 51.51 | 52.65 | 52.05 | 49.91 | **46.63** |

**LIMITED inverts**, structurally: its bag holds an EVEN 24 dice and empties
before either board fills in ~45% of games, so the *second* mover lays the last
die — the first mover takes the last word only 28% of the time there. So in
LIMITED the handicap gives the underdog a seat worth about −3.4 points instead
of +0.

**That inversion is known and deliberately NOT corrected** (decision,
2026-08-22). It briefly was: `pvp-join` v19 shipped a `seatEdge` field on every
mode and flipped the seat under LIMITED. It was reverted within hours because a
seating rule that varies per mode makes every future mode carry a balance
question, and the edge being corrected is smaller than the confusion it buys.
LIMITED is 10% of the wheel and the error is ~3.4 points; the simpler rule wins.
`core/modes.ts` keeps the measurement and a note saying it is not to be acted on
without a decision — because the obvious thing to do with that table is act on
it, and someone already did.

**Bots take the same rule.** They used to be exempt by necessity — a bot only
moves inside a human's `pvp-move` request, so it could not make an opening move,
and the human was p1 in every bot match whatever either side was rated. With a
thin player pool most ranked matches are against bots, so "the handicap applies
except where most matches are" was the wrong shape. `pvp-join openForBot()` now
plays a bot's opening move at match creation, so a bot that is rated lower opens
exactly as a human would.

That required lifting the bot's move decision out of `pvp-move` into
`core/bot.ts` — one implementation, two callers — rather than copying it.
The extraction was proven identical to the block it replaced before deployment:
113,400 calls across all 7 modes and all 7 ladder groups, one seeded stream
driving both, **0 differences**. Note that `searchRoot` adds tie-break jitter
from the *global* `Math.random` (`core/ai.ts`), so any such comparison has to
seed the global stream, not just the injected one — seeding only the injected
stream compares two independently-random calls and reports ~16% false
mismatches, which is exactly what the first version of that probe did.

**Offline seating is unrelated and randomised.** A local game alternates who
opens, which is fair over a session — but `S.starter` used to begin at the
player and is deliberately not persisted, so it reset on every reload and a
one-game session always gave the player the first move. It is now drawn on a
coin flip per app load and alternates from there (`src/state.ts`).
