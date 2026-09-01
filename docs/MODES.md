# Game modes — the design rules

*What a mechanical mode is allowed to be, why the current seven exist, and how
Rune Trial can appear beside them without pretending to be an eighth rules
modifier. The dated sprint history records what shipped when; this file records
**the thinking**. Its companion is `docs/SPELLS.md` — modes and runes are the
game's two variety layers and they interact (§6).*

A mechanical mode changes **the rules of the duel itself**, for both players,
for the whole match. Ranked spins for an eligible player-facing outcome before
the match starts; offline you pick one (or RANDOM, which spins in front of
you). Rune Trial is a selection format backed by Classic, not a mechanical
mode (§4).

---

## 1. What a mode may change

A mode is a variation on **scoring**, **destruction**, or **supply**. It is
not a new game.

- **Scoring** — ROW SWITCH (rows score instead of columns), ROW MULTIPLY (row
  matches pay again on top), BOUNTY (destroyed dice bank a permanent +1).
- **Destruction** — COLUMN SHIELD (a full column cannot be destroyed), SINGLE
  STRIKE (a hit takes one die, the closest to the centre).
- **Supply and end condition** — LIMITED (one shared bag of 24; the bag ends
  the match, full boards or not).

**CLASSIC must stay bit-identical to the pre-mode game.** Every mode branch is
written so the `mode === CLASSIC` path does exactly what the code did before
modes existed. This is not sentiment: classic is 40% of ranked matches and the
baseline every measurement is taken against.

## 2. The rules a mode may not break

- **Both players play the same mode.** Asymmetry is a different game.
- **It must be legible in one line.** Every mode's catalog entry carries a
  `blurb` that fits under the wheel and a `detail` for the sheet, keyed by its
  stable mode id. A mode that needs a paragraph to explain is too complicated
  for a dice game you play on a phone.
- **It must be visible on the board.** A shielded column wears a 🛡; BOUNTY
  shows its ✦ tally; row modes hang a per-row rail; LIMITED counts the bag.
  A rule the player cannot see operating is a rule they will think is a bug.
- **The AI must understand it.** `searchRoot` takes the mode, and `riskOf`
  carries per-mode loss heuristics. A mode the search is blind to produces a
  bot that plays it badly — which players read as the mode being broken.
- **It must survive replay.** The server validates a ranked match by replaying
  the move log through `core/rules` under the stored `modifier`. A mode whose
  outcome depends on anything but the log and the seed cannot ship.

## 3. The registry

One object in `core/modes.ts` is the whole mode rule: `mode` (numeric, used by
rules and AI), `id` (stored in `matches.modifier` — **never rename**), `icon`,
and `weight`. Player-visible `name`, `compact`, `blurb`, and `detail` live in
the localization catalogs under that same id. The wheel, badge, picker, and
library ask the localization adapter for copy; core never learns a language.

A mode carries **no seating opinion**. Who opens a ranked match is decided by
rating alone — the lower-rated player — and that rule is the same in every mode.
A `seatEdge` field existed for a few hours on 2026-08-22, flipping the seat
under LIMITED because its second mover is measurably favoured; it was reverted
by decision. A seating rule that varies per mode makes every new mode carry a
balance question, and the ~3.4-point error it corrected is smaller than the
confusion it added. The measurement is kept in `core/modes.ts` and
`docs/LADDER.md` — as context, explicitly not as something to act on again.

Adding a mechanical mode is: the registry entry, matching catalog copy in every supported
locale, its branches in `core/rules.ts` (scoring, destruction, or supply), its
heuristic in `core/ai.ts riskOf` if the loss maths differ, and its gate cases.
Then update the ranked-outcome registry and **redeploy the join function** —
the server owns the real outcome draw.

## 4. Ranked odds and progression

### Shipped pool — current behavior

The seven mechanical identities live in `core/modes.ts`; progressive ranked
outcomes and exact weights live in `core/ranked-outcomes.ts`. Weights are wheel
odds, not segment sizes (the dial draws eligible outcomes as equal nodes and
weights the pick).

**In the ordinary shipped ranked pool, Classic is exactly 40%; every eligible
addition shares the other 60% equally.** Access is a permanent high-water mark
derived from the player's historical ladder peak. As of 2026-09-01, the current
source registry is:

| Permanent pool | Peak floor | Eligible outcomes | Odds |
|---|---:|---|---|
| STONE | 0 | Classic; Single Strike; Column Shield; Limited | Classic 40%; each addition 20% |
| BONE | 300 | STONE + Row Switch; Row Multiply; Bounty | Classic 40%; each addition 10% |
| IVORY | 720 | BONE + Rune Trial | Classic 40%; each addition `60/7` (about 8.571%) |

Promotion affects the next match. Demotion and season turnover do not relock a
pool. A human match draws from the lower/shared permanent pool after
intersecting both clients' protocol capabilities; a bot match uses the human's
pool. An IVORY pairing whose peer cannot speak the Trial protocol therefore
keeps the ordinary seven-outcome 40/10 distribution rather than dealing an
unreadable Trial.

The BONE 40/10 distribution preserves the 2026-08-19 change from 50/50: the
additions *are* the game's variety, and half of all matches seeing none of them
made them feel rarer than intended. Any change here must be redeployed to the
join function, which owns the real pick.

### Decided successor progression — not shipped

The selected future schedule, pace evidence, exact target odds, one-time debut
matches, grandfathering rule, and implementation dependencies are authoritative
in `docs/LADDER.md §7`. It is intentionally separate from the shipped table
above: documentation alone does not change the client registry, persistence, or
the authoritative join function.

From the mode-design side, the order is fixed:

- Bounty replaces Limited in the STONE starting pool;
- Row Multiply is the sole BONE outcome unlock;
- Rune Ritual remains the IVORY format unlock;
- SILVER teaches equipped runes without adding a mode;
- Row Switch and Limited unlock together at GOLD;
- OBSIDIAN unlocks a weekly featured challenge; and
- NEON grants prestige and cosmetics, never exclusive mechanics or power.

This ordering is a teaching curve, not a fun ranking alone. Bounty has the
best excitement-to-rule-cost ratio. Row Multiply adds a second scoring axis
without invalidating the familiar column score. Row Switch and Limited demand
the most relearning of the mechanical modes, so they wait until the player has
crossed the long middle ladder. A two-mode bundle is acceptable there; it is
the five-game BONE bundle, not bundling in the abstract, that overloads current
onboarding.

The target's **steady-state ordinary** wheel retains Classic at 40% and splits
the remaining 60% equally. Guaranteed first bot exposures and an explicitly
chosen weekly challenge are deliberate exceptions: they exist so a promoted
player actually encounters the reward instead of waiting for a low-probability
wheel result.

The separately decided, unshipped finish-margin ladder transfer does not let a
high-scoring mode pay more merely because its numbers are larger. It uses the
final score gap divided by the two scores' sum, requests a **2–7** point
transfer from loser to winner, and may apply **0–7** at the loss cap or
zero-point floor; draws transfer zero. `docs/LADDER.md §1` owns the exact
formula, boundary behavior, forfeits, authority, persistence, and release
evidence.

The successor's canonical player-facing outcome order is defined once in
`docs/LADDER.md §7` and follows its unlock sequence. The implementation must
put one progression/display rank on the shared ranked-outcome registry and
reuse one roster-order helper for ranked-outcome entries in the offline pickers,
ranked spinner, library, and outcome-unlock slides. Those surfaces must not copy
arrays or comparators; their distinct inclusion/lock policies and non-outcome
slots are defined in `docs/LADDER.md §7`. The deterministic weighted draw
remains a separate concern: reordering the UI must never change a seeded RANDOM
result.

#### OBSIDIAN weekly featured challenge

The weekly feature is a recurring use of the existing game, not a promise to
author and validate a new mechanical mode every Monday. Version one deliberately
features an existing mechanical mode instead of forcing a curated rune pairing:
that preserves the mode's normal readable identity and avoids adding ownership
and balance questions to the first weekly release. Personal equipped runes may
still operate under the ordinary ranked rules.

`docs/LADDER.md §7` is the single authoritative contract for access, the global
week boundary, entry and matchmaking behavior, ladder settlement, the
idempotent cosmetic completion mark, replay, and the release bar for eventual
experimental rules.

### Shipped offline draws from the current pool

This subsection remains a description of shipped behavior; the successor
schedule above does not apply offline until its entitlement work ships.

**What a player may currently pick offline versus the AI is the pool their
ladder peak has already unlocked** — the shipped table at the start of §4,
read through `confirmedRankedPoolTier()`. A device with no confirmed tier
(signed out, never online, fresh install) is treated as STONE: it fails closed,
exactly as its
rune collection reads empty rather than complete. Local pass-and-play (`duo`)
is the one setup that exposes the whole game, the same exception
`availableRuneSpecs` already makes for runes.

One function decides it — `localPoolAccess()` in `src/local-options.ts` returns
the ranked pool's own `RankedParticipantAccess` record, and the picker's locks,
the RANDOM dial's ring, and the RANDOM draw all read that one roster through
`rankedOutcomeRoster()` / `pickRankedOutcome()`. This is not decoration: a ring
built from its own list is how a wheel comes to spin across a mode its own
picker locks. Rune Trial keeps both of its conditions — the IVORY tier *and*
three collected runes, since offline has to be able to deal the Trial's offer.

A pick the ladder has taken back resets to Classic (`normalizeLocalChoice`),
which is in every tier.

`RANDOM` (`-1`) is an offline picker promise to spin, not a stored outcome. It
is deliberately kept out of `MODES` so the dial can never land on RANDOM and
no match can be stored under it. The rune picker's RANDOM is the same shape,
and **wears the same mark** (`spellIcon` delegates to `modeIcon`): one idea,
one glyph. A hand-copied glyph already drifted here once.

### Rune Trial is a format, not an eighth modifier

Rune Trial is player-facing like a mode, but persists as
`format='rune_trial'` plus `modifier='classic'`. Scoring, destruction, supply,
placement AI, and replay therefore stay bit-identical to Classic. Format-aware
history and UI must never infer its label from `modifier` alone.

The Trial's pre-game is one reveal: the dial lands on RUNE RITUAL, the three
cards open over it, and both choices turn over on the same stage under one
countdown. The dial spins once and the overlay opens once.

The server derives a uniform three-distinct-rune offer: all 20 subsets of the
six-rune roster are equally likely, and both seats receive the same offer.
Each seat chooses independently and privately, so both may select the same
rune. Choices reveal together. A 30-second server deadline resolves any
missing choice with a deterministic participant-specific pick, including
before early resignation, timeout, deletion, or other settlement. Trial loans
the complete roster regardless of ownership. An equipped rune is ignored for
the duel and remains equipped and unmodified afterward.

Offline RANDOM follows the same 40/60 rule. Without an eligible Trial it spins
the seven ordinary outcomes at 40/10. With Trial eligible it keeps Classic at
40% and splits 60% equally across the six ordinary additions and Trial. Local
two-player is always eligible; CPU play becomes eligible after three collected
runes and offers three distinct collected runes.

## 5. Lessons burned in

**Protocol-changing server work waits for its client.** The mode-aware server
was deployed while the old client was still live, so it dealt modded matches
the client rendered as classic — the player saw "the AI always wins even
though I have more points". Hotfixed by pinning `modifier: 'classic'` until
the wheel client shipped.

**A mode heuristic must be measured, not reasoned.** The AI's risk model once
skipped shielded columns — a *true* fact about the rules and a **measured
loss**: closing a column deleted its `k²` risk from the eval, so the searcher
slammed columns shut on junk to bank the safety, and won only 44.5% of
colshield games against a twin that scored risk as classic (6,000 games).
Classic fear of a full column is wrong as a fact but right as a proxy for the
upside a closed column forfeits. The true dynamics stay in the search, where
`applyMove` knows shields block destroys. `tests/botbench.test.ts` §4 refuses
the skip's return.

**A mode's own mark may not name a colour.** ROW MULTIPLY brackets a row match
in the multiplier heat, and that heat is not a constant: a ×2 is gold and a ×3
hot orange *unless that side's player wears that hue*, in which case only their
multiplied dice fall back to ice / hot red, and colour blind mode pins both
fallbacks on both sides (`flow/menu.ts` writes `--p1-mx2…` inline on `<html>`;
`.die.p1` / `.die.p2` map them to `--mx2` / `--mx3` per side). So a mode mark
reads those tokens off the die and never a literal — otherwise it is correct
for the default pair and wrong for every player who picked gold, and wrong for
every colour blind player twice over. `tests/row-multiply-bracket.mjs` pins all three cases
in computed pixels, because nothing about a hard-coded colour looks broken
until someone changes a setting.

**The mode picker and the wheel must agree.** The offline picker, ranked wheel,
match badge, and library all read stable ids from the same rule registry and
copy from the same localization adapter. A card or screen that re-types a
mode's blurb is a copy that will drift.

## 6. Modes × spells

Offline, the player picks both, so the combinations are theirs to make. The
current standard still exposes two COLUMN SHIELD outliers; full measurements
are recorded in `docs/SPELLS.md §4`:

- **Current PILFER + COLUMN SHIELD (62.9%)** — the steal un-fills a
  nearly-full column, denying the shield the mode exists to grant. Its earlier
  baseline was 63.1%.
- **Current scoring WARD + COLUMN SHIELD (50.7%)** — the new mark has a legal
  scoring purpose, but the standard Normal policy still casts only .12 times
  per holder-game. The historical no-score result was 49.5% under a different
  harness and is not a controlled before/after estimate.

The shipped offline WARD deliberately layers with the mode. While WARD is
active, an all-distinct column adds its raw pips once after COLUMN SHIELD's
native score; a duplicate pauses that bonus but leaves the mark. A full
all-distinct shielded column is a legal WARD target. A matching hostile action
burns WARD with zero victims and zero BOUNTY while the permanent shield and all
three dice remain. A full shielded column containing a duplicate has no WARD
bonus or defensive work left to buy, so it is illegal. PILFER also burns an
active WARD and steals nothing, including on a full shielded target.

When adding a mode, ask what it does to each spell — particularly anything
that changes scoring or destruction (which is what WARD and SUNDER are about)
or supply (which is what FATE is about, and where LIMITED gives its redraw a
real cost).

## 7. The seven

| Mode | Icon | What changes |
|---|---|---|
| CLASSIC | ◆ | nothing — the baseline |
| ROW SWITCH | ☰ | only rows score; destruction still strikes down the column |
| ROW MULTIPLY | ✚ | columns score as always, row matches pay again on top |
| COLUMN SHIELD | 🛡 | a full column cannot be destroyed |
| SINGLE STRIKE | ☓ | a hit removes ONE die — the closest to the centre |
| BOUNTY | ✦ | every die you destroy banks a permanent +1 |
| LIMITED | ▦ | one shared bag of 24; the bag ends the match |

### Product hypothesis: fun and learning load

The table below is subjective product judgment used to sequence unlocks. It is
not player telemetry, a bot benchmark, or a measured win-rate claim. Fun is
expected excitement and replay appeal (1–5); rules complexity is the extra rule
burden above Classic (0–5); mastery difficulty is how hard optimal play is
(1–5), not how strong the opponent is. Rune Ritual is included because players
encounter it beside modes, even though it is a Classic-backed format rather
than an eighth mechanical modifier.

| Fun rank | Outcome | Fun | Rules complexity | Mastery difficulty | Product assessment |
|---:|---|---:|---:|---:|---|
| 1 | Bounty | 5/5 | 1/5 | 3/5 | Best excitement-to-rule-cost ratio: every destruction produces an immediate, visible bonus that lasts for the duel. |
| 2 | Row Multiply | 5/5 | 3/5 | 5/5 | Big combo payoffs and rich two-axis planning, while familiar column scoring remains intact. |
| 3 | Rune Ritual | 5/5 | 5/5 | 5/5 | Private choice, simultaneous reveal, rune matchups, and collection create the most variety; Classic board rules keep that complexity out of scoring and replay. |
| 4 | Limited | 4/5 | 3/5 | 5/5 | The dwindling shared supply and alternate ending create tension, but face counting and tempo make it demanding. |
| 5 | Single Strike | 4/5 | 1/5 | 3/5 | Surgical destruction is immediately legible, preserves valuable stacks, and shifts tactics without much teaching. |
| 6 | Classic | 4/5 | 0/5 | 3/5 | Cleanest and most replayable baseline, but familiarity means it is not a promotion reward. |
| 7 | Column Shield | 3/5 | 1/5 | 4/5 | The rule is simple and lock timing is subtle, but defensive closure can suppress the interaction that makes the duel exciting. |
| 8 | Row Switch | 3/5 | 2/5 | 5/5 | Deep, but scoring horizontally while destruction still attacks vertically is cognitively dissonant and least suitable for onboarding. |

Equal fun scores do not mean equal placement. Sequencing also weighs teaching
load and conceptual continuity: Bounty belongs at the start, additive Row
Multiply is the first unlock, and the high-mastery Row Switch/Limited pair
waits until GOLD.

## 8. BOUNTY's struck-coin presentation

BO2 is the production signature for a BOUNTY kill. Every die the rules
actually destroy is pressed flat in its own grid seat and receives one centred
BOUNTY `✦` coin in the attacker's heat. Survivors and dice protected by WARD
or COLUMN SHIELD receive no mark. This is presentation only: victim selection,
the permanent bank, the existing `+N ✦` feedback, scores, tallies, and replay
remain authoritative elsewhere.

A matching action against a full distinct shielded WARD spends WARD but
destroys no dice. It therefore mints no BOUNTY and shows no BO2 victim coin;
the gold COLUMN SHIELD remains after the mint clasp breaks.

### The timing contract

The selected study was authored on a **3.6s review loop**, but production uses
only its **16% through 60% active crop: 1584ms**. The remaining 1440ms was the
study's idle/reset tail and must never be added to gameplay. All times below
are relative to the attacking die landing in the grid:

| Beat | First victim | Second victim |
|---|---:|---:|
| Press begins | 144ms | 252ms |
| Squash peak | 288ms | 396ms |
| Die is flat/gone | 576ms | 684ms |
| Coin lands | 324ms | 432ms |
| Coin settles | 504ms | 612ms |
| Coin hold ends | 1080ms | 1188ms |
| Coin fade completes | 1440ms | 1548ms |

Victims are staggered by exactly **108ms**. A two-victim sequence cleans up at
1584ms, 36ms after the second coin fades. A third or later victim repeats the
same choreography at the same 108ms cadence; cleanup extends by 108ms for each
additional victim so the final coin always completes. Equivalently, for one or
more victims the cleanup offset is `1476ms + (victim count - 1) × 108ms`.

The die press lasts 432ms with `cubic-bezier(.4,0,.2,1)`: normal at the start,
`scaleY(.72) scaleX(1.06)` with `brightness(2.6)` at its peak, then
`scaleY(.08) scaleX(1.1)`, `brightness(3)`, and zero opacity. The coin lasts
1296ms with `cubic-bezier(.2,1.4,.4,1)`: hidden at scale `2.1`, lands at `.92`,
settles and holds at `1`, then fades while moving to `-58%` vertically and
scaling to `.9`. Its seat ring uses that same 1296ms clock with `ease-out`.

With SUNDER, SU6 still owns the victim's collapse, its 160ms stagger, and its
duration; BO2 adds only the centred coin and never applies the ordinary BOUNTY
flatten transform. Each coin begins 360ms before that victim's SU6 62% impact
so its settle lands exactly on the impact beat. The coin completes within SU6,
so the combination adds no time. Under reduced motion, all victims instead
show simultaneous static centred coins for 320ms, with no press, flare, or
stagger.

This contract is deliberately duplicated as named runtime constants and
browser assertions. Its duration drifted repeatedly when the study's review
tail was mistaken for gameplay, so changing any beat requires a new explicit
design decision rather than percentage reconstruction at a call site.

### What the design reference owns

`design/screens/product/46b-bounty-mint.html` is authoritative only for the
**game-grid kill treatment** described above. Any nameplates, score placement,
bottom points, or tally layout shown in an earlier 46b study are non-normative
composition aids and must not be copied into the game.

## 9. LIMITED's bag: the gutter and the top draw

The bag beside the die in play is `ui/bag.ts` plus the LIMITED block of
`styles/game/variants.css`, one implementation for offline and ranked. It shows
three things and never a fourth: **how many** are left, **that one just left**,
and nothing whatsoever about **which faces** remain — reading the board for
that is the mode.

### Where it stands

The bag is centred on the **first board column**, exactly as the rune card is
centred on the third (`calc(50% ± var(--cell) ± var(--gap))`, the same
expression with the sign flipped — `styles/game/spells.css` owns the other
half). The two things flanking the die in play are therefore symmetric about
it and each lines up with a real column above and below, rather than each
floating at its own offset from the stage.

Landscape's centre lane is only as wide as the die, so the pair stacks instead:
the rune keeps the space above the stage, the bag takes the space below it, on
the same 7px gap. That room is a **margin on the stage row, not padding** — the
rune card is anchored to the row's own box, so growing the box would walk the
card away from the die it belongs to. The margin leaves the row where it is and
moves the status line down instead, and only while a bag is on screen at all.

### The pile rounds; the gutter does not

The stack of face-down shells is a coarse gauge by construction —
`ceil(n/24 × 4)` shells, one per quarter — so it cannot tell six dice from one,
which is exactly the stretch of the match where the number matters most.
Design LI10 puts the exact supply in the lane at the pile's left edge: a 2px
column whose height is `n/24` of the pile, drawn over a full-height track at a
twelfth alpha so the scale itself stays readable when the supply is short.
`ui/bag.ts` sets `--bag-left` as the remaining fraction, because `BAG_SIZE` is
derived there from `POOL_PER_FACE × DICE_FACES`; a literal 24 in the
stylesheet would lie the day either moves.

It is **read as a length, not as marks to count.** The idea was proposed as a
collar of 24 countable teeth and refuted twice over: the collar anchored its
scale on the floor and right wall, where the shells permanently sit, and 24
ticks in 36px is a 1.5px pitch nobody resolves at arm's length. Only the left
gutter survives at every depth, and the counting claim is gone.

**Nothing in the gauge carries a hue.** Seven duel colours are pickable and
colour blind mode repoints the pair, so a gauge reading `--p1`/`--p2` would
mean different things on two phones. Repointing the pair must not move a
channel of it — `tests/limited-bag-gauge.mjs` asserts exactly that.

### The draw comes off the top

Every draw takes the shell the player is looking at, not only the one in six
that costs the pile a layer. A dedicated fifth shell (`.take`) rides whatever
layer is currently on top and is the only thing that moves: 300ms on
`cubic-bezier(.2,.72,.3,1)`, 13px up and to `scale(.76)`, holding full opacity
through the first 45% so it reads as a die being taken out rather than one
dissolving in place. The four shells below restack underneath it instead of
fighting an animation for the same element.

It is armed only when the painted count falls by **exactly one**. A fresh
game, a reconnect whose count arrives several dice on, and FA4 rewinding its
own bag all repaint the same elements with a jump, and none of them may throw
a die off the pile. Under reduced motion the lift collapses with every other
animation and the count, the shells and the column still land on the truth.

`design/screens/product/47j-limited-gutter.html` is the design reference for
both beats; `design/screens/studies/open/47a`–`47l` retain the rival proposals
and suppress the shipped gauge so each shows its own channel alone.

---

## 10. Future mode notebook — hypotheses, not roadmap

The following are active design ideas, not selected modes. None has a stable
id, registry entry, wheel weight, progression position, implementation
commitment, or balance evidence. Names, values, interaction rules, and even
mode status remain provisional. Recording them here preserves the reasoning;
it does not add them to the seven in §7 or to any unlock schedule.

**CROWN is only a working mode label.** It already names a different archived
rune candidate in `docs/RUNE_CANDIDATE_STUDY.md`; resolve that collision before
assigning any persisted id or localized identity.

| Candidate | Leading rule hypothesis | Why it is interesting |
|---|---|---|
| **FUSION** | Each player gets one fusion: their first own placement that creates an ordinary matching pair compresses it into one marked `×2` die. | Preserves familiar match scoring while reopening one cell; extraordinary concentration remains vulnerable to one ordinary matching strike. |
| **CROWN** | After ordinary column scoring, the exposed die in each nonempty column adds its raw face once. | Makes stack order matter with no remembered state; destruction can reveal a different crown and the maximum live bonus is +18. |
| **SIX CYCLE / SIXFOLD** | The shared seeded supply repeats shuffled sets containing one each of 1–6, while the board shows which faces remain in the current set. | Replaces streak randomness with visible, shrinking uncertainty rather than eliminating chance. SIXFOLD is a presentation/name variant, not a second rule. |
| **FULL HOUSE** | Each player owns one live `+10` House token. Their first newly completed column claims it; if that column is opened, their next future completion inherits it. | Creates one visible, attackable commitment without awarding three automatic bonuses to the player who fills the board. |
| **GATEHOUSE** | Each board begins with capacities `2 / 3 / 2`; completing the centre column permanently unlocks both outer crown cells. | Adds a build objective and attackable delay without creating a no-legal-move state or withdrawing an unlocked cell later. |

CROWN and FULL HOUSE fit the current scoring charter, and SIX CYCLE fits
supply. GATEHOUSE and FUSION do **not** fit §1 as written: one changes cell
access and the other changes physical occupancy. Keeping them in this notebook
permits study, not implementation. Promoting either requires an explicit
decision to expand the mode charter and a typed replay-safe representation for
its persistent state; neither may be hidden in UI state or encoded as a magic
die value.

### FUSION — bounded compression

The leading contract gives **one entitlement per player**, not one shared
prize and not one fusion per column:

1. A normal placement and its ordinary strike resolve first.
2. If that placement created the player's first pair of ordinary matching dice,
   the newer die merges into the older, centre-nearest match. The survivor is
   marked `×2`, one physical cell reopens, and that player's entitlement is
   permanently spent.
3. The `×2` die counts as two copies of its face for the existing
   `face × count²` formula. It cannot fuse again.
4. End-of-game evaluation happens after fusion, so filling the ninth physical
   cell with the triggering pair reopens the cell rather than ending the duel.
5. A hostile placement matching its face destroys the composite whole.

Thus a fused six alone scores `6 × 2² = 24`, exactly what the original pair
scored. Adding one ordinary six produces the familiar triple score `54`; two
ordinary sixes beside it produce effective multiplicity four and score `96`.
That ceiling is intentionally dramatic, but it requires four matching rolls
committed to one facing column and can disappear to one enemy six. A recursive
`1 + 1 → 2`, `2 + 2 → 4` ladder is a different, substantially wilder idea
and is not the leading ranked hypothesis.

The open rune questions are part of the candidate, not implementation trivia.
WARD must treat `×2` as a duplicate for its distinct-column score. SUNDER can
reach and shatter it through the ordinary strike plan. PILFER must retain its
one-die ceiling, which suggests peeling one unit rather than carrying a `×2`
composite intact; ANVIL must either retain the composite's multiplicity when
recasting it or refuse that target. Those choices require matchup measurement
before any rule is selected.

### FULL HOUSE — one deed per player

The ranked hypothesis is **not** a shared race. Each player has one independent
House entitlement:

- The first own column to transition from incomplete to full claims the
  player's `+10` token.
- The bonus is derived and live only while that marked column remains full; it
  is never banked.
- When any committed action opens the marked column, the token returns to its
  owner's rail. It does not teleport to another column that was already full.
- The next own transition from incomplete to full claims it, including a
  repair of the original column.
- Claims and losses settle after the complete cast/placement/destruction action
  and before terminal scoring.

One shared token would make the opening seat the legal first claimant: absent
destruction, it can complete a column on global move five while the replying
seat first can on move six. Since the prize itself encourages both players to
rush, that structural advantage is not suitable as the ranked hypothesis. A
shared **King of the House** version may still be a deliberately volatile local
experiment. Awarding `+N` to every full column is also rejected here: the
player ending the match necessarily owns three full columns, so the largest
bonus would be coupled automatically to terminal tempo. The single live `+10`
is a starting test value, not a balanced decision.

### CROWN, SIX CYCLE, and GATEHOUSE

**CROWN** adds the exposed die's raw face once after Classic column scoring;
it does not multiply the whole match group. A crown moves automatically when a
new die covers the old one or destruction exposes the die beneath. The score
therefore remains derived entirely from the board. The central question is
whether a maximum of 18 extra points changes enough placements without
overweighting high outer dice.

**SIX CYCLE** repeatedly shuffles a seeded `[1,2,3,4,5,6]` mini-bag. The next
cycle begins only when the current six are exhausted. Players see the faces
remaining in the current cycle, not their order. FATE consumes the next live
supply entry exactly as it does in LIMITED, making its pairing a mandatory
study: late-cycle knowledge may turn a redraw into denial of a predictable
opponent roll. Seat-swapped measurement must also establish that alternating
positions inside short cycles do not create an unacceptable opening edge.

**GATEHOUSE** starts both outer columns with their third, outermost cells
locked. The centre column remains fully available. The first time a player
fills their centre column, both own locks open permanently, even if that centre
column is later attacked. Initial capacity is seven, so using every available
cell necessarily completes the centre and opens the gates before deadlock.
Promotion would expand the mode charter from scoring/destruction/supply to
**board access**, and therefore needs legal-placement, fullness, replay, AI,
PILFER, ANVIL, WARD, and reconnect contracts rather than only CSS locks.

### Retained lower-priority scoring sketches

These remain useful comparison points, but none currently outranks the five
concepts above:

- **ALIGNMENT** — faces `1–2`, `3–4`, and `5–6` each have a visibly marked home
  column; a die in its home adds its raw face once. It creates a match-versus-
  lane choice on every roll.
- **ASCENT** — a die higher than the die beneath it adds its raw face once.
  This makes placement order matter across an entire stack, but needs an exact
  answer for score changes when destruction reconnects surviving dice.
- **SPAN** — a face present in all three columns earns one fixed cross-board
  bonus. It rewards distribution against Classic's concentration, but sits
  close enough to ROW MULTIPLY that it needs stronger proof of a distinct feel.
- **ROYAL ENDS** — in a full column, the centre-nearest die is Queen and the
  exposed die is King; if their faces total seven, the column earns `+7` while
  full. This is the cleanest King-and-Queen *mode* sketch, but the ordered
  two-card rune in `docs/SPELLS.md` currently owns the stronger version of that
  theme.

### Variants deliberately bounded or rejected

- **LOCKDOWN is not a mode.** A completed column already rejects placement;
  making it immune to destruction is COLUMN SHIELD under another name.
- CITADEL's fully locked centre until an outer column fills is a more dramatic
  GATEHOUSE presentation, but reduces the opening to two lanes and risks a
  scripted flank-first game.
- FUSION does not grant repeated or per-column fusions in the leading rule.
  Those variants extend matches and multiply catastrophic score states.
- A fused die losing only one layer when struck is built-in WARD/COLUMN SHIELD;
  whole-composite destruction is what gives compression its risk.
- Unlocks earned by destroying enemy dice compound an attack with additional
  capacity. Unlocks earned by losing dice teach the opponent to avoid ordinary
  destruction. Both are rejected reward loops.
- Double-roll-and-choose supply modes reproduce FATE; widened or remote attacks
  reproduce SUNDER/PILFER; kill rewards reproduce BOUNTY; permanent defensive
  marks reproduce WARD or COLUMN SHIELD.

### Evidence required before any promotion

Symmetric wording is not proof of fair play. Every candidate must first exist
in a reproducible pure-rules experiment with a candidate-aware search policy,
then clear:

- paired seeded games with seats swapped, reporting first-mover win/draw rate
  against Classic's baseline; no candidate may depend on restoring a
  mode-specific seating rule;
- score distribution, match duration, trigger/claim frequency, and whether the
  mechanic materially changes placement decisions rather than only totals;
- the complete current rune cross-table, with particular scrutiny on FATE and
  SIX CYCLE, and on PILFER/ANVIL/WARD/SUNDER around FUSION or persistent
  House/Gatehouse state;
- deterministic client/server replay, reconnect reconstruction, legal-move and
  no-deadlock cases, AI risk behavior, and proof that CLASSIC remains
  bit-identical; and
- visible board-state assertions for every crown, remaining-face tracker, lock,
  composite, and House transfer.

Open interaction choices must be selected and measured before implementation,
not inferred independently by flow, AI, replay, or presentation code.
