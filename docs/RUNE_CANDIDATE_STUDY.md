# Exploratory rune candidate study — 2026-08-25

This document records an **exploratory design experiment**, not the current
rune registry. None of BARTER, MIMIC, CROWN, INFUSE, MIRROR, RELAY, or PRISM
is shipped or present in `SPELLS`. The measurements came from a temporary,
untracked TypeScript harness that imported the repository's pure rules. That
harness is not checked in, no source revision was frozen, and there is no
repository command that reproduces these tables. The method is recorded below
so a later implementation can build a proper, reviewable experiment rather
than treating these estimates as release evidence.

**CROWN warning:** its temporary search preview used synthetic WARD marks to
model a no-strike placement. That stopped being equivalent once WARD gained a
score bonus and persistent search behavior. CROWN's recorded rows are retained
as provenance, but they do not estimate the rule stated below and must not be
used for balance ranking.

The live cast rule applied throughout: a cast is not a move, the die still
lands afterward, and a player may cast at most once per turn. Every candidate
below was tested with one charge.

---

## 1. Exact rules tested

These are mechanical definitions used by the temporary harness. Names and
wording remain candidate copy, not stable persisted ids.

### BARTER

Choose a nonempty own column whose top die differs from the held die. Replace
that top with the held die without causing a strike, put the removed top die
in hand, then place the new held die normally. Full own columns were legal
targets; replacing their top did not change their height or COLUMN SHIELD
state. One charge.

### MIMIC

Choose a nonempty own column whose top die differs from the held die. The
source column remains unchanged; the held die becomes that top face, then is
placed normally. A target that would leave the hand unchanged was illegal.
Full own columns were legal sources. One charge.

### CROWN

If the held die is not a 6, change it to 6. Its immediately following
placement adds the 6 to the caster's board but causes no strike. A held 6 was
an illegal no-op. The quiet placement destroyed nothing and earned no BOUNTY.
One charge.

The experiment had no mixed CROWN-versus-WARD games, so whether “no strike”
must explicitly preserve an enemy WARD was not separately measured. The
recommended interpretation is that no hostile action occurs and the WARD
therefore remains, but that is an implementation decision rather than
evidence from this study.

### INFUSE

With a held die above 1, choose a nonempty, non-full own column whose top die
is below 6. Increase that top die by 1 without causing a strike, reduce the
held die by 1, then place the reduced die normally. The legality restrictions
guaranteed that both transfers changed state. One charge.

### MIRROR

Change the held face `d` to `7 - d`, then place it normally. On a six-sided
die this always changes the face. The machine could hold the charge when the
change was not valuable, but the transform itself was mechanically legal for
every held face. One charge.

### RELAY

BARTER restricted to an own column containing exactly one die: exchange the
held die with that singleton without a strike, then place the removed die
normally. The singleton had to differ from the held die. One charge.

### PRISM

Place the held die with its original face, so that face remains on the
caster's board and scores normally, but resolve destruction in the normal
facing column against `7 - heldFace`. COLUMN SHIELD, SINGLE STRIKE, and BOUNTY
were applied to that opposite-face destruction. One charge.

The harness treated PRISM as mechanically available on every hand and made
the machine cast only when its coordinated placement improved over an
ordinary placement. It did **not** settle the player-facing legality question:
whether a PRISM cast whose eventual outcome equals an ordinary placement is
an illegal no-op or merely an unwise legal cast. Resolve that before any
implementation.

---

## 2. Method

### Engine and game policy

- Node `v24.2.0`, using TypeScript type stripping.
- Current pure `src/core/rules.ts`, `src/core/ai.ts`, `src/core/dice.ts`, and
  `src/config.ts` as they existed in the working tree during the study. No
  commit was pinned.
- Empty boards, fresh charm state, zero BOUNTY banks, and one candidate charge
  for each holder.
- Offline Medium placement anchor: depth 2, risk weight `0.9`, opponent weight
  `1`.
- Infinite modes rolled `1 + floor(supplyRandom() * 6)`. LIMITED used the
  repository's `makeBag(supplyRandom)`.
- Ordinary placement used its own seeded tie-break stream. Candidate previews
  returned a constant `0.5` to search, making exact ties choose the first
  legal column without consuming the supply or ordinary-search streams.
- Games ended through the current mode's normal full-board or finite-bag
  condition. Candidate casts did not replace the required placement.

Candidate-only games never armed WARD or SUNDER. WARD work that was present in
the live working tree therefore did not add a scoring mark to these games, but
the lack of a pinned source revision remains a limitation.

### Determinism and samples

The two recorded base seeds were `20260825` and `20260826`. The temporary
harness used the same Mulberry32 generator pattern as the repository's
simulation tools, with separate domains for supply and ordinary search. For
each game it derived:

```text
gameSeed = mix(baseSeed, mode, gameIndex, experimentDomain)
supply   = mulberry32(mix(gameSeed, 1))
search   = mulberry32(mix(gameSeed, 2))
```

`experimentDomain` was `11` for one-sided power and `22` for symmetric timing.
`mix` started with the signed 32-bit base seed and, for each integer part,
applied:

```text
out = imul(out XOR (part + 0x9e3779b9), 0x85ebca6b)
out = out XOR (out >>> 13)
```

For every two-seed candidate/mode row and every base seed:

- **One-sided:** 3,000 games. The holder alternated by `gameIndex % 2`; the
  starter alternated independently by `floor(gameIndex / 2) % 2`.
- **Symmetric:** 3,000 games with both seats holding the candidate; the starter
  alternated by `gameIndex % 2`.

Thus each two-seed power estimate averages 6,000 one-sided games, and each
two-seed timing row averages a separate 6,000 symmetric games. The smaller
screens and threshold sweeps are labelled separately and must not be read as
equally strong evidence.

### Cast-and-placement policy

For BARTER, MIMIC, CROWN, INFUSE, MIRROR, and RELAY the machine:

1. Found every mechanically legal cast target.
2. Previewed the ordinary depth-2 placement without casting.
3. For each cast target, cloned the board, applied the cast transformation,
   previewed the transformed hand's depth-2 placement, and measured the
   immediate score-difference after that full turn.
4. Selected the target and placement with the largest improvement over the
   previewed ordinary turn.
5. Cast only when that improvement met the candidate threshold, then reused
   the selected placement.

The score-difference comparison used the active mode's board scoring and added
the per-kill bank in BOUNTY. It was an immediate post-placement comparison;
the cast threshold did not value candidate identity or unspent charges in
future plies. The placement search itself was depth 2.

CROWN's preview used synthetic enemy wards in a cloned root charm to suppress
destruction, while actual candidate resolution directly pushed the 6 without
striking. Under the current scoring-WARD rule those synthetic marks also add
opponent score, persist through search, and may be consumed by matching
placements. The preview was therefore **not** mechanically equivalent to a
quiet placement, even though the games began without real WARD marks. All
CROWN rows below are policy-contaminated and require a corrected rerun through
a real strike-override seam.

PRISM was the exception: the existing search has no “place one face, strike
another” root state. Its candidate placement was therefore selected by exact
enumeration of **immediate** legal outcomes, not depth-2 search. Its estimates
are less comparable to the other candidates.

### Experimental thresholds

These values priced the machine's decision; they were not player-facing rune
costs and are not proposed registry constants.

| Candidate | Ordinary threshold |
|---|---:|
| BARTER | 8 |
| MIMIC | `16 / 3` = 5.333… |
| CROWN | `16 / 3` = 5.333… |
| INFUSE | `16 / 3` = 5.333… |
| MIRROR | `16 / 3` = 5.333… |
| RELAY | 8 |
| PRISM | 1 |

Like the existing machine policy, all candidates used a threshold of 1 when
the caster had at most one board slot left. BARTER and RELAY also received
single-seed threshold screens (§4).

---

## 3. Recorded two-seed screening estimates

All percentages below are raw holder win rates, not a model-adjusted effect.
The adjacent no-cast control shows the seed batch's baseline. “Delta” is the
arithmetic difference between the two displayed means; divergent game paths
mean it is useful context, not a paired causal estimator.

Rows marked `†` are the raw CROWN harness output. Because its preview was
contaminated by synthetic scoring WARDs (§2), they are not estimates of the
stated CROWN mechanic and are excluded from recommendations.

### No-cast controls

| Mode | Seed 20260825 | Seed 20260826 | Mean |
|---|---:|---:|---:|
| Classic | 51.3% | 48.4% | 49.9% |
| ROW SWITCH | 48.8% | 50.4% | 49.6% |
| ROW MULTIPLY | 50.4% | 48.9% | 49.7% |
| COLUMN SHIELD | 49.1% | 51.3% | 50.2% |
| SINGLE STRIKE | 49.7% | 50.2% | 50.0% |

The opposite Classic offsets in the two seeds are why the study reports their
aggregate rather than promoting the first 3,000-game run alone.

### One-sided power

| Candidate / mode | 20260825 | 20260826 | 6,000-game mean | Control mean | Delta |
|---|---:|---:|---:|---:|---:|
| BARTER / Classic | 56.5% | 54.4% | **55.5%** | 49.9% | +5.6pp |
| MIMIC / Classic | 56.3% | 55.1% | **55.7%** | 49.9% | +5.9pp |
| CROWN / Classic `†` | 57.5% | 55.5% | **56.5%** | 49.9% | +6.7pp |
| INFUSE / Classic | 57.3% | 54.2% | **55.8%** | 49.9% | +5.9pp |
| MIRROR / Classic | 60.9% | 59.2% | **60.1%** | 49.9% | +10.2pp |
| RELAY / Classic | 51.8% | 49.4% | **50.6%** | 49.9% | +0.8pp |
| PRISM / Classic | 53.7% | 52.2% | **53.0%** | 49.9% | +3.1pp |
| BARTER / COLUMN SHIELD | 58.9% | 61.6% | **60.3%** | 50.2% | +10.1pp |
| MIMIC / COLUMN SHIELD | 64.2% | 67.0% | **65.6%** | 50.2% | +15.4pp |
| CROWN / COLUMN SHIELD `†` | 62.1% | 65.0% | **63.6%** | 50.2% | +13.4pp |
| INFUSE / COLUMN SHIELD | 59.5% | 60.0% | **59.8%** | 50.2% | +9.6pp |
| BARTER / SINGLE STRIKE | 56.6% | 56.4% | **56.5%** | 50.0% | +6.6pp |
| MIMIC / SINGLE STRIKE | 63.3% | 62.6% | **63.0%** | 50.0% | +13.0pp |
| CROWN / SINGLE STRIKE `†` | 60.9% | 61.0% | **61.0%** | 50.0% | +11.0pp |
| INFUSE / ROW SWITCH | 55.9% | 57.4% | **56.7%** | 49.6% | +7.1pp |
| INFUSE / ROW MULTIPLY | 54.8% | 55.2% | **55.0%** | 49.7% | +5.4pp |

### Symmetric participation and timing

These rows average the two 3,000-game symmetric runs. “Casts/game” counts both
seats, so 2.0 means almost every player spent the one charge. Planned gain is
the policy's immediate full-turn improvement at casts it chose, not the
registry's board-only `swingOf` value.

| Candidate / mode | One-sided casts / holder game | Symmetric games with any cast | Symmetric casts / game | Mean planned gain | q25 / median / q75 | Late casts |
|---|---:|---:|---:|---:|---:|---:|
| BARTER / Classic | .463 | 72.8% | .955 | 12.3 | .54 / .72 / .89 | 39.1% |
| MIMIC / Classic | .997 | 100.0% | 1.993 | 11.8 | .11 / .17 / .27 | 1.0% |
| CROWN / Classic `†` | .800 | 97.8% | 1.592 | 13.0 | .19 / .38 / .68 | 18.8% |
| INFUSE / Classic | .752 | 93.9% | 1.566 | 11.8 | .22 / .39 / .62 | 11.5% |
| MIRROR / Classic | .951 | 99.8% | 1.934 | 13.6 | .15 / .26 / .41 | 3.9% |
| RELAY / Classic | .057 | 11.6% | .124 | 12.3 | .53 / .67 / .80 | 25.5% |
| PRISM / Classic | .974 | 99.9% | 1.972 | 5.3 | .11 / .19 / .32 | 1.3% |
| BARTER / COLUMN SHIELD | .490 | 77.4% | .980 | 12.8 | .57 / .73 / .89 | 39.6% |
| MIMIC / COLUMN SHIELD | .994 | 100.0% | 1.991 | 11.9 | .16 / .24 / .33 | 1.5% |
| CROWN / COLUMN SHIELD `†` | .734 | 95.9% | 1.491 | 13.1 | .24 / .47 / .80 | 25.0% |
| INFUSE / COLUMN SHIELD | .617 | 86.1% | 1.270 | 9.6 | .28 / .48 / .71 | 16.9% |
| BARTER / SINGLE STRIKE | .480 | 73.7% | .970 | 11.8 | .58 / .76 / .93 | 44.4% |
| MIMIC / SINGLE STRIKE | .996 | 100.0% | 1.993 | 12.3 | .13 / .19 / .29 | 1.0% |
| CROWN / SINGLE STRIKE `†` | .777 | 96.6% | 1.528 | 12.9 | .21 / .41 / .75 | 22.5% |
| INFUSE / ROW SWITCH | .895 | 99.0% | 1.827 | 11.7 | .24 / .38 / .57 | 6.8% |
| INFUSE / ROW MULTIPLY | .952 | 99.7% | 1.918 | 17.0 | .20 / .31 / .48 | 3.6% |

---

## 4. Smaller screens and tuning probes

These are deliberately separated from the recorded two-seed screens.

### BARTER threshold sensitivity — Classic, seed 20260825 only

Each row used 3,000 one-sided and 3,000 symmetric games. The no-cast control
for this seed was 51.3%.

| Threshold | Holder win | Casts / holder game | Symmetric games with cast | Symmetric casts / game | Mean planned gain | q25 / median / q75 | Late casts |
|---:|---:|---:|---:|---:|---:|---:|---:|
| 8 | 56.5% | .458 | 72.9% | .959 | 12.3 | .54 / .71 / .89 | 38.7% |
| `16 / 3` | 56.7% | .525 | 78.0% | 1.082 | 11.0 | .52 / .68 / .86 | 33.8% |
| 1 | 57.1% | .720 | 91.9% | 1.494 | 6.7 | .45 / .60 / .76 | 20.0% |

This probe says the chosen machine price strongly changes participation and
timing while barely moving this seed's headline. It does not establish that a
human who hoards optimally would have the same power.

### RELAY lower-threshold probe — Classic, seed 20260825 only

| Threshold | Holder win | Casts / holder game | Symmetric games with cast | Symmetric casts / game | Mean planned gain | q25 / median / q75 | Late casts |
|---:|---:|---:|---:|---:|---:|---:|---:|
| 8 | 51.8% | .054 | 12.0% | .129 | 12.5 | .53 / .67 / .80 | 25.3% |
| 1 | 52.5% | .226 | 39.1% | .497 | 5.0 | .48 / .63 / .77 | 18.9% |

Even an almost-greedy policy left RELAY unused in most games.

### PRISM mode screen — seed 20260825, 1,000 games per experiment

This lower-confidence screen used 1,000 one-sided and 1,000 symmetric games
per mode. It has no matching 1,000-game control table, and PRISM used immediate
rather than depth-2 candidate placement selection.

| Mode | Holder win | Casts / holder game | Symmetric casts / game | Symmetric median |
|---|---:|---:|---:|---:|
| Classic | 52.6% | .969 | 1.978 | .19 |
| ROW SWITCH | 53.1% | .988 | 1.993 | .21 |
| ROW MULTIPLY | 54.9% | .983 | 1.982 | .20 |
| COLUMN SHIELD | 57.3% | .821 | 1.718 | .24 |
| SINGLE STRIKE | 55.9% | .966 | 1.966 | .21 |
| BOUNTY | 51.4% | .966 | 1.955 | .19 |
| LIMITED | 54.1% | .964 | 1.947 | .21 |

---

## 5. What was measured, and what is an educated guess

### Measured by this temporary harness

- The raw win, participation, planned-gain, and timing estimates in §§3–4
  under the exact machine policy in §2.
- MIMIC's sharp COLUMN SHIELD and SINGLE STRIKE increases under that policy.
- BARTER's low participation and late timing at threshold 8, plus the way a
  lower threshold changed its texture in one seed.
- INFUSE's measured Classic and selected-mode band: 55.0–59.8% raw across the
  recorded two-seed rows, with broader timing than MIMIC or MIRROR.
- CROWN's raw harness output, but **not** the intended quiet-placement rule:
  its synthetic-WARD preview contaminated both placement choice and score.
- RELAY's inactivity and PRISM's weak Classic estimate under their tested
  policies.

### Educated design judgments, not measured facts

1. **INFUSE is the best next experiment, not yet a balance recommendation.**
   Its one-pip transfer makes the benefit depend on the actual roll, charges a
   visible self-side price, offers a real column choice, and stays distinct
   from ANVIL by refusing full columns. Its recorded mode rows did not exceed
   60% raw, but SINGLE STRIKE, BOUNTY, LIMITED, and every
   candidate-versus-current-rune cell remain absent.
2. **BARTER is tactically rich but needs policy and interface work.** Its
   Classic headline is modest, yet the threshold-8 bot often never uses it and
   casts late. COLUMN SHIELD reaches 60.3% and lets it rewrite a protected full
   top without losing protection, overlapping ANVIL's repair space. Lower
   machine demand appears more promising than adding charges, but only one
   seed tested that adjustment.
3. **CROWN is readable but currently unrankable.** “Build a six but surrender
   the attack” remains a clear concept. Its numeric rows cannot support a
   fallback recommendation until a real no-strike seam replaces the
   synthetic-WARD preview and the study is rerun.
4. **MIMIC should not ship as tested.** The concern is not its 55.7% Classic
   estimate alone; it casts almost automatically near the opening and reaches
   65.6% in COLUMN SHIELD. Copying the first useful own top looks closer to a
   solved trigger than a lasting decision.
5. **MIRROR is strong but redundant.** Its 60.1% Classic estimate fits the
   historical upper band, but its early, near-universal cast resembles a
   simpler NUDGE/FATE transform rather than adding a new board decision.
6. **RELAY is too restricted and PRISM is too weak at one charge.** PRISM's
   opposite-face strike is mechanically distinctive, but the tested policy
   spent it almost immediately for a small gain. Neither result justifies
   implementation without redesign and a new measurement.

The evidence-bounded next step is therefore deliberately narrower than a full
ranking:

```text
prototype INFUSE in a checked-in seam → rerun all modes → build a fresh
current-roster cross-table → then decide whether any candidate advances
```

The only asymmetric roster matrix currently available predates scoring WARD.
It cannot establish how a candidate fits the live six-rune roster, so none of
these concepts can yet be called roster-balanced.

---

## 6. Implementation seams if a candidate advances

### Board-and-hand transforms

BARTER, MIMIC, INFUSE, and RELAY fit a one-use, own-column `SpellSpec`:

- `legal()` owns their exact target restriction.
- `previewDieIndex()` can identify the visible source or changed top die.
- `apply()` mutates the own column where applicable and writes the transformed
  hand through `CastCtx.setDie()`.
- Their board-side mutation is not a thrown placement and therefore does not
  call `applyMove` or strike.

MIRROR is a self spell that only needs `CastCtx.setDie()`.

The default board-only policy is insufficient. `swingOf()` sandboxes
`setDie()`, correctly making hand mutations invisible, while these candidates'
value lives in the combination of cast target, new hand, and next placement.
Each needs a custom whole-turn CPU valuation.

The current `machineCastPlan` can coordinate a root charm or veto a hazardous
placement, but it cannot ask a candidate to preview a transformed board/hand
for several targets and return the chosen `{ target, placement }`. If exact
reuse is required, add a narrow registry-owned planning seam rather than
teaching flow the candidate ids. Recomputing placement after `apply()` is a
simpler alternative, but it is not the exact policy measured here.

### Placement strike override

CROWN and PRISM should not be implemented with fake wards. A reusable pure
state seam could represent one consumed root-strike override per player with
three semantic states:

```text
no override          → strike the placed face normally
override to a face   → PRISM strikes that face
override to no face  → CROWN produces no strike
```

`openStrikes()` should consume and interpret that state while `applyMove()`
still pushes the actual held face. The animated flow already reads the shared
strike plan, so this keeps headless rules, search, replay, and visible victims
on one implementation. A candidate spec can expose the cloned override through
`cpuRootCharm()` so placement search evaluates its real root move.

Before implementation, define precedence with SUNDER even though the live
one-cast-per-turn rule prevents one player from casting both on the same turn.
CROWN's quiet placement should also explicitly preserve WARD and award zero
BOUNTY; PRISM's opposite-face victims should interact with WARD, COLUMN SHIELD,
SINGLE STRIKE, and BOUNTY through the shared strike plan.

### Verification still required

Any promoted candidate needs:

- a checked-in `SpellSpec`, pure rule tests, registry contract coverage,
  localized copy, icon, animation, and browser-visible target/placement tests;
- a checked-in, reviewable simulation path using the production cast planner;
- all-mode one-sided and symmetric timing runs, not only the hotspots here;
- head-to-head evidence before making any RANDOM 2 fairness claim;
- explicit mixed interaction tests for WARD, SUNDER, BOUNTY, COLUMN SHIELD,
  SINGLE STRIKE, and LIMITED as applicable;
- human playtesting for comprehension, target regret, and whether measured
  trigger timing actually feels like a decision.

---

## 7. Limitations

- The harness and candidate specs were temporary and untracked. This study is
  an audit record, not reproducible release evidence.
- No commit was pinned while concurrent work existed in the working tree.
- The estimates use one heuristic caster. A stronger human can find different
  targets or hold a charge more effectively.
- One-sided power is holder-versus-bare. It does not measure candidate versus
  current rune matchups and cannot establish RANDOM 2 fairness.
- Symmetric timing gives both seats the same candidate. It does not capture
  adaptation to a different visible enemy rune.
- Candidate valuation used immediate post-placement gain after a depth-2
  placement preview; future search did not know rune identity or remaining
  charges.
- PRISM used immediate placement enumeration and is less comparable still.
- CROWN's synthetic-WARD preview changed score and search behavior; its rows
  do not estimate the intended quiet-placement rule.
- The two deterministic seeds reduce the visible seed offset but do not form a
  broad sensitivity study or a formal uncertainty analysis.
- The available current-rune matchup matrix predates scoring WARD, so even a
  candidate with complete one-sided mode coverage would still lack a current
  roster-balance yardstick.
- Several semantic questions remain deliberately open: PRISM no-op legality,
  CROWN/WARD resolution, and generic strike-override precedence with SUNDER.

Treat every number here as an educated screening estimate until a candidate
exists in the registry and the checked-in production policy can measure it.
