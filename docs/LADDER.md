# The Ladder — points, groups, seasons

*Spec. As of 2026-08-20, §1–§6 are live except for the explicitly marked
finish-margin target added to §1 on 2026-09-01 — core/ladder.ts, migrations
0016–0024, pvp-move v13 / pvp-claim v10 / pvp-join v16, and the profile,
avatar picker and match history in the client. §4 was reworked the same
evening: bot strength moved from the human's percentile to the bot's own
group.*

*This is the thing to argue with before more of it becomes code. The shipped
ladder numbers were measured rather than chosen — the simulations are in this
document's appendix and were run against 800–900 simulated players with skill
~N(0, 180). Later unshipped product targets identify their evidence and any
measurement still required.*

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
if score = 0.5 -> delta = 0                          a draw settles nothing
expected  = 1 / (1 + 10 ^ ((opponent - me) / 2000))
raw       = round(160 * (score - expected))          score = 1 | 0
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
result screen, and in match history. The table is the **currently shipped base
delta**. The decided finish-margin transfer below is not live yet.

| opponent | win | loss | draw |
|---|---|---|---|
| 2,000 above you | +145 | −11 | 0 |
| 1,000 above you | +122 | −28 | 0 |
| 500 above you | +102 | −43 | 0 |
| level with you | **+80** | **−60** | 0 |
| 500 below you | +58 | −76 | 0 |
| 1,000 below you | +38 | −91 | 0 |
| 2,000 below you | +30 | −109 | 0 |

### Decided finish-margin transfer — not shipped

*Decided and refined 2026-09-01.* Keep opponent strength as the primary signal,
then move a small, equal number of additional points from the loser to the
winner based on how decisive the final board was. The refinement deliberately
makes medium/large score gaps one point more expressive without widening the
agreed 2–7 envelope. For a normally completed decisive match:

```
score_gap          = winner_score - loser_score
winner_scale       = max(1, winner_score)
margin_share       = score_gap / winner_scale
requested_transfer = 2 + round(5 * margin_share)  // 2…7
winner_delta       = winner_base_delta + applied_transfer
loser_delta        = loser_base_delta  - applied_transfer
```

The requested minimum **2** makes every decisive finish register whenever the
loser has cap and floor room; the normalized margin can add up to five more. A
raw score gap is deliberately not used. The modes operate at different score
scales, so “won by 20” is not equally decisive in Classic and Row Multiply.
Dividing by the winner's score produces a dimensionless “how much of the
winning total was the lead?” share and keeps modes comparable. A normally
completed decisive match necessarily has a positive winning score; `max(1, …)`
is a defensive totality guard, not permission to settle invalid scores. `round`
is the shared TypeScript non-negative half-up convention (`Math.round`); SQL
and UI do not reimplement it.

This supersedes the earlier combined-score denominator. That version
concentrated about 69% of the probe's decisive results at 2–3 points.
Winner-relative normalization distributes the same 2–7 values more evenly, yet
for every legal decisive score its requested transfer is either unchanged or
exactly **one point larger**, never two. The player-facing bands are therefore
simple:

| score gap as share of winner's score | requested transfer |
|---:|---:|
| below 10% | 2 |
| 10% to below 30% | 3 |
| 30% to below 50% | 4 |
| 50% to below 70% | 5 |
| 70% to below 90% | 6 |
| 90% or more | 7 |

For a normal completion, only the server-authoritative final scores determine
the request. Settlement status selects the forfeit rule, and the locked
pre-settlement ladder rows plus base deltas limit what can actually be applied.
The client submits none of those calculations.

| both players at 1,000 points | superseded sum-based request | decided winner-relative request | final delta instead of +80 / −60 |
|---|---:|---:|---:|
| 41–39 | 2 | 2 | **+82 / −62** |
| 50–45 | 2 | 3 | **+83 / −63** |
| 50–40 | 3 | 3 | **+83 / −63** |
| 50–35 | 3 | 4 | **+84 / −64** |
| 60–30 | 4 | 5 | **+85 / −65** |
| 60–0 | 7 | 7 | **+87 / −67** |
| draw | 0 | 0 | **0 / 0** |

The applied transfer is antisymmetric: every extra point gained by the winner
is taken from the loser, so it adds no ladder-wide points. For an equal-rated
player whose decisive wins/losses and margin distributions are symmetric, the
expected drift remains +10 points per **decisive** match. With draw fraction
`q`, zero-paying draws make the all-match drift `10 × (1 - q)`. A player who
tends to win decisively and lose narrowly intentionally moves above that
expectation, while the reverse pattern moves below it. The seven-point ceiling
leaves opponent strength overwhelmingly dominant.

A deterministic read-only probe through the existing game harness measured the
size of the refinement before accepting it: 3,000 bare and 3,000 uniformly
equipped games for each of the seven mechanical outcomes, plus 6,000 Rune
Ritual games with the real common offer and independently seeded auto-picks
from that shared offer—48,000 games total. The displayed target-wheel mixture
uses the 21,000 equipped mechanical games plus the 6,000 Ritual games; the
21,000 bare games are a sensitivity cross-check and show the same direction.
Weighted as Classic 40% and each other outcome `60/7`, decisive requests changed
as follows:

| requested transfer | superseded sum-based share | decided winner-relative share |
|---:|---:|---:|
| 2 | 25.84% | 12.91% |
| 3 | 43.34% | 31.77% |
| 4 | 22.24% | 29.13% |
| 5 | 7.37% | 19.74% |
| 6 | 1.15% | 6.17% |
| 7 | 0.06% | 0.27% |

The mean request moved only **3.148 → 3.753** (+0.605), while 4+ became
visible in **55.3%** rather than 30.8% of decisive games and 5+ in **26.2%**
rather than 8.6%. Per-outcome winner-relative means stayed in a narrow
3.58–4.01 range, supporting the cross-mode normalization. This probe is design
evidence, not a retained ladder/progression simulation: its depth-2 Normal
policies do not model rating, margin/skill correlation, floor clipping, or the
target climb.

Two protections reduce the **applied** transfer below the requested 2–7 when
necessary:

1. The final loser delta may never pass the existing **−120** maximum. For
   example, a base upset loss of −118 has room for only a two-point transfer.
2. The loser must still have the points to fund the transfer after the base
   delta. If the zero-point floor would absorb some or all of it, that part is
   not credited to the winner. The finish transfer must not manufacture points
   at the floor.

Formally, before the final zero clamp:

```
loss_cap_room = max(0, 120 - abs(loser_base_delta))
floor_room    = max(0, loser_points_before + loser_base_delta)
applied_transfer = min(requested_transfer, loss_cap_room, floor_room)
```

A resignation, forfeit, stall timeout, or account-deletion settlement uses the
maximum requested transfer of **7**. Its partial board is not a trustworthy
margin, and quitting must not become a way to obtain the close-loss transfer.
The same loss-cap and floor protections still apply. A draw transfers zero.
Bot and human matches use the same settlement rule; weekly entry and Rune
Ritual do not create alternate ladder maths.

The result screen must keep the signed final delta as its primary number and
explain it with a compact base/finish breakdown—for example, **+83** with
“base +80 · finish +3”. Match history may keep the total as its compact row
value, but its authoritative record must retain enough information to reproduce
the breakdown. Like the base delta, the finish transfer is never previewed
before a match.

The requested 2–7 range is a product-feel decision, not a claim of production
calibration; the applied range is **0–7** because the two boundary protections
may reduce it. Before implementation ships, retained production-shaped
simulation must cover all seven modes, Rune Ritual, runes, realistic rating
gaps, bot and human-shaped outcomes, forfeits, the loss cap, the zero floor,
and promotion speed.

Persistence is explicit rather than reconstructive: keep the existing signed
total deltas, add a ladder-formula version, and store each seat's signed
**applied finish delta**. The base component is then `total - finish`, while
final scores plus status and formula version reproduce the requested transfer.
This records a floor/cap reduction even though the pre-settlement ladder
snapshot is not retained on every match. The total remains match history's
settlement authority; every terminal path and serialization retry must produce
the same versioned components exactly once.

### A draw pays nothing, to either side

*Decided 2026-08-28.* Elo would pay for a draw against a mismatch, and the
arithmetic is not silly: holding a player 2,000 above you used to pay **+65**,
and failing to convert against one 2,000 below cost **49**. Two things retired
it. Those numbers are reachable only by dice in this game — production has
recorded **no drawn match at all** in the first 30 played out — and a payout
nobody can aim for is the hardest of all to explain on a result screen.

Simulated at draw rates from 3% to 30% (skill-independent draws, 800 players,
250 games), ignoring them costs no skill fidelity and slightly gains it:
**+0.006** at a 3% draw rate, **+0.030** at 30%. A dice-driven result carries
no signal, so propagating it only propagates noise. `settle()` still records
the draw in the win/loss/draw tally; only the points stand still.

### Why a win pays more than a loss takes

At equal rating with wins and losses evenly split, net drift is **+10 points per
decisive game**. With draw fraction `q`, it is `10 × (1 - q)` across all games.
The ladder climbs for anyone who keeps playing, which is the intended feel, and
it is the reason seasons are mandatory rather than optional (§3). The table is
the no-draw equal-rating case:

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
them: matchmaking pairs on points, the bots on their own group (§4), the ladder and
the apex on points and rank. They are gone.

In the original populated-ladder simulation, what removing divisions costs is
promotion *frequency*: STONE took 37 games to traverse and the OBSIDIAN width
took about 120. In that environment the continuously moving ring supplied the
near feedback between distant crossings, so it has to animate when points land.

| group | floor | width | simulated games to traverse* |
|---|---:|---:|---:|
| STONE | 0 | 300 | 37 |
| BONE | 300 | 420 | 36 |
| IVORY | 720 | 540 | 53 |
| SILVER | 1,260 | 750 | 74 |
| GOLD | 2,010 | 990 | 99 |
| OBSIDIAN | 3,000 | 1,350 | 120 |
| NEON | — | — | positional, see below |

\* simulated with the production matchmaking rules in an 800–900-player,
near-even population; these are not production telemetry. The current
bot-heavy product produces much faster early climbs — including an
owner-observed STONE promotion after about five bot games — so these values
must not be used as the content-exposure budget. See §7.

Widths grow **×1.35** per group, and no longer need to divide by three. Equal widths were the first proposal and the
measurement killed them: every group took 64–77 games, so leaving STONE cost
the same as reaching OBSIDIAN. Two independent things now make climbing
harder as you go: each *match* pays less when you outrank your opponent, and
each *group* costs more points than the last.

### NEON is a position, not a threshold

**NEON = the top 1% of the current season.** Everything below it is a point
threshold; the apex is not.

NEON changes the displayed **league**, never the meaning of **rank**. Profile
shows NEON above the player name and keeps the RANK fact as the exact numeric
ladder position (`#1`, `#2`, …); substituting the league name there would hide
the positional fact that awarded NEON in the first place.

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

The asymmetry is already the mercy — at a 50% decisive win rate you drift
*upward*, so falling a group means genuinely losing more than you win. A floor
on top of that would make every group boundary risk-free and the ladder inert
exactly where it should be tense.

### Permanent ranked variety pools

Current points decide the visible group; the highest group floor ever reached
decides the player's permanent ranked outcome pool. These are deliberately
different promises: demotion remains real, but it never takes game variety
away.

| Permanent pool | Historical peak | Outcomes added |
|---|---:|---|
| STONE | 0 | Classic, Single Strike, Column Shield, Limited |
| BONE | 300 | Row Switch, Row Multiply, Bounty |
| IVORY | 720 | Rune Trial |

The stored pool only moves upward. Existing accounts are backfilled from the
greatest recorded season peak/current season row, and season turnover never
lowers it. A promotion changes the next match, not the match whose settlement
earned it.

Human matchmaking uses the lower/shared permanent pool and then intersects
protocol capabilities, so neither participant can be placed into an outcome
their account or client cannot play. Bot matches use the human participant's
pool. Within that eligible pool Classic is exactly 40%; all additions divide
the remaining 60% equally. IVORY's seventh addition is Rune Trial, a
Classic-backed selection format rather than another ladder group or mechanical
mode. See `docs/MODES.md §4` and `docs/SPELLS.md §8`.

This table is the current runtime contract. The redistributed progression
approved for a future release is recorded separately in §7; until that work
ships, this table and its 40/60 weights remain authoritative.

### Group transition presentation

Design: card **54a** (`design/screens/product/54a-league-ring.html`). The ranked
result appears first, then every real group crossing opens the mandatory LG1
living-ladder deck above it. Its first slide is always the same ring and avatar
settling into the new material: upward for promotion, downward for demotion.
There is no close or backdrop dismissal; swipe, dots, Back/Next and the final
Continue are the complete path, and reduced motion paints the same settled
state without the rise/fall/orbit effects. Every multi-slide page keeps the
same localized **Swipe to explore** footer; the buttons are an equivalent
control, not a reason to rename the gesture. A one-slide crossing hides both
the dead swipe hint and redundant `1 / 1`; its one dot sits directly above the
centered Continue action. The slightly taller portrait card trims the empty
space above and below that one-slide modal without changing the multi-page deck.

Settlement writes one owner-only durable before/after event per human
participant in the same transaction as the ladder step. The event carries
points, permanent pool, equipment, and both historical apex flags. That last
pair is essential: NEON is positional, so no later profile read or point
threshold can reconstruct whether this particular result crossed its boundary.
A crossing is acknowledged only after Continue; a same-group row is consumed
without opening a deck. This keeps reconnect and non-settling participants from
missing real transitions without turning every result into a modal. Network
uncertainty is never treated as proof that no event exists: later ranked results
recover the oldest owner-only unseen rows, including acknowledgements whose
response was lost.

The slide plan consumes the ranked outcome registry instead of copying feature
names. The first STONE → BONE unlock adds Row Switch, Row Multiply and Bounty;
the first BONE → IVORY unlock adds Rune Ritual. Each feature slide is exactly
one owned icon, its localized title, and one localized sentence — no second
teaching diagram. Already-earned pool features never repeat and never disappear
after demotion. Crossing SILVER additionally explains that the equipped fixed
or RANDOM rune is now permanently active; later demotion does not rest or
relock that seat.

Those are the slides the shipped registry produces today. Section 7 records
the future presentation contract separately; it must not be described as live
until the entitlement, transition-event, and debut guarantees exist.

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

private.season_streak_baselines(
  season_id, player,                       -- composite FK to season_ratings
  best_streak integer not null check (best_streak >= 0),
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
  `player_standing()` is projected from the identical visible list, so its
  rank is always a valid anchor even when bot visibility or unplayed rows differ.
- Those two SQL names are the deployed contract and stay as written. The client
  says **ladder** everywhere else: `ladderPage()` and `ladderPageBefore()` in
  `src/online/api/ladder-api.ts` are the only callers, and they return
  `LadderRow`.
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

*Corrected again 2026-08-26 after a 0–0 first-match loss. STONE's negative
opponent weight had only meant "spare the human" while the bot occupied the
historical AI/p2 seat. An equal-rating tiebreak put the bot in p1, where the
fixed-seat evaluator reversed that mercy into aggression. The old onboarding
bench masked it by always seating the bot p2 and by calling a p1 destroyer a
"stacking newcomer." The live match replay made the inversion visible: the bot
countered four times, including a pair of sixes.*

Now **a bot plays the shape of its own group** — the shape is a field of the
group registry (`core/ladder.ts GROUPS[].bot`, read by `botShapeAt(points)`),
so the label IS the strength. Difficulty still tracks the player, but through
**pairing**: `pvp-join` hands out bots within the player's own group width
(`botPairBand`), and mints new ones inside the same cap when none is free.
Bots' points move through real settles, so a bot whose shape loses drifts
down toward the group that plays like it — the label stays honest by
construction.

The shape changes **at group boundaries, not continuously per point**. A
301-point BONE bot and a 700-point BONE bot therefore make decisions with the
same policy; their points still affect pairing and which group policy applies.

| group | depth | risk | sees your board | slip p2 / p1 | human opens | bot opens |
|---|---:|---:|---|---:|---:|---:|
| STONE | 1 | 0 | **spares it** (`oppW -0.5`) | 70 / 70% | **79.0%** | **66.9%** |
| BONE | 1 | 0 | builds blind (`oppW 0`) | 70 / 70% | **62.1%** | **63.8%** |
| IVORY | 1 | 0.25 | glances (`oppW 0.05`) | 60 / 60% | **56.1%** | **57.2%** |
| SILVER | 1 | 0.6 | yes | 72 / 67.5% | **54.2%** | **55.7%** |
| GOLD | 2 | 1.2 | yes | 68 / 67% | **53.1%** | **55.0%** |
| OBSIDIAN | 3 | 1.2 | yes | 68 / 66% | **~52.7%** | **53.7%** |
| NEON | 4 | 1.2 | yes | 66 / 65% | **52.1%** | **53.1%** |

The last two columns are the **human's production-weighted board-policy share**
against the same simple, seat-neutral builder (a draw contributes half); Rune
Trial uses its Classic board cell here and receives the separate production-
path spell check below. This is the balancing contract: bots get stronger by
league and approach parity, but their calibrated aggregate share never exceeds
50% in either legal seat. The seeded calibration used at least 800 games per
outcome, with larger confirmation runs. `tests/botbench.test.ts` keeps both
seat curves honest and `tests/ladder.test.ts` pins the shape numbers.

**`oppW` is the floor's knob, and NEGATIVE is the floor's floor** (retuned
2026-08-21: "if I lose 50% in the beginning, I quit"). Slip alone cannot
make a gentle bot: the un-slipped half of a depth-1 greedy still takes every
kill, and even at 90% slip it holds random-parity (measured). At `oppW 0`
the eval never *aims* a destroy; below 0 it actively prefers placements that
SPARE the player's dice — passivity, the one below-random weakness that
reads as a beginner rather than a drunk.

That meaning is now **root-player-relative**, so it survives either seat.
STONE's random slip also honours it: the bot still builds in a random column,
but only among columns that cost the opponent the least visible score. The old
any-column slip is how a nominal blunder produced the live double-six wipe.
Higher groups retain the ordinary any-column slip when seated second.

A genuinely lower-rated bot may still earn the opening seat — this change does
**not** restore "human always opens." Instead, every bot opener gets a measured
seat adjustment: its slipped moves use the same safe random-build rule. That
cancels the opening advantage without changing matchmaking, and is why the
bot-opens column above stays human-favoured too.

The gate uses the real `botMove`, derives the exact outcome weights from the
ranked registry, and measures both seat orders. Rune Trial gets the same
league/seat slip on the bot's cast decision: a slipped bot passes that cast
window but still places. The 1,000-game-per-seat production replay in
`tests/rune-bot-fairness.test.ts` puts a simple active human at 54.3–61.0% in
every IVORY+ league/seat (NEON: 54.7% / 58.3%). A player who never uses a dealt
rune can still be an underdog in that outcome; the permanent-pool gate
therefore substitutes an even harsher 38% / 40% Rune share and proves the
league aggregate remains human-favoured. A random mover also remains favoured
in STONE (about 69.6% when opening, 54.3% when the bot opens), so the first
league supports learning by play rather than requiring the builder model.

**Matchmaking width** (humans) is unchanged: few players near you → widen the
band; crowded → keep it tight (`players_near` + `matchBand`). Percentile
still exists where it belongs — `player_standing()` resolves the positional
apex and the profile's rank line.

**Inside the cap, the bot is drawn uniformly** (2026-08-28). `pvp-join` used to
sort the free bots by proximity and pick one of the nearest **three**, which
held the median rating gap at **37 points**. A ladder delta is a function of
that gap, so every win paid about +80: measured over 3,000 simulated matches,
**76%** of wins landed within ±3 of each other. Human pairing never had the
problem — `oldestEligibleCandidate` takes the oldest queued player inside the
band, never the nearest, and measures a median gap near **340** whether two
players are queued or sixty.

Sampling the whole eligible band gives bot matches that same spread, and it is
free in both directions that matter:

| | nearest-three | band-uniform |
|---|---:|---:|
| median rating gap | 37 | 330 |
| win payout | +75..+84 | **+53..+103** |
| payout spread (sd) | 5.1 | **17.9** |
| wins within ±3 of each other | 76% | **12%** |
| skill fidelity | 0.906 | **0.906** |
| human win rate | 56.0% | 56.2% |

Fidelity is untouched because none of this reaches `delta()`, and `botPairBand`
still caps the distance — so this cannot re-create the IVORY-bot-in-STONE
pairing that §4 was written to fix.

**The mirror must start at 0.** `profiles.rating` kept its pre-ladder default
of 1000 through the cutover, so every new signup entered matchmaking rated
1000 — under this model that would hand every newcomer an IVORY-strength
first bot. Found live, fixed in migration 0024 (default → 0, stale mirrors
re-mirrored from `season_ratings`).

---

## 4b. Bot rune winnings and the equipped seat

Decided 2026-08-28, with the equipped-rune feature. Owner: Johannes.

**A bot's runes are winnings, not decoration.** The seed may only hand a bot
what it could plausibly have won, so two limits apply and the smaller wins:

1. **Standing.** Rune Trial is dealt from IVORY (720) up, so a bot below IVORY
   has never been offered one and holds **nothing** — exactly what a human at
   those points holds. From IVORY to NEON the roster fills in evenly, so the top
   of the ladder carries all six and the bottom of IVORY carries none. This was
   an explicit choice over seeding low bots with a rune "so lower players meet
   one": a rune below IVORY is not reachable by real play, and a curious player
   would rightly notice bots holding what they cannot yet win.
2. **Record.** You cannot hold more runes than Trials you could have won:
   `games x Trial's slice of the pool (1/8) x win rate`. Against the current
   seed plan this never binds — the bots play enough — and it is kept so a
   future plan with fewer games cannot mint runes out of nothing.

**Which** runes is `points % 6` into the registry order, not a hash. Points are
unique per bot (the seed postcheck pins `count(distinct points)`), so it is just
as stable, and unlike a hash it is reproducible in SQL — which is what lets the
whole grant be one reviewable statement instead of 11KB of literals.

**The bot seat** is one stable pseudo-random choice from that bot's actual
inventory, persisted in `profiles.equipped_rune`.
`private.bot_owned_rune_choice(uuid)` orders owned rows by a salted hash of the
bot UUID and rune id; it never calls volatile `random()`, so seed, backfill,
settlement, and audit all agree. A bot's existing seat is not rerolled when it
wins another rune. The seat may be set before the bot has reached SILVER: the
rune is carried but not in play until that one-time threshold is reached.

**A human may instead select RANDOM.** `profiles.random_rune_mode=true` keeps
one concrete owned `equipped_rune` fallback for installed older clients, while
each fresh ordinary ranked match derives its immutable rune from the match seed,
participant id, and complete current collection. Retries reproduce the same
snapshot; later equipment changes cannot rewrite it. RANDOM without an owned
fallback is unrepresentable, and an eligible RANDOM seat always snapshots an
owned rune rather than NONE. A player who has never reached SILVER still
snapshots no rune; reaching it once keeps the seat active through demotion and
season turnover. Rune Trial ignores the mode. Bots retain their stable fixed
seat rather than silently changing product policy.

The population as seeded (200 bots, 539 rune rows, 155 carrying a seat):

| group | bots | runes each |
|---|---|---|
| STONE | 13 | 0 |
| BONE | 19 | 0 |
| IVORY | 23 | 0–1 |
| SILVER | 32 | 1–2 |
| GOLD | 43 | 2–4 |
| OBSIDIAN | 59 | 4–6 |
| NEON | 11 | 6 |

No face dominates: 89–91 bots hold each of the six.

**Bots keep what they win through the same reward boundary.** `settle_match`
grants the winner's selected Trial rune with no `is_bot` check. After that
shared grant, a bot-specific branch fills only an empty seat from the owned
collection; humans retain the deliberate choice to equip or clear their own
seat.

**Population size.** 150 → **200** on 2026-08-28 (Johannes). The count is
single-sourced from `PRODUCTION_BOT_COUNT` in
`tools/database/production-test-data-core.mjs` and interpolated into the guarded
SQL, including the opt-in phrases and the half-population peak split — it was
previously hardcoded in eleven places and a twelfth derived one (`75`).

## 5. The profile

Design: card **92d** (`design/screens/product/92d-arc-season.html`). Built in
`online/screens/account-screen.ts` (the sweep itself in
`online/screens/account-ring.ts`) over `online/styles/profile.css`.

**The ring is the screen.** ONE continuous fill — the percentage of the way
through your current group — and it **sweeps up to its value when the profile
opens**. That animation is load-bearing, not decoration: group promotions were
37 to ~120 games apart in the populated design simulation, and the ring remains
the continuous feedback even when bot-heavy play crosses earlier. A number
that is simply *there* on arrival never reads as progress. It is
tweened in JS rather than by a CSS transition, because a conic-gradient's angle
stop does not interpolate reliably across engines; `REDUCED` motion skips
straight to the value.

Profile and the transition consume one full-size ring primitive: progress
track, fill, outer league-material halo, and inner orbit. The transition alone
adds its previous-material arc, particles, and rise/fall animation. In Profile,
the fill remains the user's chosen `--p1` colour while the halo/orbit name the
current league; the transition deliberately uses the league material for both.
Mini identity rings keep the compact track/fill variant without full-size
chrome.

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

NEON is positional and has no upper points cap, so its progress arc is fully
filled rather than inventing a next threshold — including for a second-place
player whose points sit below the small-population fallback floor. It draws no
peak notch because an unbounded league has no honest scale on which to place
one; the right-most **PEAK** fact remains the exact current-season high score.

**Three facts, not four:** Rank · Best streak · Peak. The win/loss tally moved
to the head of **match history**, which is the list it summarises. It is not
labelled "record": in English that means both a win-loss tally and a personal
best, and in German only the second, so the word was quietly promising the
streak while showing the tally. `best_streak()` (migration 0021) computes the
longest run of wins over the whole season, so it cannot shrink as old matches
scroll out of a window. Seeded opponents may also have a private per-season
baseline representing aggregate history imported without match rows;
`player_card()` shows the greater of that baseline and the real run. The
baseline is deliberately outside `season_ratings`: atomic settlement compares
that table's complete five-field rating snapshot, so widening it would break
the compare-and-set contract. A longer real run naturally supersedes the
baseline, and deleting the season rating cascades it away.

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
why the ladder window is a definer function too.

**The result screen** names what the match paid in **points**, not Elo, and the
rank comes from `player_standing()` rather than scanning a ladder page for
your own nickname — which silently found nothing past rank 50.

**One ask-card** (`ui/askcard.ts`) serves every either/or question: quitting,
forfeiting, and deleting an account. They differ only in their words and
whether the confirm is guarded. Deletion uses that guard — a checkbox — rather
than a two-tap arm, which asks for the second tap in the very place the first
one landed: the one gesture a mis-tap repeats for free.

**Going away costs the match, and it is counted, not timed.** The turn clock
plays two turns for an absent player; the third time it would have to, the
match is forfeited to the opponent and paid out through the ordinary
settlement. A warning appears on the last covered turn. Two, rather than a
number of seconds, because every automatic placement refreshes the stall clock
the timeout is measured from — so a seconds-based rule can never fire against
a player whose app is still running, which is exactly how an away player used
to be auto-played forever. See `docs/architecture/backend.md` for the
mechanism.

**Every forfeit is a finished match, including the one you chose.** Quitting,
being claimed after a stall, and running out the away allowance all settle the
same way and all land on the result screen — the loser's own plate carries a
`FORFEITED` stamp, because a scoreline alone cannot say whether they were
out-rolled or simply left.

## 6. Migration plan

Ordered so the app is never broken between steps. Steps 1–3 are additive and
invisible; the ladder does not change behaviour until step 4.

1. **`20260820115628_seasons.sql`** — `seasons`, `season_ratings`, `matches.season_id`.
   Insert Season 1 with `ends_at = NULL`. Backfill: every existing match gets
   `season_id = 1`; every profile gets a `season_ratings` row seeded from its
   current rating. Nothing reads the new tables yet.
2. **`20260820115713_percentile.sql`** — a `player_percentile(uuid)` function and the
   index behind it. Nothing calls it yet.
3. **`core/ladder.ts`** — the pure module: `delta()`, `groupOf()`,
   `divisionOf()`, the band table. Pure, so it runs in the browser, in Node
   for the gate, and in Deno for the Edge Functions, like `core/modes.ts`.
   Ships with a test suite that pins the numbers in §1 and §2, and a
   simulation bench like `col-score-bench` that fails if fidelity drops below 0.89.
4. **`pvp-move` v11** — writes `season_ratings.points` and `peak` through
   `core/ladder.ts`, stamps `matches.season_id`, and swaps its three absolute
   difficulty constants for `player_percentile()`. `profiles.rating` keeps
   being mirrored, so every existing reader survives untouched.
   **This is the step that changes what players see** and the one to verify
   live with throwaway guests before it goes near real accounts.
5. **`20260820115732_leaderboard_seasons.sql`** — `leaderboard()` takes an optional
   season and returns `points`, `group`, `division`. NEON is resolved from
   position, not from the band table.
6. **Client** — the profile screen (card 92d), the avatar picker, match
   history, and the result screen showing the delta the match actually paid.
7. **`20260820115747_avatar.sql`** — `profiles.avatar text default 'die:5:cy'`.

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

## 7. Decided progression target — not shipped

*Decided 2026-09-01. Owner: Johannes. After selecting the broad league
placement and delegating the remaining choice with “You decide”, the owner
accepted this section as the complete product contract, including the target
score curve, collection tail, bot debuts, weekly cadence/rewards, and cutover
behavior. It is not a description of current runtime. The possible paid
one-rune tail escape is recorded only as an unapproved later example. The
shipped pool, score floors, Trial reward, and transition deck remain the ones
in §2 and `docs/SPELLS.md §8` until the entitlement, draw, presentation,
settlement, migration, and persistence work below is implemented and verified.*

### Why the populated estimate is not today's content cadence

The original **37 / 36 / 53** early-group figures came from a populated,
near-even matchmaking simulation. The current product has bots and effectively
no human matchmaking population, and those deliberately beatable bots make the
ladder climb much faster. The owner currently reaches BONE in about **five bot
games**. That observation is the evidence that matters for onboarding: it is
not valid to assume a new player spends 37 games sampling STONE before the next
bundle arrives.

| climb | populated simulation | current bot-heavy planning range* |
|---|---:|---:|
| STONE → BONE | 37 | about **5 observed**; order of 5–10 games |
| BONE → IVORY | 36 | order of 10–20 games |
| IVORY → SILVER | 53 | order of 20–30 games |
| SILVER → GOLD | 74 | order of 35–45 games |
| GOLD → OBSIDIAN | 99 | order of 55–65 games |
| OBSIDIAN → NEON | 120 width traversal | not predictable: NEON is positional |

\* Only the approximately five-game STONE climb is an owner observation. The
later ranges are a coarse planning exercise using the current 200-bot point spread,
uniform in-band bot selection, measured per-group and per-seat human outcome
shares, and current ladder deltas. They assume no draws, fixed bot ratings, and
a simple-builder human. No reproducible model artifact is retained, so these
ranges indicate scale only; they are not telemetry, forecasts, or a release
gate. Instrumented production cohorts must replace them before tuning league
widths.

The shipped wheel makes the exposure problem concrete. In STONE, Classic is
40% and the three additions are 20% each. After five ordinary independent
wheel draws, the expected number of distinct outcomes is
`4 - 0.6^5 - 3 × 0.8^5 = 2.9392`; the chance of having seen all four is only
**19.2%**. Thus **80.8%** of five-match runs still miss at least one starting
outcome. The shipped BONE promotion then adds three outcomes at once. With each
of those new outcomes at 10%, the chance of seeing all three is only **34.5%
after 12** BONE games and **48.3% after 15**. An unlock can therefore arrive
before the old pool has been sampled and still remain unseen for most of the
next league.

### Decision: keep the fast opening, spread content, stretch the late climb

Do **not** slow STONE merely to create room for its unlocks. Reaching BONE after
a short first run is satisfying, and the continuously moving ring makes every
point legible. But the same argument does not justify compressing the entire
permanent progression: the current bot-heavy planning model puts OBSIDIAN at
about **130 median / 152 mean matches**, with a plausible fast ordinary path
near the owner's rounded **128**. That is too short for the last permanent
gameplay entitlement.

The correction therefore has two parts: redistribute modes so early leagues
teach one idea at a time, and preserve the fast opening while widening the
middle and late point bands.

#### League-score decision: a late-weighted 3,800-point curve

The current runtime floors in §2 remain shipped until implementation. The
successor target is:

| league | target floor | target width to next point-based league |
|---|---:|---:|
| STONE | 0 | 300 |
| BONE | 300 | 450 |
| IVORY | 750 | 650 |
| SILVER | 1,400 | 1,000 |
| GOLD | 2,400 | 1,400 |
| OBSIDIAN | 3,800 | 2,200 to the small-population NEON fallback |
| NEON | top 1% position; 6,000 fallback only below 100 rated players | unbounded |

The widening is deliberately late. STONE stays exactly 300, BONE's width grows
only 30 points, and the larger additions land where the player already has a
wider mode/rune vocabulary. Applying width ratios to the same coarse bot-heavy
model gives this planning comparison:

| traversal | current width | target width | current median / mean | scaled target median / mean* |
|---|---:|---:|---:|---:|
| STONE → BONE | 300 | 300 | 7.0 / 7.5 | **7.0 / 7.5** |
| BONE → IVORY | 420 | 450 | 12.0 / 14.8 | **12.9 / 15.9** |
| IVORY → SILVER | 540 | 650 | 21.0 / 24.9 | **25.3 / 30.0** |
| SILVER → GOLD | 750 | 1,000 | 36.0 / 42.5 | **48.0 / 56.7** |
| GOLD → OBSIDIAN | 990 | 1,400 | 54.0 / 62.2 | **76.4 / 88.0** |
| **total to OBSIDIAN** | **3,000** | **3,800** | **130.0 / 151.9** | **169.5 / 198.0** |

\* This is a linear planning extrapolation, not a retained simulation or
telemetry. Widening a group also widens `botPairBand`; in a sparse population
the separate `matchBand` ceiling is `900 × SCALE = 4,500` displayed ladder
points, so every target group width remains the tighter bot cap. Denser
populations can narrow `matchBand` instead. New floor boundaries also change
bot shapes, eligible opponent pools, payouts, and potentially win rates, so
linear scaling cannot model those feedbacks. Before implementation, a retained
production-shaped simulation must use the target outcome pools, finish
transfer, both seats, runes, Trial, and target pairing bands. The release range
is **160–185 median**
and **185–215 mean** matches from a fresh account to OBSIDIAN, with STONE still
at a **5–8 settled-match median** and no individual late band becoming longer
than its reward can carry. If measurement misses, tune SILVER/GOLD widths—not
STONE—until it lands inside that product target.

The 4,000-point alternative was rejected. It projected about 180 median / 211
mean overall but made GOLD alone roughly 87 median / 101 mean matches, too long
between visible promotions even with two modes at entry. The 3,800 curve still
adds about 30% to the full climb without creating that wall.

The new BONE width also makes the earlier division explicit. At an equal-rated
base payout, `450 / 80 = 5.625`, so a perfect base-only run takes six wins. Six
dominant target-rule wins also cross it; only repeatedly beating higher-rated
bots can reduce that to five. At an equal-rated 50% decisive record with
symmetric finish margins and no draws, +10 per match would take about 45
matches. The coarse
approximately 63% BONE human share is much faster: its base-only expectation is
`0.63 × 80 - 0.37 × 60 = 28.2`, or about 16 matches for 450 points, before the
small finish signal.

##### Best-case traversal bounds

“Best case” needs an opponent assumption because the base payout changes with
rating gap. These are target-width perfect streaks with no draws or forfeits:

| traversal | width | equal-rated base wins at +80 | dominant equal-rated wins at +87* | cap-edge higher bot, dominant win | absolute traversal floor at the +160 payout ceiling** |
|---|---:|---:|---:|---:|---:|
| STONE → BONE | 300 | 4 | **4** | **3** at up to +101 | 2 |
| BONE → IVORY | 450 | 6 | **6** | **5** at up to +107 | 3 |
| IVORY → SILVER | 650 | 9 | **8** | **6** at up to +116 | 5 |
| SILVER → GOLD | 1,000 | 13 | **12** | **8** at up to +129 | 7 |
| GOLD → OBSIDIAN | 1,400 | 18 | **17** | **10** at up to +140 | 9 |
| OBSIDIAN width → 6,000 fallback | 2,200 | 28 | **26** | **15** at up to +155 | 14 |
| NEON in a populated season | positional | not finite | not finite | not finite | not finite |

\* `+87 = +80` equal-rated base plus the maximum requested and applied seven.
At the zero-point opening, an equal-zero loser cannot fund the finish transfer;
STONE still takes four such equal-rated wins, so the table's count is unchanged.
A continuous dominant equal-rated streak reaches target OBSIDIAN in 44 matches;
a cap-edge maximum bot streak does it in about 31. Both are compounded extremes,
not cadence estimates.

\** The absolute +160 is a maths ceiling, not a matchmaking forecast. Against
an opponent thousands of points above, the base win approaches +160 but the
opponent's base loss approaches the −120 cap, progressively removing finish
transfer room. The combined payout therefore never exceeds +160. Bot backfill
is tighter: its permitted gap is `min(matchBand(nearby), botPairBand(points))`.
`botPairBand` is the current league width. `matchBand` tops out at
`900 × SCALE = 4,500` displayed ladder points, so the target league width is
the tighter limit in the sparse cap-edge case used by the table; denser
populations can make `matchBand` tighter. The cap-edge column assumes the
highest allowed bot appears every time **and** loses every game by the maximum
normalized margin.

Unlock distribution has **no direct arithmetic effect** on point speed. It
changes when the player receives and reliably sees fresh content. It can change
measured progression indirectly because the new mode mix changes win and
normalized-margin distributions; that is why the retained simulation must
combine both decisions rather than pretending the unlock table awards points.
The finish transfer is likewise not the reason for the wider floors: it moves
at most seven additional points and remains antisymmetric. The reason is the
total permanent-progression cadence.

##### Effect of the refinement on progression speed

The more responsive denominator does **not** revise the 169.5 median / 198.0
mean planning estimate or the 160–185 / 185–215 release bands above. Relative
to the preceding sum-based target, a decisive result changes by zero or one
additional transferred point. Pair-wide inflation remains exactly zero. With
symmetric decisive wins/losses and margin distributions, an equal-rated player
still receives the base system's expected **+10 points per decisive match**;
zero-paying draws reduce the all-match value as described in §1.

In general, the expected per-match speed change is
`p_win × d_win - p_loss × d_loss`; draws add zero. If the conditional
refinement increment is symmetric (`d_win = d_loss = d`) and `p` is outcome
share with draws counting half, `p_win - p_loss = 2p - 1`, so that expression
reduces to `(2p - 1) × d`. The hard bound is `d ≤ 1`; the 48,000-game probe's
pooled decisive results measured `d = 0.605`:

| outcome share | symmetric maximum extra points/match | symmetric probe-shaped extra points/match |
|---:|---:|---:|
| 50% | 0.00 | 0.00 |
| 55% | 0.10 | 0.061 |
| 60% | 0.20 | 0.121 |
| 63% | 0.26 | **0.157** |
| 70% | 0.40 | 0.242 |

Under that symmetric probe-shaped assumption, the coarse 63% BONE share adds
0.157 points per match, only **0.56%** of the coarse model's 28.2-point
equal-rated, no-draw base-only expectation. With draw fraction `q`, that base
comparison becomes `28.2 - 10q`. Across the whole target climb the no-draw
estimate suggests roughly zero to a couple fewer games, inside the planning
model's uncertainty; floor/loss-cap clipping makes the practical change smaller.
Even the perfect-streak bounds do not move because their dominant result already
requests the unchanged maximum seven: 44 continuous equal-rated dominant wins
and about 31 cap-edge bot wins still reach OBSIDIAN. The retained target
simulation, not this estimate, owns the eventual cadence verdict because real
margin increments may correlate with win/loss, rating gap, mode, and player
skill.

#### Score-curve cutover preserves standing

Raising floors must not visibly demote every existing account. At target
cutover, migrate every human and bot's current points and peak through one
monotonic, group-local mapping:

```
progress   = (old_points - old_group_floor) / old_group_width
new_points = new_group_floor + round(progress * new_group_width)
```

Use the old OBSIDIAN segment `3,000…4,350` and new segment `3,800…6,000` for
all points at or above old OBSIDIAN, allowing the formula to extrapolate beyond
either fallback. Apply the same mapping to current points and historical peaks.
This preserves rank order, displayed non-apex league, and ring progress; NEON's
top-1% status remains positional. Existing outcome/rune/weekly entitlements are
retained independently, and historical match deltas are not rewritten. The
numeric migration itself emits no match result, promotion deck, reward, or bot
debut; the separate entitlement union below decides anything newly granted.

The curve cutover is versioned and must not strand an installed client between
numeric contracts. First ship a client that understands both curves while v1
remains active. At the maintenance boundary, pause new ranked admission, finish
or deterministically settle every active v1 match, atomically map current/peak
points and activate the server-owned v2 curve, then resume ranked only for
clients that advertise that curve version. The migration refuses to run while
an old-version match remains active. An older installed client may continue
offline but receives an update-required screen before ranked; it must never
render mapped points against the old floors or settle a v1 delta into v2
points.

| league milestone | decided target reward |
|---|---|
| STONE start | Classic, Single Strike, Column Shield, **Bounty** |
| first historical BONE peak | **Row Multiply** |
| first historical IVORY peak | **Rune Ritual** (`rune_trial`, Classic-backed) |
| first historical SILVER peak | Equipped fixed or RANDOM runes become permanently active in ordinary ranked |
| first historical GOLD peak | **Row Switch and Limited** |
| first historical OBSIDIAN peak | Permanent access to the weekly featured challenge |
| first NEON position in a season | Live apex presentation plus a permanent cosmetic season medal; no NEON-exclusive gameplay |

For a new account governed only by the successor schedule, the target ordinary
outcome wheel still keeps Classic at exactly 40% and splits the other 60%
equally across every eligible addition:

| historical peak | cumulative new-account outcomes | steady-state odds |
|---|---|---|
| STONE | Classic; Single Strike; Column Shield; Bounty | Classic 40%; each addition 20% |
| BONE | STONE + Row Multiply | Classic 40%; each addition 15% |
| IVORY | BONE + Rune Ritual | Classic 40%; each addition 12% |
| SILVER | unchanged from IVORY; equipped runes activate separately | Classic 40%; each addition 12% |
| GOLD and above | SILVER + Row Switch; Limited | Classic 40%; each addition `60/7` (about 8.571%) |

#### Rune collection target: a long tail, not a checklist

The shipped Trial awards the winner's selected rune. An optimal collector can
choose any offered unowned rune, so the first three acquisitions are guaranteed
on wins and the complete six-rune set takes only **7.303 winning Trials on
average**. Under the target appearance odds that is roughly 75–150 total ranked
matches from a fresh account, depending on Trial win rate. That is too generous:
the complete collection would become the normal endpoint instead of a rare
long-tail achievement.

The successor Trial therefore marks exactly one of the common three offered
cards as the **CLAIM rune** before either private choice. After snapshotting the
offer, the server chooses one of its three slots uniformly with a
domain-separated deterministic stream and snapshots the rune at that slot. Both
players see the same marked rune; each sees only whether it is in their own
server-confirmed collection. A Trial winner collects that rune only if they
selected the marked card; selecting either unmarked card chooses gameplay
strength over collection progress. A loss or draw awards nothing, and an
already-owned CLAIM rune remains a duplicate with no replacement. Forfeit,
timeout, and resignation use the actual resolved selection under the same rule.
The existing deterministic auto-pick is not biased toward CLAIM.

This rejects the tempting post-win-random alternative: the collectible is known
before the duel, and the player must win with it. Compared with the shipped
selected-rune reward, CLAIM intentionally gives the collector less control—that
is what creates the longer tail—but preserves a meaningful tactical choice
between collection progress and either unmarked matchup. Trial still loans all
six, a fixed equipment seat needs only one owned rune, and RANDOM needs two, so
an incomplete collection does not block the core ranked format.

Because the offer is a uniform three-of-six and the mark is uniform among those
three, each rune is CLAIM with probability `1/6`. A collection-focused player
who always selects CLAIM therefore follows the ordinary six-coupon collector:

```
expected winning Trials for all six
  = 6 × (1 + 1/2 + 1/3 + 1/4 + 1/5 + 1/6)
  = 14.7
```

At a 50% Trial win rate, that becomes **29.4 Trial matches** on average. Using
the guaranteed IVORY bot debut, 12% Trial odds through IVORY/SILVER, `3/35`
(about 8.571%) from GOLD, and the target floor projection gives these planning
results for a fresh account:

| collection behavior | expected Trial matches to all six | expected total ranked matches to all six* |
|---|---:|---:|
| always select CLAIM; win every Trial | 14.7 | about **153–154** |
| always select CLAIM; win 50% of Trials | 29.4 | about **322–324** |

\* Includes roughly 20 median / 23 mean matches to reach IVORY. The two
discrete scenarios then use 73 IVORY/SILVER + 77 GOLD matches and 87
IVORY/SILVER + 88 GOLD matches respectively, with one immediate guaranteed bot
Trial, 12% Trial odds for the rest of IVORY/SILVER, and `3/35` in GOLD. These
are scenario endpoints, not confidence bounds or release-range extremes.
Phase length, Trial appearance, offer/CLAIM identity, and Trial wins are treated
as independent. Choosing an unmarked card, drawing instead of winning, or an
ineligible Trial lengthens collection under the same schedule. Human
shared-entitlement matches may instead raise the Trial slice to 12% or remove
Trial through capability/entitlement intersection, so retained implementation
simulation must model those correlations rather than infer them from this
bot/own-pool estimate.

At the target OBSIDIAN timing, the same model produces the intended partial
collection for a collection-focused player who always selects CLAIM and wins
50% of Trials: about **4.5–4.8 runes owned**, only **16–25%** complete, and
**74–80%** still missing one to three. A player who wins every Trial is
exceptional and completes more often—about **67–77%** by OBSIDIAN—but even that
path is not guaranteed. No pity replacement is added; the missing final runes
are the long tail the collection is meant to retain.

The collection-focused 50%-win distribution makes the target more explicit.
The range below spans those rounded median and mean cadence scenarios rather
than pretending one climb length is exact; it is not a confidence interval:

| collection state at OBSIDIAN, always choosing CLAIM and winning 50% of Trials | modeled share |
|---|---:|
| complete | **16.4–24.6%** |
| one rune missing | **35.4–39.5%** |
| two runes missing | **25.6–30.7%** |
| three runes missing | **8.6–13.8%** |
| four to six missing | **1.7–3.8%** |

This is the product criterion: most collection-focused ordinary climbers arrive
with a meaningful one-to-three-rune tail, a minority have already completed the
set, and almost nobody who consistently pursues CLAIM is still missing most of
it. Do not tune for universal incompletion; perfect Trial winners and lucky
collectors are allowed to finish early. Also do not add a guaranteed final-rune
payout merely because the last coupon can take time—the uneven finish is what
keeps collections from becoming a mandatory six-box checklist. A player who
knowingly chooses an unmarked tactical card can fall behind this distribution
by choice; that is the intended tradeoff, not a pacing defect.

##### Possible later tail escape — example, not approved

A future commercial experiment could offer **one explicitly chosen missing
rune for a tiny fixed amount after the account has first reached OBSIDIAN**.
That is an example of a late collection convenience, not part of the successor
launch and not a promise that the store will sell runes. The exact local price,
platform product, availability, and whether the experiment happens at all need
a separate owner decision and store-policy review. Every pacing estimate above
excludes this hypothetical purchase.

If explored, the first version should be capped at one direct rune purchase per
account. It shows the exact rune and final price before confirmation, can never
roll a random or duplicate reward, grants no exclusive or stronger variant,
and leaves the identical rune permanently earnable through Rune Ritual. Waiting
until OBSIDIAN prevents money from replacing the learning/collection journey;
the one-rune cap lets a player escape an unlucky final coupon without turning
the whole collection into a checkout. If balance evidence ever shows that
owning a particular rune supplies material competitive power rather than
choice, do not ship the purchase under this rationale.

The CLAIM identity and reward-rule version must be part of the immutable match
snapshot and settle idempotently. Its slot stream is domain-separated: it may
read the already-snapshotted offer but must neither consume nor perturb the
offer, choice/auto-pick, outcome-draw, or dice streams. Existing collected runes
are never removed at cutover. A dedicated successor capability, distinct from
current `rune_trial_v1`, is required before a client can enter a CLAIM Trial.
Both humans must advertise it; bots support it with the target release. A human
pairing with an older client simply excludes Trial from their shared eligible
pool. Every already-active match retains its snapshotted reward version, so a
v1 Trial always settles the selected rune and a CLAIM Trial can never be played
without rendering its mark. The shipped selected-rune rule remains runtime
truth until this target ships; `docs/SPELLS.md §8` owns the interaction and
reveal contract.

#### Presentation order follows unlock order

All player-facing mode/outcome sequences use one canonical progression order:

**Classic → Single Strike → Column Shield → Bounty → Row Multiply → Rune
Ritual → Row Switch → Limited.**

That order applies to ranked-outcome entries in the offline CPU picker, full
local two-player picker, ranked mode spinner/dial, mode library, transition
slides, and any compact mode list. One shared helper orders whatever
ranked-outcome subset a caller supplies; each surface retains its own inclusion
policy:

- the CPU picker shows the full catalog with entitlement/capability locks;
- local two-player and the library show the full catalog;
- the ranked spinner shows only the eligible negotiated roster; and
- a transition supplies only outcomes actually granted by that before/after
  event.

Every resulting subset preserves canonical relative order. Synthetic RANDOM is
not an outcome and remains appended separately after the ordered picker
entries. Non-outcome transition content—the league crossing, SILVER equipment,
OBSIDIAN weekly access, and NEON medal—remains in explicit typed slots rather
than being forced into the outcome sorter. A grandfathered mode stays at its
canonical rank but does not become a newly granted transition slide merely
because the target implementation ships. Nothing exposes registry
implementation order or moves a mode to the date one account received it.

Rune Ritual occupies its IVORY teaching position even though it is a format
rather than a mechanical modifier. Within the shared STONE tier, the order
walks from baseline through the two smallest rule changes to Bounty's more
visible match-long reward. The GOLD pair follows its guaranteed debut order:
Row Switch, then Limited.

One shared outcome presentation registry must own this order. The target
implementation adds one progression/display rank to the shared ranked-outcome
spec (or equivalent registry metadata), and one shared roster-order helper
orders caller-supplied subsets. The offline pickers, ranked spinner, library,
outcome-unlock slides, and tests all consume that result; no screen owns an
array, comparator, or second sorting switch of its own. This is a DRY
presentation seam, not a reason to couple presentation order to the
deterministic weighted draw.
RANDOM keeps the exact probability weights above, and its seed-versioned draw
order remains independent so a visual reorder cannot silently change outcomes.
The implementation gate pins the full sequence, relative order after each
supplied tier/capability subset (including grandfathered access), identical
relative order for entries shared by offline and ranked surfaces, and unchanged
seeded picks when display ranks are varied in a test fixture.

The weekly OBSIDIAN challenge is a deliberate featured entry with known rules,
not another node added to this ordinary random wheel or canonical outcome
sequence. It appears as its own clearly labelled entry after ordinary modes
where those controls share a screen.

The placement decisions are deliberate:

- **Bounty replaces Limited in STONE.** Its match-long +1 bank is direct,
  aggressive, visible on the board, and easy to understand while the player is
  still learning the base duel. The bank persists only for the rest of that
  duel; it is not account progression. Limited asks the player to track a
  shared supply and an alternate ending, so it is poor onboarding material even
  though both rules fit in one sentence.
- **Row Multiply stands alone at BONE.** It adds an exciting second scoring
  axis while preserving normal column scoring. That makes it a meaningful first
  unlock without making the five-game promotion a three-mode lesson.
- **Rune Ritual remains IVORY.** It is the deepest early format and starts rune
  collection. Keeping it one league before SILVER gives the player time to win
  and understand runes before equipment starts affecting ordinary matches.
- **SILVER needs no additional mode.** Permanently activating the equipped
  fixed or RANDOM rune changes every eligible ordinary ranked match and is a
  complete progression reward by itself.
- **Row Switch and Limited belong together at GOLD.** Both are advanced: Row
  Switch changes the scoring axis while interaction still reads through
  columns, and Limited changes supply and the end condition. GOLD arrives only
  after many dozens of bot-heavy games, so a two-outcome bundle is substantial
  there rather than overwhelming as it was at BONE.
- **OBSIDIAN should refresh, not merely add one finite unlock.** Its weekly
  featured challenge supplies a recurring reason to return during the long
  late climb. The mode-design rationale is also recorded in
  `docs/MODES.md §4`; the complete feature contract is below. Access is a
  permanent historical-peak reward, so demotion and season turnover do not
  remove it.
- **NEON never gates an exclusive mechanic.** NEON is the current season's top
  1%, can be entered or lost positionally, and must remain scarce. Its live
  league material follows the current position, while the first entry in each
  season records a permanent cosmetic season medal. If an unusual population
  lets a player become positional NEON before crossing a lower point floor,
  that settlement also grants every still-missing lower-league entitlement,
  including OBSIDIAN weekly access; the apex must not display above a feature
  it leaves locked. None of those mechanics is exclusive to NEON.

Alternatives considered and rejected:

| alternative | why it lost |
|---|---|
| Keep all three shipped BONE additions together | A roughly five-game first promotion can arrive while 80.8% of players still lack at least one STONE exposure, and the three new outcomes themselves take too long to sample. |
| Keep the current 3,000-point OBSIDIAN curve | Unlock redistribution fixes teaching cadence but leaves the entire permanent climb at roughly 130 median / 152 mean matches, too short for the long-term collection and weekly loop. |
| Slow STONE or stretch every league uniformly | It removes the satisfying early promotion. The selected curve keeps STONE at 300 and places almost all extra distance in the content-rich middle and late game. |
| Stretch OBSIDIAN to 4,000 and fallback NEON to 6,400 | It raises the overall estimate to about 180 median / 211 mean, but GOLD alone becomes roughly 87 median / 101 mean matches between promotions. The 3,800 / 6,000 compromise avoids that wall. |
| Put Limited at SILVER and Row Switch at GOLD | SILVER already changes every eligible ordinary match by activating equipment; adding a new supply/end-condition lesson competes with the rune lesson, while GOLD can comfortably carry two advanced outcomes. |
| Put one advanced mode at GOLD and the other at OBSIDIAN | OBSIDIAN's long climb benefits more from a renewable weekly reason to return than from one more finite wheel node. |
| Add the weekly challenge to the ordinary OBSIDIAN wheel | A featured challenge should be chosen knowingly and reliably; another low-probability random node would recreate the invisibility problem this decision fixes. |
| Require a brand-new rule every week | Weekly calendar pressure is incompatible with measured AI balance, deterministic replay, localization, protocol safety, and the normal release gate. |

### Guaranteed debut matches against bots

A promotion slide is not an unlock experience if normal randomness can hide the
new outcome. Under the target steady-state weights, Row Multiply has only a
**55.6%** chance to appear within five BONE matches, Rune Ritual only **47.2%**
within five IVORY matches, and each GOLD addition only **36.1%** within five
GOLD matches. The chance of seeing both GOLD additions within five normal draws
is just **11.3%**. Respectively, those are
`1 - 0.85^5`, `1 - 0.88^5`, `1 - (32/35)^5`, and
`1 - 2 × (32/35)^5 + (29/35)^5`.

The first historical unlock therefore creates a one-time durable debut promise:

| unlock | guaranteed bot exposure |
|---|---|
| BONE — Row Multiply | the first eligible bot match after the unlock |
| IVORY — Rune Ritual | the first eligible bot match after the unlock |
| GOLD — Row Switch + Limited | Row Switch in the first eligible bot match, then Limited in the second |

The same anti-hidden-unlock rule applies at BONE and IVORY, not only to GOLD:
a 55.6% or 47.2% five-match sighting chance is not a dependable promotion
reward. At GOLD, Row Switch comes first because it changes one scoring axis but
keeps ordinary supply and ending; Limited follows because its shared bag and
alternate ending are the larger teaching break.

If one settlement grants several lower milestones at once — possible when an
unusually low-points player first enters positional NEON — pending bot debuts
run one per eligible bot match in teaching order: Row Multiply, Rune Ritual,
Row Switch, then Limited. Already-owned or already-completed outcomes are
skipped rather than replayed.

“Eligible” means the account owns the outcome and the current client/protocol
can play it. A human match must continue to use the lower shared entitlement
and negotiated capabilities; it neither forces nor consumes this bot-only
promise. The promise is intentionally a controlled bot practice debut, not a
mere “seen” flag: a random human exposure may involve a far stronger opponent
and cannot guarantee the same safe first practice. Repeating the mode once
against a bot is acceptable and predictable. An incompatible client or a start
that never creates a match leaves the promise pending. Demotion, re-promotion,
and season turnover neither erase a pending debut nor create a second one.
After the promised outcome or pair has appeared, bot matches return to the
steady-state 40/60 wheel above.

STONE is a starting pool rather than a promotion unlock, so this decision does
not prescribe a forced four-match onboarding rotation. Its normal wheel remains
probabilistic.

### OBSIDIAN weekly featured challenge

The OBSIDIAN feature is an optional weekly entry, not a promise that a new
mechanical mode will be authored every seven days. Version one rotates one of
the seven existing mechanical modes; Rune Ritual remains its own format, and
ordinary equipped-rune eligibility continues to apply. The featured mode is
stated before matchmaking and is guaranteed for that entry rather than hidden
behind another wheel draw.

Version one deliberately selects only the mechanical mode; it does not force a
curated rune. A prescribed mode/rune pair would introduce ownership and
equipment fairness questions plus a separate balance matrix before the weekly
loop has proved itself. This supersedes the earlier curated mode/rune-combination
idea for v1; such combinations may return only as a later deliberate release.
Existing personal equipment can still interact with the featured mode under the
ordinary ranked rules.

One shared server-defined rotation runs from **Monday 00:00 UTC** through the
next boundary, so every eligible player sees the same challenge and reconnects
cannot reroll it. A single global UTC boundary is chosen over player-local
midnight so opponents, history, and idempotent rewards agree on the same
rotation. The feature reuses the ordinary ranked game view,
authoritative replay, bot AI, settlement, and matchmaking service. Compatible
weekly entrants occupy a tagged weekly lane inside that service and may meet
each other; ordinary entrants are never pulled into a featured match they did
not choose. The lane retains bot fallback and has no separate rating or
permanent isolated ladder, so the scarce population is not stranded waiting for
another human.

A weekly match settles the ordinary ladder delta. The first weekly win grants
one profile-facing completion mark for that rotation; replays remain available
but grant neither bonus points nor power. Weekly recognition is cosmetic only:
no extra ladder delta, rune, collection advantage, or gameplay entitlement.
The normal delta keeps the match meaningful without inventing a second rating;
the idempotent cosmetic mark creates a weekly goal without competitive power;
and replay keeps the feature playable after that goal is complete. The concrete
mark art and first rotation are release content, not new policy.

An occasional experimental rule may enter only as a deliberate product release,
not as calendar filler. It still needs a one-line rule, visible board feedback,
bot support, deterministic authoritative replay, protocol/capability handling,
measurement, and the normal gates before it can be featured.

### Cutover and presentation invariants

The shipped permanent pool has already made a player promise. Existing STONE
accounts were entitled to Limited; existing BONE and IVORY accounts were
entitled to Limited, Row Switch, Row Multiply, and Bounty whether or not a wheel
actually exposed each one. The target migration must **grandfather every
outcome already granted**. It may add target entitlements, but it may not relock
an outcome merely because its new milestone is later. A simple rewrite of the
current `stone | bone | ivory` tier mapping is therefore insufficient; the
future entitlement state must distinguish the target schedule from legacy
per-outcome ownership.

The cutover rule is an entitlement union: **everything granted by the shipped
pool at the account's pre-cutover historical peak, plus everything granted by
the successor schedule at the account's mapped historical peak**—equivalently,
its preserved historical league. Compute the old entitlement side before point
conversion and the target side after conversion. Thus an old 3,000-point
OBSIDIAN peak maps to target 3,800 and receives weekly access; treating raw
3,000 as target GOLD would violate the preservation rule. Consequently,
grandfathered ordinary wheels deliberately differ from the clean new-account
table above:

| pre-cutover permanent pool | cumulative post-cutover ordinary outcomes | steady-state odds |
|---|---|---|
| STONE | Classic; Single Strike; Column Shield; Bounty; Limited | Classic 40%; each addition 15% |
| BONE | Classic; all six mechanical additions | Classic 40%; each addition 10% |
| IVORY | Classic; all six mechanical additions; Rune Ritual | Classic 40%; each addition `60/7` (about 8.571%) |

This asymmetry is intentional and finite: accounts created after the cutover
follow the successor schedule, while accounts that received the old permanent
promise keep it. Bounty joins every grandfathered STONE account's ordinary
wheel because it is part of the new starting set; that migration is not a
league promotion and does not manufacture a promotion deck or forced debut.

The same rule applies to teaching and debut state: grandfathered ownership does
not fabricate a fresh GOLD unlock, repeat a feature slide, or enqueue a debut
that the account did not newly earn. The transition deck should teach only
actual before/after grants:

- BONE: Row Multiply;
- IVORY: Rune Ritual;
- SILVER: equipped runes;
- GOLD: one slide each for Row Switch and Limited;
- OBSIDIAN: the weekly challenge entry;
- NEON: live apex presentation plus the cosmetic season medal, with no
  NEON-exclusive gameplay-unlock slide. If that same settlement catches up
  missing lower entitlements, their normal feature slides follow in ascending
  BONE → IVORY → SILVER → GOLD → OBSIDIAN order and their bot debuts use the
  order defined above.

The current transition event, cached tier, and registry-derived slide plan do
not yet represent all of those facts. Shipping the target requires durable
per-outcome entitlements, one-time pending debut state, GOLD and OBSIDIAN
transition facts, a versioned immutable CLAIM mark and atomic reward predicate,
the current/peak point migration, version/capability gates for both disruptive
contracts, a drained ranked maintenance boundary, and a server-owned bot draw
override that still respects capability negotiation. It also requires
outcome-aware offline locks and cache, all eleven locale catalogs, the ranked
outcome and transition gates, Trial reward and cutover gates, random dial and
local-option gates, browser transition coverage, production-weighted bot
balance/progression measurement, a redesigned/regenerated LG1 card, and
redeployment of every affected authoritative function. Those are implementation
dependencies, not claims that the target is already live. The possible paid
tail escape above is explicitly outside that implementation scope.

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

**One rule in every mode: the lower-rated player opens.** The existing
human–bot equality tiebreak is unchanged, so at 0–0 the bot may still open.
Onboarding balance comes from the bot's opener policy, not from restoring a
human-always-opens exception.

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
exactly as a human would. At equal ratings the existing bot-opening tiebreak
still applies.

The **seat is the same; the bot policy compensates for it**. A bot in the
opening ME/p1 seat still uses its own league shape, but a slipped move is
restricted to the columns causing the least opponent-score loss. The
production-weighted two-seat bench is the guardrail: even NEON remains just
under 50% bot outcome share whether the human or the bot opens.

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
