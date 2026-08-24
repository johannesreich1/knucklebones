# Spells — the design rules

*What a spell is allowed to be in this game, why the current six exist, and
what a seventh would have to prove. The dated sprint history records what
shipped when; this file records **the thinking**, so a later session can add a
spell without re-deriving it — or can knowingly overrule it.*

Spells are an **optional layer over offline play**. Both seats always hold the
same rune, one cast per turn at most, and a cast is **not a move** — your die
still lands afterwards.

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

- **Symmetry.** Both seats are dealt the same rune. Balance is then about
  whether the spell is *fun*, never about whether it is *fair*.
- **Visible threats.** The opponent's remaining charges are always on screen
  (their nameplate). A spell you cannot see coming is a trap, not a duel.
- **Legality is the only failure path.** An illegal target is refused *before*
  anything moves, so a cast can never half-happen and leave the boards in a
  state nobody designed. A cast that would change nothing is illegal, not a
  wasted charge (a second ward on one column; a ward on a shielded column).
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
- **`core/` stays pure.** No DOM, no timers, no randomness. Supply arrives as
  behaviour (`CastCtx.draw`), so offline can hand it `Math.random` and a
  future ranked deal can hand it the seeded stream, with replay deterministic
  either way.

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

Measured 2026-08-22, 3,000 games per configuration, one-sided (a holder vs a
bare twin) at the offline Medium anchor. These are **floors** — the casting
policy is a heuristic, and a smarter human can only do better.

| Spell | Uses | Target | Classic | Notable mode |
|---|---|---|---|---|
| **FATE** — discard the die in hand, draw the next | 2 | self | 59.3 | LIMITED 60.8 |
| **NUDGE** — the die ticks one pip up, 6 wraps to 1 | 1 | self | 55.7 | — |
| **WARD** — a column absorbs the next strike, then burns out | 1 | own column | 56.9 | COLSHIELD 49.5 |
| **SUNDER** — this placement strikes *every* matching column | 1 | self | 60.6 | SINGLESTRIKE 59.3 |
| **PILFER** — steal the top die of an enemy column | 1 | enemy column | 60.7 | COLSHIELD 63.1 |
| **ANVIL** — recast the weakest die in a column you filled | 1 | own column | 60.2 | COLSHIELD 62.8, SINGLESTRIKE 63.2 |

The roster spans **55.7–63.2**, against the retired swap's 70.5/81.8.

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
rune dead there, which is WARD + COLSHIELD's 49.5 problem in a new coat.

**Charge counts were measured, not guessed.** NUDGE at two casts measured 61.3
and ships at one (53.9 in that first pass); FATE stayed at two because it is
the weakest effect per cast.

**The weakest die is selected by value, not by grouping.** `[2,3,3]` targets
the `2`, and the cast is legal whenever the die in hand differs from that `2`.
The presence of a pair does not redirect or disable the repair. Ties still go
to the die closest to the centre line, so both the preview and the result are
predictable from the board.

### Known bad pairings

Both involve COLUMN SHIELD, in opposite directions, and any deal that picks
*both* mode and spell should know them:

- **PILFER + COLSHIELD (63.1) — too strong.** The steal un-fills a nearly-full
  column, which denies the shield the mode exists to grant.
- **WARD + COLSHIELD (49.5) — worthless.** A coin flip, casting in only 61% of
  games: the mode already protects full columns, and a shielded column may not
  be warded, so the spell has almost nothing left to do.

Both pickers now offer RANDOM, so a random/random deal can land on the dead
pairing. Refusing it at deal time is an open decision, not a shipped rule.

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
node --experimental-strip-types tools/spellsim.ts --games 3000
```

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
measure spell X against spell Y at all. That is sound while §2's Symmetry rule
holds — both seats are dealt the same rune, so balance is only ever about
whether a spell is *fun* — and it becomes misleading the instant that rule is
dropped.

Measured 2026-08-22 with a head-to-head harness (3,000 games per cell, both
directions averaged, noise floor 0.9pp), the then-shipped five against **each
other** in classic, as mean win% across the pool:

    sunder 54.7 · pilfer 54.7 · fate 52.0 · ward 48.2 · nudge 46.0

A span of **7.7pp ≈ 54 Elo**, and the ordering is **not mode-stable**: under
SINGLE STRIKE the span is 17.3pp and PILFER beats WARD ~67–33. WARD's friendly
56.9-vs-bare reading hides that it is the worst rune in the pool in every mode.

**The lesson is structural: a roster balanced against nothing systematically
over-values defensive spells.** Against an opponent who is also gaining, swing
beats safety. Expect any new defensive rune's one-sided number to overstate it.

**Two cautions before trusting a cross-table.** `searchRoot` takes no charm, so
the bot does not know its opponent holds a rune — under symmetry that blindness
cancels, asymmetrically it does not, and adapting to the opponent's rune *is*
the content of asymmetric balance. And a cell measured in one direction only
carries ~1pp of seat bias; run both and average.

**Late is not automatically degenerate.** WARD and SUNDER cast at 83% and 74%
through the game because they wait for a *condition* — a real threat, a die
that matches several columns. The swap's lateness was different: hoarding was
unconditionally correct. Distinguish "waiting for a trigger" from "waiting
because later is always better".

**The machine's policy is the shipped one.** `machineCast` in `core/spells.ts`
is asked by both the offline CPU and the harness, so what is measured and what
plays can never be two different policies. A spell whose value never shows on
the boards (FATE, NUDGE, SUNDER) must provide a `cpuCast` hook, or the default
board-swing policy will never cast it and it will measure as worthless.

---

## 6. Adding a spell

One object in `core/spells.ts` is the whole spell. The rail, the gestures, the
charge accounting and the CSS never learn its name.

1. **The spec** — `id` (stable forever: persisted, tested, styled against),
   `name`, `blurb`, `detail`, `aim` (the line shown while it is armed —
   two landscape lines is its whole budget, see §7),
   `target` (`'column' | 'self'`), `side` (`'own' | 'foe'`, for column spells:
   which half the ring offers), `uses`, `commitsOnAim` only when showing the
   aim itself spends the charge, `locksOnAim` only when an uncommitted aim must
   receive a legal answer, `previewDieIndex()` when a column spell marks one
   exact die, `legal()`, `apply()`, and `cpuCast()` if its value is off-board.
2. **The icon** — a path in `ui/spellicons.ts` plus a hue.
3. **The cast animation** — an entry in `EFFECTS`
   (`src/flow/spell-effects.ts`), with `defaultEffect` as the fallback.
4. **Gate cases** — `tests/spells.test.ts` for the rules and
   `tests/browser/spells/run.mjs` for anything the player can see.
5. **Measure it** before shipping, and record the numbers here.

### The seams that already exist

- **`CastCtx`** — everything beyond the two boards: the die in hand
  (`setDie`), the supply (`draw`, `bagLeft`), the persistent marks (`charm`),
  the mode. Optional everywhere, so a call site with no hand to offer simply
  omits it and any spell needing one answers "not castable here".
- **`CharmSt`** (`core/rules.ts`) — persistent marks destruction consults.
  `openStrikes()` returns the plan for one placement (which columns, which
  victims, which are warded) and is read by *both* the headless `applyMove`
  and the animated flow, so screen and state cannot tell different stories.
  Without a charm, `applyMove` is the pre-spell hot path, untouched.

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
  card always shows the hand whose turn it is, including the machine's inert
  hand while it thinks. Only a legal player choice gets pointer events. Busy
  windows therefore change availability without changing
  ownership, while `nextTurn` repaints the slot with the other seat's remaining
  cards. Waiting, spending and handing over are three different pictures.
- **The armed line gets ONE line in portrait and TWO in landscape.** Not a
  preference — the status box is *reserved* at that size (`.status` /
  `.land .status` min-height, a fixed 104px lane in landscape), and a line
  past the reserve grows the box and walks the stage die up the screen: the
  same drift `test8` guards for ordinary turns. So `aim` says WHICH column the
  tap wants and stops. The verb is already on the rune the player just pressed
  — its name, its icon, its `blurb` — and the board rings the legal targets in
  gold. What the rings *cannot* say is why they are silent, which is exactly
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

### The rune in play: RC4's charge stack (selected 2026-08-23)

Six alternatives remain as design history in
`design/screens/studies/open/29a…29f`, group **"4g · The rune in play"** in
Claude Design. **RC4 — The charge stack** is production. The constraints below
are its contract, not another comparison brief.

**The problem it solved.** The first build used a rounded-square control beside
the die and a second, smaller readout in the opponent's nameplate — two
implementations of one idea — then threw away the card dealt during the reveal.
The rail now keeps that card vocabulary in play.

**The frame, decided:**

- **One slot, one card, and it belongs to whoever is to move.** The nameplate
  readout goes away; the plate gives that lane back to the score. Watch
  "Reserve, never collapse" above when it does.
- **The card is the reveal's card at rail size** — same face, same deck back,
  same corner index, icon centred (`.rdealt` / `.rface` / `.rback` in
  `styles/components/rune-deal.css`). Not a new object.
- **At rest it is SMALLER than the die in play.** Same width as the button it
  replaces, buying its presence in height only, and stopping short:
  card height `--cell*.81` against a die of `--cell*.92`, about 88% of it.
  Only the ACTIVE card passes the die, at 1.16. The die is the thing being
  decided about; a rune that out-measures it steals the centre.
- **Portrait aligns it with the board's third column.** The die keeps the
  table's centre while the card stays vertically beside it and places its own
  centre on the rightmost column's centre line (`--cell + --gap`). Landscape
  keeps the existing compact answer: the card is centred above the die.
- **Its rune colour is always present and quiet.** Both faces carry the same
  oversized 12% → 4% → transparent surface wash. It has no breathing halo and
  the wash itself does not change with availability or busy state. For the full
  machine turn the shared card restores the historical opponent cue: 42%
  opacity with partial grayscale. An own rune with no legal target uses that
  same mute so every registry spell advertises whether it can be activated.
  Brief busy or phase locks keep the stable pre-lock appearance; pressing still
  supplies the selected flip and 1.16 enlargement.
- **It carries NO seat mark** — no seat colour, no mirrored lean. The die in
  play is beside it and is already painted in the colour of whoever is to move,
  the status line names them, and only one card is ever in the slot. A seat
  hue could not be honest anyway: both seats are dealt the same rune
  (symmetry, §2), so the face wears the RUNE's hue in either hand.
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
leaves the same number of dashed outlines. FATE therefore reads as two, then
one, then an empty two-card stack without a numeric badge. The drag ghost is
the same face-up card, reduced motion resolves directly to the remaining hand,
and the fixed outline keeps portrait, landscape and LIMITED stage geometry
unchanged.

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
  other destruction cue may play when it lands. PILFER and COLUMN SHIELD share
  gold, so legality remains distinguished by form rather than hue alone.
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
  authoritative slot. Only a genuine opponent strike with victims animates a
  break: a copy of the settled attacking die travels straight until its leading
  edge meets the clasp, then follows W3's longer rebound while contact spends
  the ward and the seal snaps. The clasp and seal provide the light; no generic
  particle burst, die rotation, or screen flash obscures the break. A miss, an
  own placement, or a strike already stopped by COLUMN SHIELD produces no
  attacker ghost or false break.
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
  whole time; only a computed style could see it (`tests/test20.mjs`).
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

## 8. Scope: offline only

Ranked deals an empty hand, by decision (2026-08-21). The layer is optional by
construction — charges are dealt in exactly one place (`resetSpells`), and
ranked, the tutorial and the NONE pick all deal `{}`, which is the single
thing the runtime asks before showing a rail or allowing a cast.

The online path is *designed* and its seams exist (a cast is a logged entry
replayed through this same registry; FATE draws from the seeded stream), but
wiring it is its own later step. A ranked turn would then carry two log
entries — an optional cast, then the placement — which is a protocol shape
change the server validator must accept.

### If ranked ever deals spells: symmetric first, and probably only

**Symmetric-online is a strict prefix of asymmetric-online.** Dealing both seats
the same rune — spun server-side from the match seed, exactly as `pickMode` does
— needs one `matches.spell` column and changes nothing else about the protocol,
the replay or the reveal. Dealing *different* runes needs all of that plus a
balanced pool, and the pool is not balanced: §5's cross-table spans 7.7pp in
classic and 17.3pp under SINGLE STRIKE.

For scale: the ladder's own built-in asymmetry, the seat handicap in
`docs/LADDER.md`, is at most 3.4pp. A random asymmetric rune deal costs ~3.4pp
on average **in classic alone**, and 7.8–8.3pp across the mode wheel. It would
also drown the rating handicap it sits beside and randomise its sign.

The client is already built for it — `S.spellCharges` is per-seat and the rail
renders "you carry what you BROUGHT" (`flow/spells.ts`) — so the cost is not
plumbing. It is balance, and it is a real cost. If asymmetry is wanted for its
own sake, a **mirror draft** (the same three runes offered to both, each picks
blind) converts residual imbalance from *unfair* into *boring*, which is the
better failure mode; it still needs the flat pool.
