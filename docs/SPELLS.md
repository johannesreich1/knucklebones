# Spells — the design rules

*What a spell is allowed to be in this game, why the current five exist, and
what a sixth would have to prove. `docs/STATUS.md` records what shipped and
when; this file records **the thinking**, so a later session can add a spell
without re-deriving it — or can knowingly overrule it.*

Spells are an **optional layer over offline play**. Both seats always hold the
same rune, one cast per turn at most, and a cast is **not a move** — your die
still lands afterwards.

---

## 1. The four principles

Every spell in this game is judged against these. They came out of retiring
the first one (§3), and they are the reason the current five feel different
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
- **What has already paid out cannot be taken back.** A self spell can be
  pressed again to undo it while the die it changed is still in hand — but
  only when putting it back leaves the caster *exactly where they were*. If a
  cast **revealed** something, or handed over an advantage that survives the
  reversal, it is **final**: you cannot un-see a die, and "cast, peek, undo"
  is a free look paid for with nothing. FATE is the roster's only one so far
  (it draws the next die from the supply) and carries `final: true`; board
  spells are final by construction, because their dice have visibly flown.
  Asked of the registry, never of a spell's name — and gated mechanically:
  `tests/spells.test.ts` watches `CastCtx.draw` and fails any self spell that
  draws without being marked, so the next one is caught the day it is written.
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
directions averaged, noise floor 0.9pp), the shipped five against **each
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
   which half the ring offers), `uses`, `final` (for a *self* spell whose cast
   reveals something or otherwise pays out before it could be undone — see §2;
   a self spell that calls `ctx.draw()` MUST set it, and the gate enforces
   that), `legal()`, `apply()`, and `cpuCast()`
   if its value is off-board.
2. **The icon** — a path in `ui/spellicons.ts` plus a hue.
3. **The cast animation** — an entry in `CAST_FX` (`flow/spells.ts`).
4. **Gate cases** — `tests/spells.test.ts` for the rules, `tests/test14.mjs`
   for anything the player can see.
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
- **A self spell casts on press.** One possible target means nothing to aim.
  Dragging still works; dropping anywhere else cancels with the charge intact.
- **And pressing it again takes it back**, for as long as the die it changed is
  still in hand — placing the die closes the window. Implemented as a SNAPSHOT
  taken at cast time (die, supply, charm), never as a per-spell inverse, so a
  spell does not have to know it can be undone. Two kinds of cast are never
  offered the window at all (§2, *what has already paid out*): board spells,
  whose dice have visibly flown, and spells the registry marks **`final`**
  because the cast already revealed something — **FATE**, which draws the next
  die and cannot un-show it. The window is decided in exactly one place
  (`castBy` asks `target === 'self' && !final`), so no gesture, keyboard path
  or rune state can offer a take-back the rule forbids. The rune stays lit and
  pressable *while the window is open* — and a final cast must read spent at
  once, or the UI is inviting the peek the rule exists to prevent.
- **A rune you cannot cast this turn must LOOK uncastable.** `disabled` was
  the whole answer for a while, and disabled is invisible: vs the machine the
  rail rune is always yours (`near` = `S.bottom`), so it sat full-bright and
  breathing while the AI thought — a control inviting a press that could never
  land (user report, 2026-08-22). It now dims (`.rune.offturn`, opacity .42 +
  grayscale) for exactly as long as the turn is the other player's. Three
  things make that safe, and each was a bug waiting: it is keyed on **`S.turn`,
  not `caster()`** — caster() also goes null through every busy window inside
  your own turn, which is the flicker that made the old rule "never restyle per
  turn"; the glow ring is **paused, not re-classed**, because a class coming
  back restarts an animation from its first keyframe and that snap is what the
  old rule was protecting; and only the **wielded** rune wears it, since the
  opponent's readout is already `.idle` and dimming it twice would say
  something else. It must also stay clearly brighter than `.spent` — waiting is
  not spending. The turn machine had to learn to repaint the rail
  (`nextTurn` → `renderSpells()`): on the machine's turn nothing else did, so
  the rune kept the look it had when you last moved.
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
  — long WORDS break lines, not long strings. `test14` §12 arms every registry
  entry on the narrowest phone in both orientations and measures the box
  against the CSS's own reserve. Burned by ANVIL, which shipped reading "Tap a
  filled column to recast its weakest die": four lines landscape (die shoved
  12.6px), two portrait (6px), and the rules it spelled out were already on
  the picker slice and the library card.
- **Reserve, never collapse.** Anything sharing the vertically-centred score
  cluster (the rune slot, BOUNTY's ✦ lane) must hold its place for the whole
  game, or the cluster re-centres and the score visibly jumps when the thing
  appears or leaves. Likewise the column chip *centres* its contents, so marks
  sit at its ends, out of that row.
- **When measuring any of this, sample after `.plate.bump` settles (190ms).**
  A changed total scales the number, and reading inside that window looks
  exactly like layout drift.

### The RANDOM draw is shown, not silent (2026-08-22)

RANDOM used to draw its rune inside `resetSpells` and the player met it in the
rail. It is now dealt in front of them: `ui/runedeal.ts` shuffles the roster as
a deck and draws one card (`design/screens/28-rune-deal`). Four rules it keeps,
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
