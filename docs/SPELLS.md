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

The roster spans **55.7–63.1**, against the retired swap's 70.5/81.8.

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
   `name`, `blurb`, `detail`, `aim` (the line shown while it is armed),
   `target` (`'column' | 'self'`), `side` (`'own' | 'foe'`, for column spells:
   which half the ring offers), `uses`, `legal()`, `apply()`, and `cpuCast()`
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
  still in hand — placing the die makes the cast final. Implemented as a
  SNAPSHOT taken at cast time (die, supply, charm), never as a per-spell
  inverse, so a spell does not have to know it can be undone. Board spells are
  deliberately excluded: their dice have visibly flown, and un-flying them
  would be a lie about what the player just watched. The rune stays lit and
  pressable while the window is open — it must not read as spent yet.
- **Reserve, never collapse.** Anything sharing the vertically-centred score
  cluster (the rune slot, BOUNTY's ✦ lane) must hold its place for the whole
  game, or the cluster re-centres and the score visibly jumps when the thing
  appears or leaves. Likewise the column chip *centres* its contents, so marks
  sit at its ends, out of that row.
- **When measuring any of this, sample after `.plate.bump` settles (190ms).**
  A changed total scales the number, and reading inside that window looks
  exactly like layout drift.

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
