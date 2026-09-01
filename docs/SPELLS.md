# Spells — the design rules

*What a spell is allowed to be in this game, why the current six exist, and
what a seventh would have to prove. The dated sprint history records what
shipped when; this file records **the thinking**, so a later session can add a
spell without re-deriving it — or can knowingly overrule it.*

**Vocabulary boundary.** Players choose, receive, hold and spend **runes**, so
all player-facing category labels say *Rune / Runes*. In code and in this
technical document, *spell* names the castable rules effect and its engine
(`SpellSpec`, `SPELLS`, `spellCharges`). Keep that implementation vocabulary;
do not expose it as a competing name for the player's rune.

Runes are an **optional layer over offline play**, ordinary ranked after a
participant has reached SILVER once, and the IVORY Rune Trial ranked format. A
named offline pick and RANDOM deal both seats the same rune.
RANDOM×2 is the explicit local chaos exception: the deck shuffles once per
player and deals two distinct runes. A cast is **not a placement**, but each
player may cast at most once per turn. The die still lands afterward unless
the cast itself ends the game. FATE's two charges therefore belong to separate
turns. In ordinary ranked, matchmaking snapshots each participant's equipment
independently once each participant has reached SILVER. That access is
permanent across demotion and season turnover. A fixed seat carries that rune;
RANDOM always draws one owned rune from the fresh match seed. A participant
who has never reached SILVER, or has empty equipment, has no rune. Rune Trial
ignores equipment and uses its own private choices.

---

## 1. The four principles

Every spell in this game is judged against these. They came out of retiring
the first one (§3), and they are the reason the current six feel different
from it.

**Earned beats free.** A spell whose power depends on the die you actually
rolled, or on a board state you had to build toward, reads as skill. A free
button that confiscates the opponent's work reads as theft. Destroyed dice are
already in Knucklebones' emotional vocabulary; *stolen* dice are not, which is
why PILFER is capped at a single die.

**Bounded beats unbounded.** A ceiling you can name — one die, one strike, one
pip — can be costed and balanced. "Your whole best column, twice over" cannot.

**Your side beats their side.** Effects on your own hand or board (a redraw, a
nudge, a ward) are empowering and nearly impossible to resent. A healthy
roster is mostly self-side with at most one aggressive option.

**A real decision beats a solved one.** If the optimal cast time is always
"the last possible turn", the spell is a ritual, not a choice. This is the
principle the measurement harness exists to check — see §5.

### The corollary: counterplay must not tax the fun

A spell whose counter is "don't build triples" is bad even when it is
perfectly fair on paper, because building triples is the game. Ask of any
candidate: *what does a good opponent do differently while I hold this?* If
the answer is "plays worse on purpose", reject it.

---

## 2. The house rules a spell may not break

These are structural, not taste. Breaking one is a redesign, not a tweak.

- **Symmetry by default.** A named rune and RANDOM deal the same rune to both
  seats, so ordinary balance is about whether it is *fun*, never whether the
  deal is *fair*. RANDOM×2 deliberately suspends that guarantee. It is labelled
  as a wild, uneven variant and never replaces the persisted shared-RANDOM
  choice.
- **Visible threats.** The opponent's rune and remaining charges are always on
  screen. Every deal keeps one persistent card hand per seat: shared deals show
  two matching hands, while RANDOM×2 shows two different ones. Player-colour
  edges identify ownership and the active hand moves forward every turn. A
  spell you cannot see coming is a trap, not a duel.
- **Legality is the only failure path.** An illegal target is refused *before*
  anything moves, so a cast can never half-happen and leave the boards in a
  state nobody designed. A cast that would change nothing is illegal, not a
  wasted charge (a second ward on one column; a ward on a full matched
  COLUMN SHIELD column). A full all-distinct shielded column is different: its
  scoring bonus and spendable clasp both make it a legal WARD target.
- **Never demand input outside your own turn.** No reactions, no interrupts.
  WARD is cast in *anticipation* and resolves by itself. This is also what
  makes the layer safe for a turn-based network protocol: a cast is one more
  ordered entry in the move log, so latency can delay what the opponent
  *sees*, never create a race. Interrupt spells would need sub-second
  bidirectional windows — we do not build those.
- **A committed cast cannot be taken back.** A rune may be disarmed while the
  player is only asking the board a question; once the spell commits, its
  charge and information are final. FATE, NUDGE and SUNDER commit when their
  valid self cast lands on the die in hand. WARD and PILFER commit when a legal
  column is selected. Once PILFER is armed it must be answered with a legal
  enemy column rather than disarmed; its charge remains intact until that
  answer lands. ANVIL is the deliberate exception: identifying the
  weakest die in every offered full column is already useful information, so
  it commits as soon as those markings appear. There is no post-cast snapshot,
  inverse, or second-press undo for any spell. A wrong target may still cancel
  an ordinary uncommitted aim with the charge intact. PILFER is the locked
  uncommitted exception; ANVIL cannot be backed out of after its markings are
  shown and charged.
- **`core/` stays pure.** No DOM, no timers, no ambient randomness. Supply
  arrives as behaviour (`CastCtx.draw`), so offline can hand it `Math.random`
  and authoritative Rune Trial replay can hand it the seeded stream, with
  deterministic outcomes either way.

---

## 3. Why COLUMN SWAP was retired (2026-08-21)

The first spell traded a column with the one facing it. It was removed, and
the reasoning is worth keeping because it is the template for rejecting a
candidate.

**The number.** A holder against a bare twin won **70.5%** in classic and
**81.8%** under SINGLE STRIKE (`tools/spellsim.ts`, seeded self-play at the
Medium anchor). One free tap was worth more than the entire difficulty ladder.

**The arithmetic behind it.** A swap moves value in both directions at once:
the swing in the score *difference* is `2 × (their column − yours)`. A stolen
triple-6 against an empty column swings **108 points** in a game that often
finishes in the 30–60 range.

**The two degeneracies, which mattered more than the number.**

1. *When to cast was solved.* Columns only grow, so the best swap is always
   the last safe one. Both players hoard, and every game converges on the same
   script.
2. *The counterplay taxed the fun.* While the opponent's rune is unspent, the
   correct defence is to never let your column get much better than the one
   facing it — which punishes exactly the stacking that makes the game good.

A spell can fail on any of these three independently. A tolerable win rate
does not rescue a solved cast time.

---

## 4. The roster

Historical baseline measured 2026-08-22, 3,000 games per configuration,
one-sided (a holder vs a bare twin) at the offline Medium anchor. These are
**floors** for the rules measured then—not current scoring-WARD results—the
casting policy is a heuristic, and a smarter human can only do better.

| Spell | Uses | Target | Classic | Notable mode |
|---|---|---|---|---|
| **FATE** — discard the die in hand, draw the next | 2 | self | 59.3 | LIMITED 60.8 |
| **NUDGE** — the die ticks one pip up, 6 wraps to 1 | 1 | self | 55.7 | — |
| **WARD (old no-score rule)** — a column absorbs the next victim-bearing strike | 1 | own column | 56.9 | COLSHIELD 49.5 |
| **SUNDER** — this placement strikes *every* matching column | 1 | self | 60.6 | SINGLESTRIKE 59.3 |
| **PILFER** — steal the top die of an enemy column | 1 | enemy column | 60.7 | COLSHIELD 63.1 |
| **ANVIL** — recast the weakest die in a column you filled | 1 | own column | 60.2 | COLSHIELD 62.8, SINGLESTRIKE 63.2 |

That historical roster spans **55.7–63.2**, against the retired swap's
70.5/81.8.

### Current standard evaluation (2026-08-25)

After enforcing one cast per turn for people, bots, and the evaluator, the
standard default-seed run completed 3,000 one-sided and 3,000 symmetric games
for each configured row (72,000 games total):

| Rune / mode | Holder win | Casts / holder game | Mean swing | Symmetric games with cast | Cast timing q25 / median / q75 | Late casts |
|---|---:|---:|---:|---:|---:|---:|
| FATE / Classic | 59.3% | 1.82 | 0 | 99.9% | .22 / .35 / .55 | 7.9% |
| FATE / LIMITED | 60.8% | 1.76 | 0 | 99.9% | .29 / .41 / .60 | 10.4% |
| NUDGE / Classic | 55.7% | .95 | 0 | 99.4% | .15 / .26 / .43 | 4.6% |
| WARD / Classic | 58.3% | .50 | 3.0 | 75.6% | .40 / .58 / .77 | 21.3% |
| WARD / COLUMN SHIELD | 50.7% | .12 | 0 | 22.9% | .33 / .48 / .68 | 14.1% |
| SUNDER / Classic | 60.6% | .47 | 0 | 75.1% | .54 / .74 / .95 | 41.9% |
| SUNDER / SINGLE STRIKE | 59.2% | .42 | 0 | 70.7% | .68 / .86 / .96 | 59.0% |
| PILFER / Classic | 60.6% | .81 | 18.9 | 95.6% | .22 / .32 / .48 | 6.3% |
| PILFER / COLUMN SHIELD | 62.9% | .51 | 17.9 | 75.6% | .28 / .42 / .65 | 15.9% |
| ANVIL / Classic | 60.0% | .61 | 14.3 | 89.8% | .55 / .74 / .92 | 42.5% |
| ANVIL / COLUMN SHIELD | 62.8% | .59 | 14.8 | 88.5% | .56 / .75 / .91 | 42.4% |
| ANVIL / SINGLE STRIKE | 62.0% | .61 | 13.7 | 87.4% | .59 / .78 / .94 | 47.6% |

Command: `mise exec -- node --no-warnings --experimental-strip-types tools/spellsim.ts --games 3000`,
depth 2, risk .9, seed `20260821`, no `--tune` or `--uses` overrides. Ordinary
search carries persistent WARD state; `machineCastPlan` coordinates current-turn
WARD/SUNDER effects with Normal's 5% slip; terminal scores include active WARD
bonuses. The harness keeps one global random stream across rows, so FATE's
supply draws also shift later rows' samples. Small non-FATE changes from older
all-roster output are not isolated mechanical effects.

### WARD: the one-hit scoring seal (updated 2026-08-25)

WARD remains one cast, one visible mark, and one absorbed hostile action. Its
shipped offline rule now gives the marked column a reason to be built and a
reason for the opponent to challenge it:

- While WARD is active, an all-distinct column adds its raw pip sum once after
  the mode's native scoring. `[4,5,6]` adds `+15`; ROW MULTIPLY does not
  multiply that bonus again. Empty columns and columns containing any
  duplicate add zero.
- Adding an own duplicate pauses the bonus without spending WARD. The mark
  remains and the bonus returns if a later legal board mutation makes the
  active column all-distinct again.
- A matching hostile placement—including a SUNDER-expanded match—burns WARD
  and preserves the dice it reached. PILFER aimed at a warded nonempty column
  also burns WARD and steals nothing; it remains legal even when the receiving
  column is full.
- Under COLUMN SHIELD, a full all-distinct column may be warded. A later
  matching hostile action burns WARD with zero victims and therefore zero
  BOUNTY, while the permanent shield and every die remain. A full shielded
  column containing a duplicate is illegal because it has neither a scoring
  bonus nor defensive work left for WARD to buy.

The score is derived from the live board plus the active mark; it is never a
second accumulated counter. Easy keeps its deliberately loose casting policy.
Normal keeps its 16-point demand. Hard floors WARD's base cast demand at that
same `16` before applying WARD's existing `×1.5` threshold; Hard's advantage
comes from deeper placement search rather than accepting lower-value WARD
casts. Persistent WARD state is scored and attacked through every search ply.

This update first shipped offline. Protocol-v2 ranked play now replays the same
scoring mark, interception, and break semantics authoritatively for both Rune
Trial and any ordinary participant whose immutable match row carries WARD
(§8).

### ANVIL (added 2026-08-22)

It exists for the one board state nothing else in the roster can reach. A full
column is finished: `[6,6,1]` is stuck at 25 forever, because there is nowhere
left to place. Every other rune works on the die in hand, the die in flight, or
the enemy's board.

**Full columns only, and that restriction IS the price.** The unrestricted
version was measured too (as TEMPER — any column, same effect): it reads about
the same against a bare twin, but it lets a good column snowball instead of
repairing a committed one. Refusing a column you can still place into keeps the
cast a repair, and keeps the decision honest — you must commit the column
before you may fix it.

**The alternative price was measured and rejected.** A version that ended your
turn (FORGE — "you place nothing this turn") fell to **52.0–55.2** one-sided and
last in the cross-table, at every threshold tried, whether or not it was
restricted to full columns. Skipping a placement does not cost "one die": it
costs a die on the board *plus* the board-parity edge — the opponent reaches a
full board sooner and takes the last word (`docs/LADDER.md`, seating). Restrict
**where** a cast can land, not **whether you may act**.

**The halved demand is measured, not taste.** `swingOf` reads the score
DIFFERENCE, so a two-sided spell like PILFER is counted twice (it adds to one
board and subtracts from the other) while ANVIL only ever adds to its own —
same units, half the reach. Raising the threshold instead makes it worse on
*both* axes, which is why `demand / 2` ships:

| effective demand | classic | median cast | late% |
|---|---|---|---|
| **8 (`demand / 2`, shipped)** | **60.2** | **0.74** | **41.7** |
| 12 | 59.1 | 0.80 | 51 |
| 16 (unscaled) | 56.5 | 0.94 | 66 |

**Its lateness is structural, not hoarding.** Median cast 0.74 — the same as
SUNDER's, earlier than WARD's 0.83. ANVIL is *illegal* until a column fills, so
the trigger cannot occur early; the player is not choosing to wait. This is the
clearest "waiting for a condition" case in the roster (§5).

**Known hot pairings, recorded like PILFER's.** COLSHIELD 62.8 and SINGLESTRIKE
63.2 sit level with the existing PILFER + COLSHIELD 63.1 — the top of the band,
not beyond it. Both modes make full columns more common or more valuable, which
is exactly what ANVIL feeds on. Refusing a *shielded* column was considered and
rejected: under COLSHIELD every full column is shielded, so it would make the
rune dead there, recreating the old no-score WARD + COLSHIELD 49.5 problem in
a new coat.

**Charge counts were measured, not guessed.** NUDGE at two casts measured 61.3
and ships at one (53.9 in that first pass); FATE stayed at two because it is
the weakest effect per cast.

**The weakest die is selected by value, not by grouping.** `[2,3,3]` targets
the `2`, and the cast is legal whenever the die in hand differs from that `2`.
The presence of a pair does not redirect or disable the repair. Ties still go
to the die closest to the centre line, so both the preview and the result are
predictable from the board.

### Candidate explorations

Seven unshipped concepts and their temporary estimates are recorded in the
[2026-08-25 rune candidate study](RUNE_CANDIDATE_STUDY.md); none is part of
the current registry.

#### KING & QUEEN / ROYAL PROCESSION — unmeasured 2026-09-01 candidate

KING & QUEEN is a later design hypothesis and **was not one of the seven
candidates measured in that dated study**. It is one rune identity represented
by two ordered cards, never two separately owned/equipped spells and never a
RANDOM×2 deal hidden inside one choice. Its proposed player-facing sequence is:

> **QUEEN** — Mark one of your nonempty columns.
>
> **KING** — Later, move that column's crown die to another of your columns.

The exact provisional contract is:

1. The hand begins in phase `queen`, with QUEEN face-up and KING visibly
   locked beneath it.
2. QUEEN targets one nonempty own column and leaves a persistent Queen seal on
   that **column**, not on its current die. Nothing moves, the cast commits, and
   the held die must still be placed normally. The hand advances to `king`;
   the universal one-cast-per-turn limit makes KING a later-turn action.
3. KING targets a different own column with room. It moves the Queen column's
   currently exposed die onto that destination, spends the sequence, and then
   the held die must still be placed normally.
4. The relocation is not a throw: it causes no strike, consumes no enemy WARD,
   and earns no BOUNTY. It preserves total board occupancy and therefore is
   not a second placement or a tempo gain.
5. If attacks or the caster's placements change the Queen column between the
   two cards, KING moves the new exposed die. If the column becomes empty, its
   seal remains visible and KING is temporarily illegal until it is nonempty
   again; the committed QUEEN is never refunded.

WARD remains attached to its column rather than following the relocated die.
A die moved out of a full COLUMN SHIELD column naturally removes that derived
shield because the source is no longer full. The source cell opened by KING
guarantees at least one legal destination for the mandatory ordinary placement,
so the cast cannot strand the turn. Score is always recomputed from the live
boards. Replay needs only the ordered phase and Queen-column index in addition
to the ordinary action log; no timer, hidden randomness, or inverse snapshot
belongs in core.

The shape fits the roster principles provisionally: it changes only the
caster's board, moves exactly one existing die, and makes value depend on a
source committed at least one opponent turn before the destination is chosen.
The opponent may alter the exposed payload through ordinary play, while the
caster may deliberately cover it; waiting is therefore not automatically
better. Exhaustive Classic column arithmetic puts the direct relocation gain
at a provisional maximum of +24, not the retired swap's two-sided 108-point
ceiling, but that bound is **not** balance or timing evidence.

Before implementation it needs a sequenced-spell seam owned by one registry
entry, authoritative phase/reconnect tests, exact aim/cancel semantics for both
cards, and the complete measurement in §5. Particular pairing questions are:

- whether the QUEEN setup participates often enough to justify a cast that has
  no immediate material effect;
- whether KING is hoarded late, becomes temporarily unavailable too often, or
  repairs high-value columns beyond the current roster's power band;
- how a future FUSION composite obeys KING's one-die bound, and how a future
  GATEHOUSE lock or FULL HOUSE claim settles around the relocation; and
- whether the two-card hand remains legible in the shared deal, RANDOM,
  RANDOM×2, equipment, and Rune Trial reveal surfaces without reading as two
  independently owned runes.

Rejected alternatives remain recorded so the theme does not silently drift:

- Swapping the two exposed own dice repairs two columns at once, reaches a much
  larger swing, and repeats the retired swap/BARTER design family.
- A persistent double-scoring Queen/King couple overlaps scoring WARD and the
  proposed FUSION mode, while a destroyed QUEEN can brick the second card.
- QUEEN opening a fourth throne cell changes board access and lets KING wait
  for a six; that is a mode-sized topology experiment, not a bounded roster
  addition without a strict deadline.
- Splitting protection and widened attack between the cards merely repackages
  WARD and SUNDER. Storing or transforming a die between cards repackages FATE,
  NUDGE, or ANVIL.

### Known pairing evidence

Both notable measurements involve COLUMN SHIELD:

- **Current PILFER + COLSHIELD (62.9) — too strong.** The steal un-fills a
  nearly-full column, which denies the shield the mode exists to grant. Its
  historical baseline was 63.1 under the earlier harness.
- **Current scoring WARD + COLSHIELD (50.7) — still cold under the standard
  bot.** The new rule fixes the missing legal/scoring purpose, but the 2026-08-25
  run casts only .12 times per holder-game and only 22.9% of symmetric games
  see any cast. The historical no-score result was 49.5 under a different
  policy, so the two point estimates are not a controlled effect estimate.

Both pickers still offer RANDOM. PILFER + COLUMN SHIELD remains hot, while WARD
+ COLUMN SHIELD remains too inactive under the standard bot to call repaired.
Keep both visible when interpreting a random/random game.

### Rejected on principle

Permanent debuffs on enemy columns (invisible ongoing state, pure resentment);
"place twice" (tempo and board-parity chaos); information spells like peeking
ahead (dead on a shared local screen where both players see everything).

---

## 5. How a spell gets measured

`tools/spellsim.ts` — seeded self-play, pure Node, **not** a gate. Placement
play is the offline Medium anchor (depth 2, risk 0.9), the same yardstick
`tests/botbench.test.ts` measures the bot ladder against.

```bash
mise exec -- node --experimental-strip-types tools/spellsim.ts --games 3000
```

The current standard follows the shipped Normal bot policy: at most one cast
may precede each placement, placement search carries persistent WARD state,
and registry-owned coordination uses the named 5% Normal slip. FATE can spend
its second charge only on a later turn, after the opponent has acted.

It answers three questions, and **the second matters most**:

1. **Power** — one-sided win% vs a bare twin. 50% would mean the spell is
   worth nothing.
2. **Timing** — when casts actually happen, symmetric (both seats hold it). A
   pile-up in the final plies is the endgame-sniping degeneracy that killed
   the swap. Read `castTiming.median` and `lateCastPct`.
3. **Texture** — cast rate and realized swing: does the spell participate at
   all, and how hard does it hit when it does?

### The fourth question, which this harness cannot ask

Every number above is **holder vs a twin holding NOTHING**. `spellsim` cannot
measure spell X against spell Y at all. That is sound for named and shared-
RANDOM deals, where both seats hold the same rune and balance is about whether
the spell is *fun*. It is not evidence that a RANDOM×2 pairing is fair.

Measured 2026-08-22 with a head-to-head harness (3,000 games per cell, both
directions averaged, noise floor 0.9pp), the then-shipped five against **each
other** in classic, as mean win% across the pool:

    sunder 54.7 · pilfer 54.7 · fate 52.0 · ward 48.2 · nudge 46.0

A span of **7.7pp ≈ 54 Elo**, and the ordering is **not mode-stable**: under
SINGLE STRIKE the span is 17.3pp and PILFER beats WARD ~67–33. RANDOM×2 can
therefore create a sharply uneven individual duel by design; it must never be
presented as a balanced competitive draft. The old no-score WARD's friendly
56.9-vs-bare reading hid that it was the worst rune in that pool in every mode;
the shipped scoring repair does not retroactively change this frozen baseline.

**The lesson is structural: a roster balanced against nothing systematically
over-values defensive spells.** Against an opponent who is also gaining, swing
beats safety. Expect any new defensive rune's one-sided number to overstate it.

**Two cautions before trusting a cross-table.** Production `searchRoot` now
carries persistent WARD state through every ply and consumes one-shot SUNDER
at its exact root placement, but it still omits future rune identity and
unspent charges. The frozen asymmetric v1 matrix predates that coordination
and scoring-WARD, so it remains deliberately labeled blind. Under symmetry
some blindness cancels; asymmetrically, adapting to the opponent's rune *is*
part of the matchup. And a cell measured in one direction only carries ~1pp
of seat bias; run both and average.

**Late is not automatically degenerate.** Historical no-score WARD and SUNDER
cast late because they waited for a *condition*—a real threat or a die matching
several columns. Scoring WARD instead gives proactive distinct-column building
immediate value. The swap's lateness was different: hoarding was
unconditionally correct. Distinguish "waiting for a trigger" from "waiting
because later is always better".

**Name the machine policy in every measurement.** `machineCast` remains the
shared cast/hold decision, but production local play now layers
`machineCastPlan` over it for registry-declared same-turn coordination. The
frozen v1 harness intentionally retains its earlier blind placement policy;
the scoring-WARD and coordinated-SUNDER treatments remain separately versioned
evidence rather than rewrites of it. A spell whose value never shows on the
boards (FATE, NUDGE, SUNDER) must provide a `cpuCast` hook, or the default
board-swing policy will never cast it and it will measure as worthless.

---

## 6. Adding a spell

One object in `core/spells.ts` is the whole spell rule. The rail, gestures,
charge accounting, and CSS use its stable id; player-visible copy comes from
the localization catalogs through the shared adapter.

1. **The spec** — `id` (stable forever: persisted, tested, styled against),
   `target` (`'column' | 'self'`), `side` (`'own' | 'foe'`, for column spells:
   which half the ring offers), `uses`, `commitsOnAim` only when showing the
   aim itself spends the charge, `locksOnAim` only when an uncommitted aim must
   receive a legal answer, `previewDieIndex()` when a column spell marks one
   exact die, `legal()`, `apply()`, and `cpuCast()` if its value is off-board.
   Use `cpuRootCharm()` when the cast changes the immediately following
   placement, and `cpuForbiddenPlacements()` when a follow-up column can make
   the cast self-defeating.
2. **The copy** — `name`, `compact`, `blurb`, `detail`, and `aim` in every
   locale catalog under the stable id. The armed `aim` gets at most two
   landscape lines; see §7.
3. **The icon** — a path in `ui/spellicons.ts` plus a hue.
4. **The cast animation** — an entry in `EFFECTS`
   (`src/flow/spell-effects.ts`), with `defaultEffect` as the fallback.
5. **Gate cases** — `tests/spells.test.ts` for the rules and
   `tests/browser/spells/run.mjs` for anything the player can see.
6. **Measure it** before shipping, and record the numbers here.

### The seams that already exist

- **`CastCtx`** — everything beyond the two boards: the die in hand
  (`setDie`), the supply (`draw`, `bagLeft`), the persistent marks (`charm`),
  the mode. Optional everywhere, so a call site with no hand to offer simply
  omits it and any spell needing one answers "not castable here".
- **`CharmSt`** (`core/rules.ts`) — persistent marks destruction consults.
  `openStrikes()` returns the plan for one placement (which hostile columns it
  reaches, which victims exist, and which WARD answers) and is read by *both*
  the headless `applyMove` and the animated flow, so screen and state cannot
  tell different stories. A full COLUMN SHIELD match can therefore be a real
  warded outcome with zero victims.
  Without a charm, `applyMove` is the pre-spell hot path, untouched.
- **Placement coordination** — `machineCastPlan` asks only registry hooks.
  Hard reuses the exact preview; Normal reuses a root-charm preview except for
  its named 5% SUNDER slip; Easy does not preview. `searchRoot.rootCharm`
  carries persistent WARD marks through every later ply, so placement search
  can preserve its own bonus and challenge the opponent's. One-shot SUNDER is
  consumed by the root move and does not become a standing future effect.

---

## 7. Interface rules the UI must keep

Learned from real play, each one a shipped bug:

- **The board rings only what the cast can land on**, asked from the spell's
  own `legal()` per column (`markAim`). Ringing everything was honest for the
  symmetrical swap and a lie for everything since.
- **The placement hint and the aim ring are the same `::after`.** The rule
  that hides hints while aiming (`.col.legal::after{display:none}`) will hide
  the ring too unless the aim rule wins `display` back. `.legal` marks the
  mover's *own* playable columns, so this bug shows the ring on exactly the
  wrong half. **A UI probe that skips `showHints()` cannot see it** — it tests
  a state real play never reaches.
- **One column, one outline.** A warded column with room left is both
  `.warded` and `.legal`, and each used to draw its own ring — the seal's line
  1.6px outside the column box, the hint's dashed ring at 4px. Two rings 2.4px
  apart are one doubled edge, not two marks (user report, photographed). The
  hint is therefore not a ring but a *state the column's outline wears*: where
  a seal is drawn it stands down and the seal carries it (full-strength line,
  thickened, breathing on the hint's beat); where there is no seal the
  `::after` **is** the outline and nothing changed. Both facts still reach the
  player, with one line. Reduced motion is the deliberate exception: ordinary
  placement emphasis disappears and a protected column keeps only its resting
  seal, while an explicitly armed spell still paints its registry-legal aim
  ring. A new mark that rings a column has to answer this
  rule — `.col.legal:is(.shielded,.warded,.sealsnap)` in
  `src/styles/game/guards.css` is the one place it lives, and the spells browser
  `protection-layout` scenario counts the rings per column.
  **The rule points inward too**, which took a second report to learn: the
  shield's loop carried a hairline copy of itself 3px inside, meant as weight
  and read as a second outline — at the cell sizes a phone actually uses, that
  3px lands on the dice's own rims. One mark, one line, wherever the second one
  comes from (`tests/browser/spells/scenarios/protections.mjs` counts the
  distinct paths the mark paints).
- **A mark that encloses the stack is cut parallel to the CELL.** The seal
  rides the stack's box grown by `--seal-out`, and a line offset outward from a
  rounded rectangle only stays parallel — corners included — if its radius
  grows by that same offset. The rectangle to match is the one the player sees:
  the cell, whose corner the seat and the die share (`.slot,.die` in
  `src/styles/game/board.css`, read back by `sealMetrics()` in
  `src/ui/game/seals.ts`). Asking `.col` instead looks right in the source and
  wrong on the glass — its box is 4px rounder than the cells it holds and paints
  nothing at all, so the mark ran flush to the dice down the sides and bowed
  away from them at the corners. That is "the radius is too strong", reported
  twice. The `protections` and `protection-layout` browser scenarios measure the
  cell-parallel corner at every supported size and orientation.
- **The seal's beats have one owner each** — `--seal-engage`, `--seal-strike`,
  and `--seal-snap` live in `src/styles/foundations/tokens.css`; the animations
  in `src/styles/game/guards.css` consume them, `src/ui/game/seals.ts` reads them
  back to decide how long to hold each one-shot class on, and the split spells
  browser scenarios read them to decide how long to observe and when a mark is
  resting. Three numbers typed in three files is a trio that parts on the first
  tuning pass — and did. **Read a time token for its unit, never with a bare
  `parseFloat`:** the build's CSS minifier ships `950ms` as `.95s`, so the same
  read gives 950 in dev and 0.95 in the bundle — which held the one-shot class
  on for a single millisecond in the only artefact a player ever sees, with
  every assertion in the suite still green, because they all waited for the
  beat to be over before measuring anything.
- **A self spell casts on press.** One possible target means nothing to aim.
  Dragging still works; dropping anywhere else cancels with the charge intact.
- **Commitment has one visible direction.** Before commitment, leaving an
  ordinary aim or missing its target restores the ready rune with its charge
  intact. PILFER deliberately locks that uncommitted aim until a legal enemy
  column answers it. After commitment, the rune immediately shows the remaining
  charge or `spent`; pressing it again cannot restore the old die, supply,
  charm, or board. ANVIL's marked aim stays visibly locked until the player
  chooses one of its legal full columns. This rule lives in the shared spell flow, so
  pointer, touch, keyboard, local-player and machine casts cannot disagree.
- **The rail follows `S.turn`, while interactivity follows `caster()`.** The
  card always shows the hand whose turn it is, including an opponent's inert
  hand while they think. Only a legal player choice gets pointer events. A
  fixed-viewer game also marks `opponent-turn` whenever `S.turn` is not that
  viewer's seat: single-player fixes the viewer to the human, and online fixes
  it to the authenticated match seat. Local pass-and-play and face-to-face have
  no fixed viewer, so neither human's turn gets the opponent treatment. Busy
  windows therefore change availability without changing ownership, while
  `nextTurn` repaints the slot with the other seat's remaining cards. Waiting,
  spending and handing over are three different pictures.
- **The armed line gets ONE line in portrait and TWO in landscape.** Not a
  preference — the status box is *reserved* at that size (`.status` /
  `.land .status` min-height, a fixed 104px lane in landscape), and a line
  past the reserve grows the box and walks the stage die up the screen: the
  same drift `responsive-browser` guards for ordinary turns. So the catalog's
  `aim` says
  WHICH column the tap wants and stops. The verb is already on the rune the
  player just pressed — its localized name, icon, and `blurb` — and the board
  rings the legal targets in gold. What the rings *cannot* say is why they are silent, which is exactly
  the work "a filled column" or "an enemy column" does; that is why the
  *which* is the half worth keeping and the verb the half to drop. Measure,
  never count characters: "Tap one of your columns to guard" (32 chars) took
  three landscape lines while "Drop it on your die to charge it" (32) took two
  — long WORDS break lines, not long strings. **And measure in the font the
  player actually has.** That two-line result was measured in SF Pro Rounded,
  which only macOS and iOS resolve; the stack ends in `sans-serif`, and in a
  fallback face 8–10% wider all three SELF lines went to THREE landscape lines
  and shoved the stage die 6.2px — caught on CI (2026-08-22), invisible on the
  machine they were written on. The rule therefore binds self spells too, and
  the *which* for a self spell is the die in hand: FATE, NUDGE and SUNDER all
  say **"Drop it on your die"** and stop. Their widest wrapped line is 72.2px
  of the 104px lane in the widest face measured, so only a font ~44% wider
  again would break it. The spells browser layout scenario arms every registry
  entry on the narrowest phone in both orientations and measures the box
  against the CSS's own reserve. Burned by ANVIL, which shipped reading "Tap a
  filled column to recast its weakest die": four lines landscape (die shoved
  12.6px), two portrait (6px), and the rules it spelled out were already on
  the picker slice and the library card.
- **Reserve, never collapse.** The card rail keeps its box when a hand is spent,
  and BOUNTY's ✦ lane keeps its place inside the score cluster, or the stage or
  score visibly jumps when the thing appears or leaves. Likewise the column
  chip *centres* its contents, so marks sit at its ends, out of that row.
- **When measuring any of this, sample after `.plate.bump` settles (190ms).**
  A changed total scales the number, and reading inside that window looks
  exactly like layout drift.

### The rune in play: RC4's paired charge stack (selected 2026-08-23, paired 2026-08-25)

Six alternatives remain as design history in
`design/screens/studies/open/29a…29f`, group **"4g · The rune in play"** in
Claude Design. **RC4 — The charge stack** is production. The constraints below
are its contract, not another comparison brief.

**The problem it solved.** The first build used a rounded-square control beside
the die and a second, smaller readout in the opponent's nameplate — two
implementations of one idea — then threw away the card dealt during the reveal.
The rail now keeps that card vocabulary in play.

**The frame, decided:**

- **One slot, one persistent hand per dealt seat.** Shared named and RANDOM
  deals keep two matching hands; RANDOM×2 keeps two different hands. The active
  hand comes forward and the standby hand recedes on every turn change, so the
  physical cards switch depth instead of one card changing identity. If that
  front hand spends its last charge, its opaque matte recedes immediately and
  the other live hand comes forward while the cast card deals away; semantic
  turn ownership does not change. The
  nameplate readout stays gone and the plate keeps that lane for the score.
  Watch "Reserve, never collapse" above.
- **The card is the reveal's card at rail size** — same face, same deck back,
  same corner index, icon centred (`.rdealt` / `.rface` / `.rback` in
  `styles/components/rune-deal.css`). Not a new object.
- **At rest it is SMALLER than the die in play.** Same width as the button it
  replaces, buying its presence in height only, and stopping short:
  card height `--cell*.81` against a die of `--cell*.92`, about 88% of it.
  Only a card being activated passes the die, at 1.16. The die is the thing
  being decided about; a rune that out-measures it steals the centre.
- **Portrait aligns it with the board's third column.** The die keeps the
  table's centre while the card stays vertically beside it and places its own
  centre on the rightmost column's centre line (`--cell + --gap`). Landscape
  keeps the existing compact answer: the card is centred above the die.
- **Its rune colour is always present and quiet.** Both faces carry the same
  oversized 12% → 4% → transparent surface wash. It has no breathing halo and
  the wash itself does not change with availability or busy state. The card
  always owns `transform: scale(1)`, a centred transform origin and
  `filter: grayscale(0)`, with `will-change` naming transform, opacity and
  filter. Rather than adding those properties only when a state changes, its
  icon therefore stays on one Safari compositing surface instead of twitching
  a few pixels as iOS rerasterises the rotated SVG. For a fixed viewer's full
  opponent turn the active opponent hand transitions over 250ms to 95% scale,
  then returns to exactly 100% for the viewer's turn. It keeps full opacity and
  its rune colour while the opponent plays; depth and scale already communicate
  ownership without making an active rune look disabled. Online tracks the same
  viewer-relative scale: each ranked seat renders its revealed match-row rune,
  while an honest empty seat keeps that hand invisible during play. An own rune with
  no legal target uses the same mute but remains 100%, so every registry spell
  advertises whether it can be activated without pretending ownership changed.
  Brief busy or phase locks keep the stable pre-lock appearance at its current
  ownership size; pressing still supplies the selected flip and 1.16
  enlargement. Local two-player has no fixed viewer and never shrinks either
  active hand.
- **The face carries the rune hue; an offset edge carries ownership.** Every
  hand has the same soft player-colour echo under its top physical card,
  including matching shared-rune hands. The edge inherits the card's tilt and
  follows it through every active/standby depth swap; neither face trades its
  rune identity for a seat colour. The edge fades before that card turns and
  stays absent once the charge is spent.
- **An unplayed rune lies FACE-DOWN**, its index enlarged for rail size — the
  deck draws that index at 26% for a card 2.5× bigger, which is a 9px smudge
  here. A played rune is face UP. That is the reading every card game already
  taught the player, and it means the turn is a genuine reveal rather than a
  flourish.
- **The press turns it ONCE.** One half-turn, not a spin, arriving enlarged.
  Use `ui/runedeal.ts` `flip()`'s method — 0 → 90°, swap which face is lit
  while edge-on, −90 → 0 — never `backface-visibility`: one grouping property
  anywhere in the ancestry flattens the 3D context and shows the wrong face,
  which is exactly what the deal's first build did.
- **More than one charge is more than one card**, each at its own slight tilt.
  FATE's two casts stop being a 14px corner badge (`.rune .n`). The tilts must
  differ — two cards at the same angle read as one thick card.
- **Portrait face-to-face turns the card 180°** with the rest of the centre.
  No new mechanism: `styles/game/seating.css` already rotates `#dieStage`,
  `.status` and `.timer` under `#kbroot.face.p2turn:not(.land)`. The card
  belongs in that selector.

**RC4's distinguishing rule.** Each remaining charge is a card at its own
tilt. Committing a cast deals the top card face-up and away; a fully spent hand
leaves the same number of alpha-checker mattes. Those close, fully opaque night
tones look transparent but completely mask a hand below. A just-spent hand
recedes behind the other live hand immediately, keeping both hands visible
during the deal-away; when both hands are spent, the active matte stays opaque
above the other matte. FATE therefore reads as two, then one, then an empty
two-card stack without a numeric badge. The drag ghost is the same face-up card,
reduced motion resolves directly to the remaining hand, and the fixed matte
keeps portrait, landscape and LIMITED stage geometry unchanged.

**The machine shows its tell.** Once the CPU has chosen a legal cast, it holds
the card for a random **320–900ms** before activation. Declining a spell adds
no delay, every selected effect still completes before placement, and a new
game generation cancels the pending cast.

### The selected cast animations (2026-08-23)

The studies are implementation references, not permission to approximate the
rule. The authoritative board mutation still comes from the registry and
`openStrikes`; animation may reveal or explain that result, never invent a
second one.

- **PILFER — PI5, The snatch.** The stolen top die resists once for every die
  beneath it: a one-die source stack crosses immediately, a two-die stack has
  one collision/resistance beat, and a full three-die stack repeats that same
  beat twice rather than escalating it. While aiming, a centre-facing open grip
  marks the exact die and the empty receiving slot glows during the crossing.
  The open grip sits directly on the die's real outline and moves only with the
  die, never as a second offset ring. PI5's authored easing applies between its
  measured waypoints so the flying die, whole-column strain, and landing squash
  stay synchronized. The source stack strains and releases, then the die travels
  to the facing column without a separate crossing line.
  Its arrival is a placement, not a strike: no board shake, impact burst, or
  other destruction cue may play when it lands. Against an active WARD, the
  selected top die instead tugs toward the caster, meets the mint clasp and
  recoils into its original slot; WARD burns and no die crosses, even when the
  receiver is full. PILFER and COLUMN SHIELD share gold, so legality remains
  distinguished by form rather than hue alone.
- **SUNDER — SU6, Overload.** Casting marks only the exact dice the following
  placement will destroy. The preview asks `openStrikes()` with a cloned charm,
  preserving COLUMN SHIELD, SINGLE STRIKE and current WARD answers without
  consuming live state. Shielded dice and dice behind an answering ward are
  not painted as doomed. The doomed faces keep their seat and multiplier
  reading while their low-amplitude tremor and slow ember shedding continue
  until placement. Placement completes that already-visible failure over the
  selected study's 2.6-second collapse; reduced motion uses the static warning
  immediately. The valid self cast is committed and spent before this
  information appears, so it cannot be used as a free probe.
- **ANVIL — AN2 forge heat plus AN3's expanding border.** Heat works the whole
  die, not one pip or an overlay fragment: it rises to white, the authoritative
  face changes, and the new die cools in place. One solid border expands once
  from the face-change beat. Nothing rotates, rocks, spins, rolls, or tumbles;
  the result was known from the die in hand and must not read as random. The
  aim marks the exact weakest die in every legal full column, including the `2`
  in `[2,3,3]`, and commits as soon as those markings appear.
- **WARD — W3, Runic seal.** The ward is the closed seal held by one modestly
  enlarged clasp, and the clasp always faces the centre of the table: down on
  the portrait top board, up on the portrait bottom board, right on the
  landscape left board, and left on the landscape right board. Casting WARD
  does not reroute a die; later placements settle into their normal
  authoritative slot. A matching hostile placement animates a break: a copy of
  the settled attacking die travels straight until its leading edge meets the
  clasp, then follows W3's longer rebound while contact spends the ward and the
  seal snaps. This includes a zero-victim match against a full COLUMN SHIELD
  column; the mint clasp leaves while the permanent gold loop and dice remain,
  and no BOUNTY is minted. PILFER uses PI5's tug-and-recoil answer instead of
  inventing a thrown attacker. The clasp and seal provide the light; no generic
  screen flash or die rotation obscures the break. A nonmatching miss and an
  own placement leave the mark intact; an own duplicate merely pauses its
  scoring bonus.
- **NUDGE — NU1, The pip lands.** The die shell remains completely still. Pips
  the new face no longer needs leave, and newly needed pips land in their
  cells; the diff is computed for every transition, including the full `6 → 1`
  wrap. The face alone changes because the face is the whole rule.
- **FATE — FA4, The pass.** The rejected die moves left while the next die
  enters from the right at the same time, so the stage is never empty for a
  frame. The pass is contained inside the stage lane and does not cross the
  LIMITED bag, the rune, or either board. The supply draw and charge are
  committed before the revealed replacement can influence another choice.

### The RANDOM draw is shown, not silent (2026-08-22)

RANDOM used to draw its rune inside `resetSpells` and the player met it in the
rail. It is now dealt in front of them: `ui/runedeal.ts` shuffles the roster as
a deck and draws one card (`design/screens/product/28-rune-deal`). Four rules it keeps,
each one paid for:

- **The draw happens in `startLocal`, not in `newGame`.** Exactly the bargain
  `opts.scoring` already struck for the mode: a beat that showed one rune and a
  game that dealt another would look right on screen and be wrong every time.
- **The deck is the roster, and it is really shuffled.** Every card is a
  `SPELLS` entry in its own hue wearing its own icon as a corner index, so a
  new rune joins the deck the day it is registered. The deck is dealt three
  orders — the fan you are handed, the fan after the riffle, the fan after the
  cut — and each card turns over its new rune as it zips back in, so the deck
  visibly changes under the hands. Where the answer sits is then not
  decoration: the card that comes forward is drawn out of *that* slot of the
  final fan, and the fan is one card short afterwards. A card that rose out of
  the middle every time made the whole shuffle scenery.
- **A card turns over by swapping which face is lit, edge-on — never with
  `backface-visibility`.** The 3D version worked in isolation and failed in the
  app: any grouping property above the card (this overlay carries a
  `backdrop-filter`) flattens the 3D context, and the card then turns and shows
  its BACK while the readout names the rune. State and DOM agreed perfectly the
  whole time; only a computed style could see it (`tests/rune-deal-reveal.mjs`).
- **The shuffle carries the beat, not the flip.** A flip alone is ~0.5s and
  read as a stutter; the deck now works for ~2.8s (fan, riffle, cut, draw) with
  a voice — `Sfx.riffle()` — because three silent seconds read as a hang. One
  riffle, not two: the cut is already the beat that says "and again" (user
  call).

The rune shares ONE reveal screen with the mode dial (`ui/reveal.ts`), which
runs a beat per unanswered question and holds ONCE. Two overlays with two
five-second countdowns is the same screen shown twice, and the mode's answer
would have scrolled away before the rune arrived — so a landed mode settles
into the top half and is still readable when the player taps ready. It keeps
its **rule**, not just its name: `COLUMN SHIELD` alone is a label, and the line
under it is the half that says what you are about to play (it is literally the
same `.wblurb` the readout under the stage uses). It also gets a beat alone on
screen first — 1.5s, because at one the eye was still on the dial when the deck
replaced it.

---

## 8. Offline collections and ranked runes

The comprehensive evidence record remains
`docs/RUNE_MULTIPLAYER_INVESTIGATION.md`. This section owns the selected product
and runtime contract.

### Ranked boundary

Reaching SILVER once permanently activates a participant's equipment in
ordinary ranked, including after demotion or season turnover. The two seats are
independent: a fixed seat receives its owned rune, while RANDOM uses the fresh
match seed plus participant identity to choose deterministically from that
participant's current owned collection. A RANDOM seat always resolves to an
owned rune: the same start retry returns the same choice, while a new match can
deal another owned rune. A participant who has never reached SILVER or has
empty equipment receives an empty hand. Ordinary matches do not show a paired
rune-reveal screen; their immutable `matches.p1_rune` / `matches.p2_rune`
values still own gameplay rather than the viewer's profile cache or a later
equipment change.

RANDOM retains one concrete owned fallback in `profiles.equipped_rune` beside
`random_rune_mode=true`. That fallback lets an installed pre-RANDOM client read
and play a valid fixed rune; a direct `equipped_rune` PATCH through that older
client automatically exits RANDOM, even when it repeats the fallback. Enabling
RANDOM with no owned fallback is rejected by both client and database. New
clients persist fixed, RANDOM, or empty state through the authenticated-only
`set_rune_equipment` RPC; they cannot update the RANDOM flag directly. The
fallback is compatibility state, not the next deal, and matchmaking never
rewrites it when a match starts.

Rune Trial is stored as `format='rune_trial'` with `modifier='classic'`. It
ignores equipped seats and uses its own private selection instead. Its paired
rune reveal is exclusive to this format.

Both participants receive the same uniform offer of three distinct runes from
the complete six-rune roster, independent of collection. They choose privately
and independently, may choose the same rune, and reveal together. A server
deadline expires after 10 seconds (`RUNE_TRIAL_PICK_SECS`). Any missing
selection is filled by a deterministic participant-specific auto-pick before
gameplay or any early resignation, deletion, timeout, or other settlement.
Fixed or RANDOM equipment remains selected, is ignored in Trial, and is never
overwritten by the loan.

Protocol v2 gives aims, casts, and placements one authoritative total order. The
client submits intent plus an idempotency key and expected action version; the
server reconstructs the seeded die/supply stream, rune assignment, charges,
one-cast-per-turn state, persistent charm, legality, and terminal score before
committing an action. FATE draws from that seeded supply. A turn is
`cast? → placement`, except that a legal cast may end the duel. Equipped-rune
standard matches use this same action grammar with nullable per-seat hands.
Protocol v1 remains placement-only for legacy rune-free standard matches;
capability intersection prevents a v1 client from entering Trial or an
equipped-rune standard match.

ANVIL's information-bearing aim is itself an authoritative action: its `aim`
row spends the charge and persists `pending_aim`, reconnect restores the locked
targeting state, and neither cancellation nor placement can refund or bypass
it. A matching `cast` resolves it; after the action-stall boundary the server
chooses the first legal target deterministically and continues with placement.

Every settled ranked Trial win—human, bot, normal finish, resignation, or
timeout—idempotently adds the winner's selected rune to their permanent
collection. A loss or draw grants nothing. Owning that rune already grants no
replacement and produces no new-reward reveal. Collections start empty for
new and existing players; Trial loans all six precisely so collection size
cannot change ranked options.

#### Decided successor CLAIM reward — not shipped

The future ranked progression target deliberately changes only the collection
reward, not the loan or cast rules. One of the common three offered cards is
marked **CLAIM** before both private choices. The server first snapshots the
offer, then chooses one of its three slots uniformly with a domain-separated
deterministic stream and stores both slot/rune identity in the immutable match
snapshot. Both seats see the same mark. Each client labels ownership only from
that viewer's server-confirmed collection; opponent ownership is never exposed.
To collect it, the winner must have selected that marked rune; choosing either
other card is an explicit decision to prefer the duel matchup over collection
progress.

A loss or draw still grants nothing. A resignation, forfeit, timeout, or
deletion uses the resolved selected rune, including any deterministic auto-pick,
and does not manufacture CLAIM eligibility. An already-owned CLAIM rune is a
duplicate: no replacement is drawn and no new-acquisition reveal appears. The
pre-game card must tell each viewer whether the marked rune is in **their own**
collection, so a duplicate is known before the choice rather than sprung on the
player after a win. It never reveals the opponent's ownership.

The reward write remains server-authoritative, versioned, idempotent, and in the
same atomic settlement as the match. The client never submits the mark or claims
that it selected it. Existing collections survive cutover unchanged. A
dedicated successor capability distinct from current `rune_trial_v1` gates the
format for both human participants; an incompatible human pairing excludes
Trial, while a target-version bot is capable. The immutable match reward
version wins over deployment time: an already-active v1 Trial grants the
selected rune, and a CLAIM Trial cannot start for a client unable to render its
mark. The exact coupon-collector pacing, expected games, OBSIDIAN distribution,
and reason for retaining a one-to-three-rune long tail are in
`docs/LADDER.md §7`. Until that versioned target ships, the selected-rune reward
in the preceding paragraph is the runtime contract.

Offline CPU and local two-player Trial still grant no collection reward and
therefore receive no CLAIM mark. The shared selector accepts the ranked mark as
explicit optional input; it does not infer one or grow a second Trial flow. A
possible later fixed-price purchase of one chosen missing rune is recorded only
as an unapproved post-OBSIDIAN example in `docs/LADDER.md §7`; it changes none
of this target's launch rules.

The first acquisition of a rune remains durably unseen until the account UI
acknowledges its reveal, so reconnecting or changing devices cannot swallow the
reward. The result's reward card names the rune and opens the same rune entry
sheet the in-game badge and the profile collection open; opening it
acknowledges the reveal and returns to the result underneath.

### Offline and local setup

CPU play uses the last server-confirmed, account-bound collection cache and
never imports the online client to start. With no confirmed cache, the
collection is empty. Sign-out and account switching clear or swap the active
snapshot so one account cannot lend runes to another.

- NONE is always available in CPU play. A named rune requires ownership.
- Rune RANDOM requires two collected runes and deals one collected rune to
  both seats. RANDOM×2 also requires two and deals two distinct collected
  runes, one per seat.
- CPU Rune Trial requires three collected runes. Its offer contains three
  distinct collected runes; the AI makes an independent seeded uniform choice
  without observing the player's choice.
- Local two-player always exposes all six named runes, both RANDOM variants,
  and Rune Trial, whether signed in or offline. Trial uses a secret
  pass-and-pick flow, loans the full roster, and never grants collection.

Rune Trial appears in the game-mode row. Selecting it manually forces Classic
board rules and disables the ordinary rune picker with an explanatory overlay,
but preserves that mode's saved rune preference for later. Mode RANDOM may
land on Trial whenever it is eligible; that resolved outcome overrides the
current rune deal without overwriting the saved choice. Restarting a duel keeps
its resolved Trial offer and choices, while starting the next duel produces a
fresh offer. CPU and local-two-player setup preferences persist separately and
are validated again when the duel starts.

Locked choices stay visible with the same frosted/colour-blind lock vocabulary
used elsewhere. Before IVORY an unowned rune explains both requirements:
reach IVORY, then win it in Trial. After IVORY it says to win with that rune in
Trial. Both RANDOM choices say to collect two runes; CPU Trial says to collect
three.

The frozen asymmetric-v1 study remains a balance warning for the selected
personal-equipped ranked contract: under its blind Normal policy and historical
WARD rule, fixed PILFER dominated the other loadouts at the point estimate.
Rune Trial deliberately avoids gameplay-option inequality by loaning its offer;
CLAIM's collection value can still differ by viewer. The SILVER floor and
current bounded roster are product decisions, not proof of perfect balance;
human choice and matchup telemetry still need monitoring.
