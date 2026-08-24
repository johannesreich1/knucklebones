# Game modes — the design rules

*What a mode is allowed to be, why the current seven exist, and what an eighth
would have to satisfy. The dated sprint history records what shipped when;
this file records **the thinking**. Its companion is `docs/SPELLS.md` — modes
and spells are the game's two variety layers and they interact (§6).*

A mode changes **the rules of the duel itself**, for both players, for the
whole match. Ranked spins for one before the match starts; offline you pick it
(or RANDOM, which spins in front of you).

---

## 1. What a mode may change

A mode is a variation on **scoring**, **destruction**, or **supply**. It is
not a new game.

- **Scoring** — ROW SWITCH (rows score instead of columns), ROW MULTIPLY (row
  matches pay again on top), BOUNTY (destroyed dice bank a permanent +1).
- **Destruction** — COLUMN SHIELD (a full column cannot be struck), SINGLE
  STRIKE (a hit takes one die, the closest to the centre).
- **Supply and end condition** — LIMITED (one shared bag of 24; the bag ends
  the match, full boards or not).

**CLASSIC must stay bit-identical to the pre-mode game.** Every mode branch is
written so the `mode === CLASSIC` path does exactly what the code did before
modes existed. This is not sentiment: classic is 40% of ranked matches and the
baseline every measurement is taken against.

## 2. The rules a mode may not break

- **Both players play the same mode.** Asymmetry is a different game.
- **It must be legible in one line.** Every mode carries a `blurb` that fits
  under the wheel and a `detail` for the sheet. A mode that needs a paragraph
  to explain is too complicated for a dice game you play on a phone.
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

One object in `core/modes.ts` is the whole mode: `mode` (numeric, used by
rules and AI), `id` (stored in `matches.modifier` — **never rename**), `name`,
`icon`, `blurb`, `detail`, `weight`. The wheel, the badge, the picker and the
library never learn a mode's name.

A mode carries **no seating opinion**. Who opens a ranked match is decided by
rating alone — the lower-rated player — and that rule is the same in every mode.
A `seatEdge` field existed for a few hours on 2026-08-22, flipping the seat
under LIMITED because its second mover is measurably favoured; it was reverted
by decision. A seating rule that varies per mode makes every new mode carry a
balance question, and the ~3.4-point error it corrected is smaller than the
confusion it added. The measurement is kept in `core/modes.ts` and
`docs/LADDER.md` — as context, explicitly not as something to act on again.

Adding a mode is: the registry entry, its branches in `core/rules.ts`
(scoring, destruction, or supply), its heuristic in `core/ai.ts riskOf` if the
loss maths differ, and its gate cases. Then **redeploy `pvp-join`** — it alone
spins the wheel server-side.

## 4. Ranked odds

Set in `core/modes.ts`; weights are wheel odds, not segment sizes (the dial
draws every mode as an equal node and weights the pick).

**Classic 40% (weight 4 of 10); each of the six additions 10% (weight 1).**

Changed from 50/50 on 2026-08-19: the additions *are* the game's variety, and
half of all matches seeing none of them made them feel rarer than intended.
Any change here must be redeployed to `pvp-join`, which owns the real pick.

`RANDOM` (`-1`) is the offline picker's eighth option — a promise to spin, not
a mode. It is deliberately kept out of `MODES` so the dial can never land on
it and no match can be stored under it. The spell picker's RANDOM is the same
shape, and **wears the same mark** (`spellIcon` delegates to `modeIcon`): one
idea, one glyph. A hand-copied glyph already drifted here once.

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
every colour blind player twice over. `tests/test21.mjs` pins all three cases
in computed pixels, because nothing about a hard-coded colour looks broken
until someone changes a setting.

**The mode picker and the wheel must agree.** The offline picker, the ranked
wheel, the match badge and the library all read the same registry. A card or
screen that re-types a mode's blurb is a copy that will drift.

## 6. Modes × spells

Offline, the player picks both, so the combinations are theirs to make — but
two are known-bad and are recorded in `docs/SPELLS.md §4`:

- **PILFER + COLUMN SHIELD (63.1%)** — the steal un-fills a nearly-full
  column, denying the shield the mode exists to grant.
- **WARD + COLUMN SHIELD (49.5%)** — worthless: the mode already protects full
  columns and a shielded column may not be warded.

Both pickers now offer RANDOM, so a random/random deal can land on the dead
pairing. Whether the deal should refuse it is **open**.

When adding a mode, ask what it does to each spell — particularly anything
that changes destruction (which is what WARD and SUNDER are about) or supply
(which is what FATE is about, and where LIMITED gives its redraw a real cost).

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

## 8. BOUNTY's struck-coin presentation

BO2 is the production signature for a BOUNTY kill. Every die the rules
actually destroy is pressed flat in its own grid seat and receives one centred
BOUNTY `✦` coin in the attacker's heat. Survivors and dice protected by WARD
or COLUMN SHIELD receive no mark. This is presentation only: victim selection,
the permanent bank, the existing `+N ✦` feedback, scores, tallies, and replay
remain authoritative elsewhere.

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
