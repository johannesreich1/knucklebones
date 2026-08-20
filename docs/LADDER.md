# The Ladder — points, groups, seasons

*Spec. Nothing here is implemented yet; this is the thing to argue with before
any of it becomes code. Every number was measured, not chosen — the
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

## 2. Groups and divisions

Seven groups. Each is three **equal** divisions — equal matters, because the
profile ring draws a group as three segments and they have to be honest.

| group | floor | width | division | games to clear* |
|---|---|---|---|---|
| STONE | 0 | 300 | 100 | 37 |
| BONE | 300 | 420 | 140 | 36 |
| IVORY | 720 | 540 | 180 | 53 |
| SILVER | 1,260 | 750 | 250 | 74 |
| GOLD | 2,010 | 990 | 330 | 99 |
| OBSIDIAN | 3,000 | 1,350 | 450 | 120 |
| NEON | — | — | — | positional, see below |

\* measured with real matchmaking, so the win rate slides toward 50% as you
climb — that slide is why the later groups cost more than the widths alone
suggest.

Widths grow **×1.35** per group. Equal widths were the first proposal and the
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
- `leaderboard(limit_n, season_id default current)`.
- The UI shows no season control until `count(seasons) > 1`. The profile
  already has the slot, hidden (design card 92d).

**Rollover**, whenever it is called: insert a new season, seed each player at
`round(old_points * 0.5)`, carry `peak` forward as a badge. Half is the usual
compromise — a good player starts ahead, but not so far ahead that a new
player can never catch up.

---

## 4. Percentile drives the difficulty, never the points

Absolute point thresholds stop meaning anything the moment the ladder
inflates. Everything that currently keys off a rating number keys off the
player's **percentile in the live season** instead.

**Bot strength** (replaces the 820 / 1080 / 1150 constants in `pvp-move`):

| percentile | search depth | risk sense | slip |
|---|---|---|---|
| bottom 20% | 1 | off | heavy |
| 20–60% | 1–2 | ramping in | light |
| 60–85% | 2 | full | none |
| top 15% | 3 | full | none |

A brand-new player sits at 0 points in the bottom percentile and meets
something genuinely simple, which is the point of starting at zero.

**Matchmaking width** uses the same number from the other end: few players
near you → widen the band; crowded → keep it tight. Today's fixed ±150 window
becomes a function of local population density.

Percentile is cheap at this scale — `percent_rank()` over an indexed points
column, or a small histogram table refreshed on a timer if it ever isn't.

---

## 5. The profile

Design: card **92d** (`design/screens/92d-arc-season.html`).

**The ring shows the current group only**, cut into its three divisions. A
division-up lights the next segment, so progress accumulates; the ring empties
and starts from the left only when the **group** changes — which makes that a
moment worth animating, and makes the ring's right end always mean the same
thing: the next group.

**The gold notch is the season peak**, in three states:

| state | notch |
|---|---|
| peak = current points | no separate notch — the fill's leading edge turns gold |
| peak ahead, inside this group | at its true position on the ring |
| peak in a higher group (you were demoted) | pinned at the far right, the upgrade point |

The pinned case cannot say *how far* beyond on its own, so the fact row names
it in words: **Peak — GOLD II**.

This gives one invariant worth relying on: **the notch can never sit behind
the fill**, because a peak is by definition at least the current score. Set a
new peak and the notch is pushed along by the fill — one animation, no special
case.

**Avatar.** `profiles.avatar text`, e.g. `"die:5:cy"` — a die face 1–6 and a
hue, 36 combinations, tap the avatar to change it. No storage bucket, no
moderation, and no user-generated-image obligations at App Store review. The
string format leaves the seam: a later value can be `"img:<storage-path>"`
with no schema change.

**Match history** is its own screen — opponent, mode, result, the delta that
match actually paid, date. All of it already lives in `matches`; it needs one
RPC and one view.

---

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

### What has to be decided before step 1

- Whether existing players start Season 1 from **0** (a clean slate — every
  current rating is on the old scale and means nothing under the new one) or
  from a converted value. **Recommend 0**: there are few enough real accounts
  today that a clean start is honest, and the alternative is explaining a
  conversion nobody asked for.
- Group names. STONE · BONE · IVORY · SILVER · GOLD · OBSIDIAN · NEON is the
  proposal — dice and bone materials climbing toward the game's own neon.

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
