# Multiplayer runes — balance and feasibility investigation

Status: **MEASUREMENT BASELINE COMPLETE — asymmetric baseline plus WARD and SUNDER sensitivities complete; owner decisions and multiplayer protocol design remain**

Started: **2026-08-24**

This document investigates two proposed ranked multiplayer formats:

1. **Personal-rune modes** — all seven existing game modes still apply to both
   players, while each player brings an individually equipped rune. The rune is
   locked before matchmaking and both runes become visible when the match is
   revealed.
2. **Rune Trial** — an additional game-mode outcome in which equipped runes do
   not apply. Both players receive the same three randomly offered runes, choose
   secretly, and reveal their choices together.

Balance is the primary question. Multiplayer authority and replay feasibility
are the second question. Persistent unlocking, repeat-play motivation, and
potentially compulsive reward structures are considered only far enough to
avoid choosing a balance model that cannot support a healthy progression model.

No rule in this document is shipped merely because it is described here.

---

## 1. Evidence discipline

Every substantive statement should carry one of these meanings:

- **FACT** — directly present in current source, tests, migrations, or an
  authoritative project document.
- **REPRODUCED** — observed by running an existing committed tool, with the
  exact command and environment recorded.
- **HISTORICAL** — recorded result whose original harness or raw output is not
  currently available for independent reproduction.
- **DERIVATION** — arithmetic or combinatorics calculated from stated facts;
  no gameplay behaviour is assumed.
- **INFERENCE** — engineering or balance consequence supported by facts but not
  yet measured end to end.
- **HYPOTHESIS** — product expectation that requires player or simulation data.
- **UNKNOWN** — a quantity or behaviour that cannot be derived until a missing
  rule or measurement exists.
- **DECISION NEEDED** — a product rule that has not been selected.

Evidence priority is current executable rule source, current reproducible
measurements, current tests, dated design records, then hypotheses. A one-sided
rune-versus-no-rune result is not evidence that two different runes are balanced.

---

## 2. Working definitions of the proposed formats

These are **user-directed proposals**, not current behaviour.

### 2.1 Personal-rune modes

- One shared game mode governs both players, as today.
- Each player equips one owned rune before entering matchmaking.
- Matchmaking locks the rune before the opponent and mode are known.
- The match reveal shows the shared mode and both equipped runes.
- Players may bring the same rune or different runes.
- Rune identity and remaining charges stay visible during play.
- All seven current modes use this personal-rune rule.

The intended identity is “this player brings WARD,” not “this player drafts
WARD after seeing this opponent or mode.”

### 2.2 Rune Trial

- Rune Trial is proposed **in addition to** the existing seven modes; it is not
  currently proposed as a second modifier combined with each of them.
- Equipped runes are ignored for this match.
- The server offers the same three distinct random runes to both players.
- Both choices remain secret until both are committed, then reveal together.
- Both players may select the same rune.

**FACT:** the current project vocabulary defines a mode as a whole-match change
to scoring, destruction, or supply (`docs/MODES.md:8-24`). Rune Trial instead
changes pre-match rune assignment. Presenting it as an eighth player-facing mode
is possible, but it knowingly broadens that ontology; under the Classic
baseline it is mechanically a selection format that reuses Classic rules.

**DECISION NEEDED:** no separate scoring, destruction, or supply rule has been
specified for Rune Trial. This investigation therefore keeps two branches
explicit: a Classic-backed selection format, for which exact calculations are
possible now, and a genuinely new mechanical board mode, whose gameplay
effects cannot be calculated until its rule exists. Classic is a neutral
analytical baseline, not a selected design.

**DECISION NEEDED:** Rune Trial's wheel probability is unspecified.

---

## 3. Current shipped facts

### 3.1 Ranked currently has no runes

- **FACT:** Ranked deals both seats an empty rune hand. The status rule remains
  that ranked must do so until casts have a server-written replayable protocol
  (`docs/STATUS.md:30-35`, `docs/SPELLS.md:612-623`,
  `src/flow/spells.ts:103-122`).
- **FACT:** `matches.modifier` stores one shared mode. No match-global or
  per-player rune field exists (`supabase/migrations/0003_pvp_pivot_v2.sql:42-55`,
  `supabase/migrations/0009_match_modifier_wheel.sql:1-7`).
- **FACT — repository ledger only:** the current `MODES` registry can draw
  `limited`, but the latest repository definition of `matches_modifier_check`
  accepts only `classic`, `rowswitch`, `rowmult`, `colshield`, `singlestrike`,
  and `bounty` (`src/core/modes.ts:45-53`,
  `supabase/migrations/0010_modifier_singlestrike_bounty.sql:4-7`). No later
  migration in the current tree adds `limited` to that constraint. A clean
  schema from this ledger would therefore reject a match row drawn as LIMITED.
  Live production schema state was not inspected and is **unknown**; this is not
  a claim about what production currently accepts.
- **FACT:** `match_moves` records placements, not casts
  (`supabase/migrations/0003_pvp_pivot_v2.sql:64-70`,
  `supabase/migrations/0008_pvp_move_die.sql:1-6`).
- **FACT:** The browser submits placement intent rather than dice, scores, or
  state; the server rebuilds from its seed and written log
  (`docs/architecture/backend.md:8-19`, `supabase/functions/README.md:28-33`).
- **FACT — repository state:** no PvP Edge-function closure in the current tree
  imports `core/spells.ts`
  (`supabase/functions/README.md:69-77`).

### 3.2 Offline rune state can represent different hands

- **FACT:** `S.spellCharges` is a two-seat tuple of independent rune-charge
  records (`src/state.ts:107-122`).
- **FACT:** the current dealer nevertheless gives both seats the same rune
  (`src/flow/spells.ts:96-106`).
- **FACT:** a spent hand retains the rune id at charge zero, so the rune brought
  to the match remains derivable for the entire match
  (`src/core/spells.ts:234-250`).
- **FACT:** every current rune is cast only on its holder's turn. No rune asks
  the opponent for a reaction or interrupt input; WARD may then persist across
  later turns until a real strike consumes it (`docs/SPELLS.md:64-69`,
  `src/core/spells.ts:73-105`).
- **FACT:** committed effects are intended to be final, and the current design
  already treats a cast as an ordered event that can precede the placement
  (`docs/SPELLS.md:64-85`, `docs/SPELLS.md:619-623`).

This means the browser state shape is not the primary feasibility gap. It does
not mean the server protocol, replay, bot policy, reconnect path, or balance is
already solved.

### 3.3 Current rune roster

Source of rule truth: `src/core/spells.ts:28-221` and
`src/core/spell-types.ts:17-48`.

| Rune | Uses | Target | Direct rule effect | Persistent/ordering state |
|---|---:|---|---|---|
| FATE | 2 | own die | Discard the die in hand and draw the next supply die | Consumes the live supply; LIMITED consumes its finite bag and does not return the discard |
| NUDGE | 1 | own die | Increase the die by one; 6 wraps to 1 | Changes the die that must later be placed |
| WARD | 1 | own column | Absorb the next otherwise-real strike against that column | Persists until a strike with victims consumes it |
| SUNDER | 1 | own die | The following placement strikes every enemy column containing that face | Persists for exactly the following placement |
| PILFER | 1 | enemy column | Move the enemy column's top die onto the facing own column | Can fill the caster's board; the moved die lands without striking |
| ANVIL | 1 | full own column | Replace the weakest die in that full column with the die in hand | The hand die remains available for the normal placement |

Additional rule facts:

- **FACT:** FATE, NUDGE, and SUNDER act on the die in hand. WARD and ANVIL target
  the owner's board. PILFER is the only current enemy-board rune.
- **FACT:** WARD cannot target an already COLUMN SHIELD-protected full column
  (`src/core/spells.ts:73-105`).
- **FACT:** PILFER cannot take from a COLUMN SHIELD-protected full column and
  cannot land in a full facing own column (`src/core/spells.ts:131-158`).
- **FACT:** ANVIL is legal only on a full own column and refuses a replacement
  that would change nothing (`src/core/spells.ts:160-218`).
- **FACT:** one cast never replaces the normal placement. The die still lands
  afterward unless the cast itself fills a board and ends the game
  (`docs/SPELLS.md:14-16`, `src/flow/spells.ts`).

#### Unresolved cast-count rule

FATE is the only current two-charge rune, so it is the only current rune that
exposes a four-way disagreement:

| Surface | Current behaviour | Direct evidence |
|---|---|---|
| Written rule | At most one cast per turn | `docs/SPELLS.md:14-16`; `docs/history/2026-08-sprint.md:210-214` |
| Normal human UI | Both FATE charges may be cast sequentially before placement when each redraw is legal | Gesture → charge-only legality → return to `choose` → rail re-enabled: `src/flow/spell-gestures.ts:29-89`, `src/flow/spells.ts:62-69,270-312`, `src/flow/spell-rail.ts:25-59`, `src/flow/game.ts:121-132` |
| Local CPU | At most one cast, then it chooses a column and places | One `aiSpellTurn` call per turn: `src/flow/game.ts:154-167`, `src/flow/spell-ai.ts:35-59` |
| Maintained simulator | At most one cast attempt, then placement and turn flip | `tools/spellsim.ts:64-97` |

Additional **FACTS**:

- No current state field records “cast used this turn”; legality checks only
  phase/busy state, current seat, charges, and rune legality
  (`src/state.ts:107-123`, `src/flow/spells.ts:62-69,307-311`).
- A browser scenario calls `cast('fate', -1)` twice without a placement and
  asserts the charge stack changes 2 → 1 → 0
  (`tests/browser/spells/scenarios/effects.mjs:269-288`). It uses an internal
  hook rather than two physical taps, but the normal gesture path independently
  permits the same calls.
- Every completed human cast restarts the normal placement clock
  (`src/boot.ts:28-31`). Under the permissive rule, chaining FATE also refreshes
  that clock twice.
- In LIMITED, the second chained FATE is legal only while another bag die
  remains; a human may consume two supply draws before one placement, while the
  CPU and simulator consume at most one.
- Player copy says “Two casts per game”; it does not answer whether they may be
  consecutive (`src/i18n/locales/en/game.ts:203-208`).

Historical audit:

| Commit | Observed change |
|---|---|
| `31d5f1b` | Candidate simulator introduced the still-current one-cast-then-place loop. |
| `38c360f` | FATE ×2 shipped. Human cast returned to `choose` with no per-turn marker, while CPU and simulator attempted once. The divergence therefore existed in FATE's first shipped revision. |
| `39f6df8` | A self-rune tap began casting immediately, making tap–tap chaining direct. |
| `3ba3f1f` | `docs/SPELLS.md` first declared one cast per turn; that commit did not change runtime or simulator. |
| `e7c13bf` | A temporary post-cast take-back made a second tap undo FATE; it added no per-turn guard, and another cast path remained permissive. |
| `e9b9a4b` | FATE alone became final because redraw information cannot be unseen. A second tap again cast its remaining charge. |
| `1bcb571` | Post-cast undo was removed roster-wide; charge-only cast gating remained. |
| `15d9fab` | The RC4 charge-stack browser scenario explicitly spent both charges before placement to verify two cards → one card → empty outlines. It did not amend the written rule. |

No inspected commit message or design record consciously selects multiple casts
over the written one-cast rule. The RC4 test's stated purpose is visual stack
progression, so its product-rule intent is **unknown** rather than evidence of an
owner decision.

**BALANCE FACT:** every retained FATE simulator number measures at most one cast
per turn, not the larger normal-human action set. The direction and magnitude of
the difference are unmeasured. Same-rune human-versus-CPU offline play is
therefore action-set asymmetric for FATE today.

**DECISION NEEDED:** authoritative multiplayer and future balance measurements
must select and enforce either one cast per turn or multiple casts while charges
remain. The former needs authoritative turn-level used-cast state; the latter
needs an online grammar of zero-to-many casts before placement rather than the
currently documented singular optional cast.

### 3.4 Current game modes and ranked weights

Source of registry truth: `src/core/modes.ts:40-53`. Source of rules:
`src/core/rules.ts:76-154`.

| Mode | Current ranked probability | What changes | Measured first-mover win rate |
|---|---:|---|---:|
| CLASSIC | 40% | Baseline scoring and destruction | 50.74% |
| ROW SWITCH | 10% | Rows, rather than columns, determine score | 51.37% |
| ROW MULTIPLY | 10% | Column score plus additional matching-row score | 51.51% |
| COLUMN SHIELD | 10% | A full column cannot be struck | 52.65% |
| SINGLE STRIKE | 10% | A strike removes only the matching die nearest the centre | 52.05% |
| BOUNTY | 10% | Each destroyed die banks a permanent +1 | 49.91% |
| LIMITED | 10% | One shared 24-die bag; an empty bag also ends the match | 46.63% |

The seating measurements used 60,000 games per mode, three seeds, and report a
95% confidence interval of ±0.40 percentage points
(`src/core/modes.ts:17-38`, `docs/LADDER.md:439-469`). They contain no runes.

- **FACT:** both players always play the same mode (`docs/MODES.md:31-46`).
- **FACT:** the lower-rated player opens every ranked mode. LIMITED's measured
  inversion is deliberately not special-cased (`docs/LADDER.md:439-480`).
- **FACT:** current weights total 10: Classic has weight 4 and each of six
  additions has weight 1 (`src/core/modes.ts:40-53`).

### 3.5 Existing mode–rune interaction facts

The currently published values below are one rune holder versus a rune-less
twin, not rune-versus-rune matchup results.

- **HISTORICAL:** PILFER measured 63.1% versus no rune under COLUMN SHIELD. The
  design explanation is that removing the top enemy die can unfill a column and
  deny the mode's protection (`docs/SPELLS.md:192-204`).
- **HISTORICAL:** WARD measured 49.5% versus no rune under COLUMN SHIELD and was
  cast in only 61% of symmetric games. The mode already protects full columns
  and forbids warding those columns (`docs/SPELLS.md:192-204`).
- **HISTORICAL:** ANVIL measured high under COLUMN SHIELD and SINGLE STRIKE,
  both of which preserve or increase the importance of full columns
  (`docs/SPELLS.md:170-180`).
- **FACT:** the deal currently does not reject a known weak or hot mode–rune
  pairing. Whether it should do so is explicitly open
  (`docs/MODES.md:122-137`).
- **FACT:** FATE consumes an additional die from LIMITED's finite bag; the
  discarded die is not returned (`src/core/spells.ts:28-51`,
  `src/core/dice.ts:35-48`).
- **FACT:** a WARD in one column absorbs that column's next real SUNDER strike,
  while SUNDER may still strike matching dice in other columns
  (`src/core/rules.ts:157-221`).
- **FACT:** PILFER bypasses WARD because it moves a die directly rather than
  opening a strike (`src/core/spells.ts:131-158`).
- **FACT:** SUNDER can destroy dice in multiple columns and therefore bank
  multiple BOUNTY points; a WARD that prevents destruction in its column also
  prevents the corresponding bounty (`src/core/rules.ts:157-221`).
- **FACT:** no retained mode-specific numeric rune row or matchup cell is
  published for ROW SWITCH, ROW MULTIPLY, or BOUNTY. Unauditable historical
  wheel aggregates and the claim that WARD was weakest in every measured mode
  survive, but not their per-mode data (§4.3). The current cast and placement
  policies also have known blind spots for these scoring states (§4.1).

### 3.6 Complete rules-level pair/mode map

This subsection is an exhaustive mechanics audit of the 15 distinct opposing
rune pairs across all seven current modes. It is **not win-rate evidence**. A
rule-level counter can be rare in actual games; a pair with no special hook can
still be highly polarized through timing, score value, or board shape.

Here, a **direct interaction** means that one rune's cast reads, writes,
protects, or invalidates state reached by the opposing rune. A transformed
FATE/NUDGE die still makes a mandatory ordinary placement; interaction at that
later placement is labelled *placement-mediated*, not attributed to the hand
cast itself. All pairs can affect later ordinary play through changed boards.

#### Direct interaction graph — raw facts

- **WARD–SUNDER is a direct counter.** SUNDER's next placement creates one
  strike outcome per enemy column containing victims. WARD cancels the whole
  outcome in its marked column and is consumed; other SUNDER columns proceed.
  A column with no victims creates no outcome and does not spend WARD
  (`src/core/spells.ts:73-129`, `src/core/rules.ts:182-221`).
- **WARD–PILFER is a direct bypass.** PILFER pops and pushes the top die without
  calling placement/strike resolution or consulting charm. It neither consumes
  WARD nor destroys on arrival (`src/core/spells.ts:131-158`,
  `src/core/rules.ts:182-221`).
- **SUNDER–ANVIL has direct eligibility denial.** A successful SUNDER strike on
  a full enemy column removes at least one die, after which ANVIL's
  full-column legality fails. ANVIL can change a vulnerable face but not the
  column height. COLUMN SHIELD blocks this denial once the column is full,
  because the shield yields no victims (`src/core/spells.ts:108-129,160-218`,
  `src/core/rules.ts:121-142`).
- **PILFER–ANVIL has direct eligibility denial.** When the receiving column has
  room, PILFER can remove the top die from an enemy full column and make ANVIL
  illegal there. COLUMN SHIELD blocks this after fullness because PILFER
  refuses a shielded source (`src/core/spells.ts:131-218`,
  `src/core/rules.ts:121-127`).
- **LIMITED gives every FATE pairing a shared-supply interaction.** Every FATE
  redraw consumes an extra entry from the common 24-die bag and the discarded
  die does not return, reducing the remaining placement horizon by one. FATE
  refuses a cast only when no drawable bag die remains
  (`src/core/spells.ts:28-51`, `src/core/dice.ts:35-58`,
  `src/core/rules.ts:151-155`).

Outside LIMITED's shared-supply coupling for every FATE pair, there is no
board-, charm-, or hand-level opposing-rune cast hook in the other 11 pairs:
FATE–NUDGE, FATE–WARD, FATE–SUNDER, FATE–PILFER, FATE–ANVIL, NUDGE–WARD,
NUDGE–SUNDER, NUDGE–PILFER, NUDGE–ANVIL, WARD–ANVIL, and SUNDER–PILFER. Across
all seven modes, the six pairs with no such special hook at all are the four
remaining NUDGE pairs, WARD–ANVIL, and SUNDER–PILFER. More precisely:

- the mandatory placement of a FATE/NUDGE-transformed die can later meet a
  WARD, but the transform itself cannot;
- SUNDER and PILFER have board-mediated sequencing—PILFER may move a face into
  or out of later SUNDER victim state, while destruction may open receiving
  room—but neither effect has a special rule for the other;
- no spell rule branches on the opponent's rune id.

#### All 15 pairs across all seven modes

Legend:

- `0`: no direct cast-level link; `PM`: mandatory-placement-mediated only;
- `C`: WARD counters SUNDER; `BY`: PILFER bypasses WARD;
- `BM`: ordinary board-mediated sequencing only; `D`: direct ANVIL-eligibility
  denial;
- `R`: row scoring/reindexing changes value, not effect legality;
- `W↓`, `S↓`, `P↓`: COLUMN SHIELD narrows WARD, SUNDER, or PILFER to non-full
  columns/sources; `A↑`: an ANVIL-eligible full target is shield-protected;
- `1`: SINGLE STRIKE caps a strike outcome at one victim per column;
- `$`: destroyed dice bank BOUNTY; PILFER/ANVIL casts destroy zero;
- `L`: FATE consumes one additional shared LIMITED draw per cast; `same`:
  Classic scoring/destruction plus LIMITED's finite ending.

| Opposing pair | Classic | Row Switch | Row Multiply | Column Shield | Single Strike | Bounty | Limited |
|---|---|---|---|---|---|---|---|
| FATE–NUDGE | `0` | `0 + R` | `0 + R` | `0` | `0`; ordinary hits `1` | `0`; ordinary kills `$` | `L` |
| FATE–WARD | `PM` | `PM + R` | `PM + R` | `PM` on non-full; `W↓` | `PM`; WARD cancels ≤1 | `PM`; cancelled kill banks 0 | `PM + L` |
| FATE–SUNDER | `0` | `0 + R` | `0 + R` | `0`; `S↓` | `0`; SUNDER ≤1/column | `0`; SUNDER kills `$` | `L` |
| FATE–PILFER | `0` | `0 + R` | `0 + R` | `0`; `P↓` | `0`; PILFER unchanged | `0`; PILFER itself `$0` | `L` |
| FATE–ANVIL | `0` | `0 + R` | `0 + R` | `0`; `A↑` | `0`; ANVIL unchanged | `0`; ANVIL itself `$0` | `L` |
| NUDGE–WARD | `PM` | `PM + R` | `PM + R` | `PM` on non-full; `W↓` | `PM`; WARD cancels ≤1 | `PM`; cancelled kill banks 0 | `same` |
| NUDGE–SUNDER | `0` | `0 + R` | `0 + R` | `0`; `S↓` | `0`; SUNDER ≤1/column | `0`; SUNDER kills `$` | `same` |
| NUDGE–PILFER | `0` | `0 + R` | `0 + R` | `0`; `P↓` | `0`; PILFER unchanged | `0`; PILFER itself `$0` | `same` |
| NUDGE–ANVIL | `0` | `0 + R` | `0 + R` | `0`; `A↑` | `0`; ANVIL unchanged | `0`; ANVIL itself `$0` | `same` |
| WARD–SUNDER | `C` per victim-bearing column | `C + R` | `C + R` | `C` only non-full; full shield supersedes | `C`; each cancelled outcome ≤1, other columns proceed | `C`; warded column kills/`$ = 0`, others bank | `C`; same destruction |
| WARD–PILFER | `BY`; WARD remains | `BY + R` | `BY + R` | `BY` on non-full warded source; full source barred | `BY`; PILFER unchanged | `BY`; PILFER kills/`$ = 0`, WARD remains | `BY` |
| WARD–ANVIL | `0`; WARD only affects strikes | `0 + R` | `0 + R` | structural separation: `W↓`, `A↑` | `0`; WARD outcome ≤1 | `0`; WARD may deny ordinary kill/`$`; ANVIL `$0` | `0` |
| SUNDER–PILFER | `BM` only | `BM + R` | `BM + R` | `BM`; neither can touch the relevant full enemy column | `BM`; SUNDER ≤1/column, PILFER unchanged | `BM`; SUNDER kills `$`, PILFER `$0` | `BM` |
| SUNDER–ANVIL | `D`; any hit un-fills target | `D + R` | `D + R` | `D` blocked once ANVIL is legal; `S↓/A↑` | `D`; one removal suffices and several full columns can be denied | `D`; removed dice bank `$` | `D` |
| PILFER–ANVIL | `D` if receiver has room; ANVIL changes the stealable top first only when it is the selected weakest die—strictly below both earlier dice | `D + R` | `D + R` | `D` blocked once ANVIL is legal; `P↓/A↑` | `D` unchanged | `D`, but PILFER kills/`$ = 0` | `D` |

Mode details behind the compact table:

- **FACT:** ROW SWITCH and ROW MULTIPLY change scoring, not cast legality or
  destruction. Boards are bottom-first arrays. A strike may remove an interior
  die and compact later row indices; WARD prevents that removal/reindexing.
  PILFER pops the top without compacting surviving source indices and pushes
  into the receiver's next row. ANVIL changes one fixed index. FATE/NUDGE
  change the face later appended (`src/core/rules.ts:12-16,87-119,172-221`,
  `src/core/spells.ts:28-70,131-218`).
- **FACT:** COLUMN SHIELD checks fullness before producing strike victims.
  WARD refuses an already shielded full own column, SUNDER has no strike outcome
  against one, and PILFER refuses it as a source. COLUMN SHIELD does not itself
  bar ANVIL because ANVIL does not consult shield state; its full-column and
  changed-value legality checks still apply
  (`src/core/rules.ts:121-142`, `src/core/spells.ts:82-105,146-150,192-218`).
- **FACT:** SINGLE STRIKE changes only the victim selector. PILFER and ANVIL
  bypass strike resolution, while SUNDER can still strike multiple columns but
  at most one victim in each (`src/core/rules.ts:129-142,182-221`).
- **FACT:** BOUNTY banks the killed count returned by placement. A WARDed
  outcome kills and banks zero; SUNDER may bank across columns; direct
  PILFER/ANVIL board mutation has no kill path (`src/core/rules.ts:144-149,203-221`).

This map establishes which cells deserve mechanism-specific diagnostics. It
does not establish the frequency, sign, or size of any matchup advantage.

---

## 4. What the pre-investigation simulator actually measures

Committed tool: `tools/spellsim.ts`.

This section preserves the baseline that existed when the investigation began.
The later asymmetric v1 instrument fills its missing pair coverage but retains
the named policy limitations (§6.5).

### 4.1 Experimental policy

- **FACT:** placement uses the offline Medium anchor: depth 2, risk weight 0.9,
  opponent weight 1 (`tools/spellsim.ts:13-18`, `:91-93`).
- **FACT:** casting uses the shipped `machineCast` heuristic at Medium demand 16
  (`tools/spellsim.ts:50-59`, `:76-87`).
- **FACT:** dice and search tie breaks use a deterministic Mulberry32 stream,
  default seed `20260821` (`tools/spellsim.ts:33-48`).
- **FACT:** a one-sided run alternates which identity holds the rune and who
  opens, cancelling the simple holder/seat correlation
  (`tools/spellsim.ts:114-129`).
- **FACT:** the symmetric timing run gives both seats the same rune
  (`tools/spellsim.ts:131-147`).
- **FACT:** `playGame` accepts exactly one `SpellSpec` plus two booleans saying
  whether each seat holds that same spell. The committed tool cannot assign
  rune X to one player and rune Y to the other
  (`tools/spellsim.ts:61-70`).
- **FACT:** configuration coverage is not exhaustive. Every rune gets Classic;
  selected runes get only selected notable modes. ROW SWITCH, ROW MULTIPLY, and
  BOUNTY are absent from the configured spell experiments, and most runes are
  not measured under LIMITED, COLUMN SHIELD, or SINGLE STRIKE
  (`tools/spellsim.ts:108-170`).
- **FACT:** one global random stream continues across configurations rather than
  resetting per rune/mode cell (`tools/spellsim.ts:47-48`, `:161-170`). Exact
  output therefore depends on the command's roster/configuration order as well
  as its seed.
- **FACT:** `searchRoot` receives mode but not rune ids, charge counts, or charm
  state (`src/core/ai.ts`, `tools/spellsim.ts:91-93`). It reacts to board states
  produced by earlier casts but cannot plan a placement around an unspent enemy
  threat or a standing WARD/SUNDER mark.
- **FACT:** the simulator checks `machineCast` only once before each placement,
  so it permits at most one cast per turn (`tools/spellsim.ts:74-97`). Current
  browser flow can spend both FATE charges before placing (§3.3). The retained
  FATE result therefore measures the written one-cast rule, not every action
  sequence accepted by the local runtime.
- **FACT:** current policies are not equally mode-aware. WARD's cast valuation
  uses ordinary column score even in row-scoring modes. Placement and cast
  lookahead do not carry BOUNTY bank state, and ignored return values mean the
  search also omits the new bounty earned by simulated kills. Placement search
  receives neither LIMITED bag composition nor remaining horizon
  (`src/core/spells.ts:73-105`, `src/core/spell-policy.ts:8-60`,
  `src/core/ai.ts:88-124`).
- **FACT:** SUNDER's cast heuristic evaluates its widened placement using a
  fresh charm, dropping any live opponent WARD from the comparison
  (`src/core/spells.ts:118-128`). `machineCast` receives only the caster's one
  rune spec, while the later placement search receives no rune id or charge
  state (`src/core/spell-policy.ts:94-121`, `src/core/ai.ts:88-124`).
- **INFERENCE:** a mechanically complete seven-mode matrix produced with these
  policies would still not be an equally informed seven-mode or matchup
  comparison.

### 4.2 Reproduced current output

**REPRODUCED 2026-08-24** on Node v24.2.0:

```text
/opt/homebrew/bin/node --experimental-strip-types tools/spellsim.ts --games 3000
```

Each configured row runs 3,000 one-sided games plus 3,000 symmetric timing
games. `win%` and `casts/game` come from the one-sided holder; `games with any
cast`, median timing, and late-cast percentage come from the separate symmetric
run.

| Rune / mode | One-sided win% | Holder casts/game | Symmetric games with any cast | Median cast fraction | Casts at ≥80% |
|---|---:|---:|---:|---:|---:|
| FATE / Classic | 59.3 | 1.82 | 99.9% | 0.35 | 7.9% |
| FATE / Limited | 60.8 | 1.76 | 99.9% | 0.41 | 10.4% |
| NUDGE / Classic | 55.7 | 0.95 | 99.4% | 0.26 | 4.6% |
| WARD / Classic | 56.9 | 0.71 | 100.0% | 0.83 | 52.5% |
| WARD / Column Shield | 49.5 | 0.33 | 60.7% | 0.94 | 68.9% |
| SUNDER / Classic | 60.6 | 0.47 | 74.0% | 0.74 | 42.1% |
| SUNDER / Single Strike | 59.3 | 0.45 | 70.3% | 0.86 | 58.1% |
| PILFER / Classic | 60.7 | 0.82 | 95.9% | 0.33 | 7.1% |
| PILFER / Column Shield | 63.1 | 0.51 | 76.7% | 0.42 | 17.4% |
| ANVIL / Classic | 59.0 | 0.61 | 89.7% | 0.74 | 42.8% |
| ANVIL / Column Shield | 63.0 | 0.58 | 87.9% | 0.74 | 40.5% |
| ANVIL / Single Strike | 62.7 | 0.63 | 88.3% | 0.78 | 47.9% |

The all-rune run reproduces all published non-ANVIL headline percentages
exactly. Its ANVIL results differ from the historical document's 60.2%, 62.8%,
and 63.2% (`docs/SPELLS.md:125-132`). The cause is configuration-stream
coupling, not an observed rule change: the tool seeds one stream for the whole
process and does not reset it between rune/mode cells. A focused ANVIL run at
the default seed reproduces the published values exactly:

```text
/opt/homebrew/bin/node --experimental-strip-types tools/spellsim.ts \
  --games 3000 --spell anvil --seed 20260821

Classic 60.2% · Column Shield 62.8% · Single Strike 63.2%
```

#### Common four-seed focused panel

**REPRODUCED 2026-08-24:** every maintained rune/configuration was run as a
separate spell-focused process at seeds 20260821–20260824:

```text
/opt/homebrew/bin/node --experimental-strip-types tools/spellsim.ts \
  --games 3000 --spell <rune> --seed <seed>
```

The committed simulator was unchanged. Each displayed cell is the one-sided
rune-holder-versus-bare-twin win percentage from 3,000 games; the separate
3,000-game symmetric timing cohort is not combined into it. Across 12 retained
configurations and four seeds, the panel represents 144,000 one-sided games plus
144,000 symmetric timing games.

| Rune / mode | 20260821 | 20260822 | 20260823 | 20260824 | Four-seed mean | Min–max | Span |
|---|---:|---:|---:|---:|---:|---:|---:|
| FATE / Classic | 59.3% | 58.2% | 58.1% | 58.8% | 58.6% | 58.1–59.3% | 1.2pp |
| FATE / Limited | 60.8% | 60.7% | 62.4% | 60.8% | 61.2% | 60.7–62.4% | 1.7pp |
| NUDGE / Classic | 56.2% | 56.9% | 56.0% | 56.0% | 56.3% | 56.0–56.9% | 0.9pp |
| WARD / Classic | 56.8% | 57.2% | 55.5% | 57.4% | 56.7% | 55.5–57.4% | 1.9pp |
| WARD / Column Shield | 50.0% | 49.6% | 50.9% | 49.3% | 50.0% | 49.3–50.9% | 1.6pp |
| SUNDER / Classic | 60.4% | 60.9% | 59.2% | 59.8% | 60.1% | 59.2–60.9% | 1.7pp |
| SUNDER / Single Strike | 58.8% | 58.2% | 59.5% | 58.6% | 58.8% | 58.2–59.5% | 1.3pp |
| PILFER / Classic | 61.8% | 63.0% | 62.9% | 59.7% | 61.9% | 59.7–63.0% | 3.3pp |
| PILFER / Column Shield | 64.5% | 65.1% | 65.4% | 65.7% | 65.2% | 64.5–65.7% | 1.2pp |
| ANVIL / Classic | 60.2% | 57.5% | 58.8% | 58.7% | 58.8% | 57.5–60.2% | 2.7pp |
| ANVIL / Column Shield | 62.8% | 64.1% | 63.5% | 64.9% | 63.8% | 62.8–64.9% | 2.1pp |
| ANVIL / Single Strike | 63.2% | 60.7% | 61.6% | 61.1% | 61.7% | 60.7–63.2% | 2.5pp |

Four-seed averages of the tool's already-rounded diagnostic fields:

| Rune / mode | Holder casts/game | Immediate `meanSwing` | Symmetric games with a cast | Median cast fraction | Casts at ≥80% |
|---|---:|---:|---:|---:|---:|
| FATE / Classic | 1.82 | 0 | 99.9% | 0.35 | 7.5% |
| FATE / Limited | 1.76 | 0 | 99.9% | 0.43 | 10.5% |
| NUDGE / Classic | 0.95 | 0 | 99.7% | 0.26 | 5.0% |
| WARD / Classic | 0.71 | 0 | 100.0% | 0.85 | 53.8% |
| WARD / Column Shield | 0.32 | 0 | 62.0% | 0.94 | 67.6% |
| SUNDER / Classic | 0.48 | 0 | 73.1% | 0.73 | 40.7% |
| SUNDER / Single Strike | 0.42 | 0 | 70.3% | 0.86 | 58.2% |
| PILFER / Classic | 0.82 | 18.8 | 96.2% | 0.33 | 6.5% |
| PILFER / Column Shield | 0.50 | 17.9 | 75.9% | 0.43 | 17.5% |
| ANVIL / Classic | 0.62 | 14.1 | 89.0% | 0.75 | 43.3% |
| ANVIL / Column Shield | 0.61 | 14.5 | 89.5% | 0.74 | 42.3% |
| ANVIL / Single Strike | 0.61 | 14.1 | 87.4% | 0.78 | 47.5% |

`meanSwing` is the immediate board-score delta used by this diagnostic. Zero
for a die transform or persistent charm does not mean zero gameplay value; its
value is realized by the later placement or strike.

An independent read-only completion audit reran all 24 focused processes and
matched every displayed win percentage and averaged diagnostic. The duplicate
runs verify reproducibility; they do not add independent seed information.

These four seeds are not a final uncertainty model. They show that one rounded
3,000-game headline moves by 0.9–3.3 percentage points across the retained
configurations; PILFER/Classic is widest in this panel. Replication measures
sampling variation under one fixed blind policy, not uncertainty about human or
opponent-aware play. The later v1 asymmetric matrix derives independent streams
per cell and retains four replications; the WARD and SUNDER cohorts then record
policy sensitivity separately.

**DERIVATION:** treating the four one-sided cohorts as 12,000 independent games
per configuration gives a worst-case unadjusted 95% sampling interval of about
±0.89 percentage points for each four-seed mean. Exact intervals require integer
win/draw/loss counts, which the tool does not retain in its rounded JSON output.
That pooled sampling interval still says nothing about policy/model error.

### 4.3 Historical asymmetric study

- **HISTORICAL:** on 2026-08-22 a separate head-to-head harness ran 3,000 games
  per cell with both seat directions averaged and a reported 0.9-point noise
  floor (`docs/SPELLS.md:242-260`).
- **HISTORICAL:** it covered the then-shipped five runes: FATE, NUDGE, WARD,
  SUNDER, and PILFER. The present sixth rune, ANVIL, is not part of the published
  five-rune summary.
- **HISTORICAL:** Classic mean win rates across that five-rune pool were SUNDER
  54.7%, PILFER 54.7%, FATE 52.0%, WARD 48.2%, and NUDGE 46.0%.
- **HISTORICAL:** the Classic mean-strength span was 7.7 points, described as
  approximately 54 Elo.
- **HISTORICAL:** under SINGLE STRIKE the mean-strength span was 17.3 points,
  and PILFER beat WARD approximately 67–33.
- **HISTORICAL:** WARD was recorded as the weakest rune in every measured mode.
- **HISTORICAL:** the document estimates a random asymmetric deal at about 3.4
  points of imbalance in Classic and 7.8–8.3 points across the current mode
  wheel (`docs/SPELLS.md:625-637`).

**Evidence gap:** the separate head-to-head harness, full cell matrix, seeds,
raw output, and derivation of the 7.8–8.3-point wheel estimate are not tracked in
the current source tree. Until recovered or rerun, only the published summary is
auditable.

**REPOSITORY RECOVERY AUDIT 2026-08-24:** `git log --all
-S'head-to-head'` finds only commit `9384959`, which added the written summary;
its simulator change only added ANVIL's curated mode configurations. All four
reachable historical `tools/spellsim.ts` blobs retain the same one-spell
versus-none/same-spell shape. Searches of reachable paths and unreachable Git
objects/trees found no asymmetric harness, matrix, CSV, or JSON output. The raw
study is not recoverable from this repository or its current object database.

**INTERNAL CONSISTENCY GAP:** the five published Classic mean percentages sum
to 255.6%, an average of 51.12%. A closed equally weighted reciprocal payoff
matrix must average exactly 50% when draws score 0.5. Independent sampling and
rounding can break that identity in a published summary; rounding alone cannot
account for a 1.12-point shift. The surviving text does not say whether the row
means use independent non-complementary samples, unequal weighting, or another
aggregation step. Without the raw matrix, their exact meaning cannot be
reconstructed.

---

## 5. Exact state spaces

This section is arithmetic, not a balance result.

### 5.1 Personal-rune modes

With 6 runes:

- **DERIVATION:** 36 opener-oriented rune assignments (`6 × 6`): the first
  rune is held by the opener and the second by the other player.
- **DERIVATION:** 21 unordered matchups: 6 mirrors plus 15 distinct pairs
  (`6 + C(6,2)`).
- **DERIVATION:** across 7 existing modes, there are 252 ordered rune/mode cells
  or 147 unordered rune-pair/mode cells.
- **DERIVATION:** those 252 cells comprise 210 asymmetric opener directions
  (`15 pairs × 2 directions × 7 modes`) and 42 mirror cells
  (`6 mirrors × 7 modes`). “A opens against B” and “B opens against A” are the
  two directions; adding another opener factor would double-count them.

If personal runes were selected independently and uniformly—only a neutral
benchmark, not a player-behaviour prediction—the total match mix would be:

- mirror runes: `1/6 = 16.67%`;
- different runes: `5/6 = 83.33%`;
- one particular directed assignment: `1/36`;
- one particular unordered distinct pair: `1/18`.

Because the equipped rune is locked before the mode is drawn, the relevant
loadout-strength summary is the weighted result across the mode wheel, not the
best rune selected independently after each mode.

For rune A against rune B under current weights:

```text
weighted(A,B) = 0.40 × Classic(A,B)
              + 0.10 × Σ each of the six added modes(A,B)
```

The frozen-v1 matrix populates this formula in §6.5. The targeted WARD/SUNDER
treatments do not yet populate a complete production-policy replacement.

### 5.2 Rune Trial

With a uniform offer of 3 distinct runes from 6:

- **DERIVATION:** there are `C(6,3) = 20` possible offers.
- **DERIVATION:** each rune appears in `C(5,2) = 10` offers, hence exactly 50%
  of uniformly drawn offers.
- **DERIVATION:** each rune pair appears together in `C(4,1) = 4` offers, hence
  20% of offers.
- **DERIVATION:** each offer has 9 ordered choice outcomes (`3 × 3`) or 6
  unordered outcomes (3 mirrors plus 3 different-rune pairs).
- **DERIVATION:** across 20 offers, that is 180 offer/ordered-choice contexts or
  120 canonical offer/choice contexts. Under the Classic baseline these reuse
  only the existing 36 directed mechanical rune matchups: each mirror matchup
  appears inside 10 offers, and each directed distinct matchup appears inside
  4 offers. Trial adds selection contexts, not new spell mechanics, unless it
  receives its own board rule.
- **DERIVATION:** uniform independent random choice from an offer yields a
  one-third mirror probability and a two-thirds different-rune probability.
- **DERIVATION:** each player's marginal selected rune remains uniform at
  `1/6`; a particular mirror occurs with probability `1/18`, and a particular
  directed different-rune matchup occurs with probability `1/45`.
- **DERIVATION:** compared with independent uniform personal runes, uniform
  Trial choice reduces exposure to different-rune matchups from `5/6` to `2/3`,
  exactly a 20% relative reduction. It does not eliminate asymmetric matchups.
- **DERIVATION:** if both players independently use the same choice distribution
  `p` over the three offered runes, conditional on that offer, the expected mirror probability is
  `p1² + p2² + p3²`. It is at least one third and becomes 100% when one rune is
  always chosen.

Equal offers remove option-set inequality. They do not guarantee a meaningful
choice. Under rational best-response play, a rune that dominates for both
roles—or, equivalently here, a unique pure equilibrium on the same rune—turns
residual balance error into repetitive mirror selection rather than unequal
access. Role-dependent values can instead make the two seats prefer different
runes.

**HYPOTHESIS scenario, not evidence:** if all offers obey one strict global
rune ranking and both players always select the strongest offered rune, the six
runes' selection shares become exactly 50%, 30%, 15%, 5%, 0%, and 0%, and every
Trial becomes a mirror. This is the combinatorial signature of a solved roster,
not a prediction that the current roster has that ordering.

#### Independent-offer repetition baselines

For two consecutive uniform independent offers:

| Runes shared by both offers | Probability |
|---:|---:|
| 0 | 5% |
| 1 | 45% |
| 2 | 45% |
| 3 — identical offer | 5% |

Other **DERIVATIONS**:

- expected distinct offers after `n` Trials: `20 × [1 - (19/20)^n]`;
- expected distinct runes seen after `n` Trials: `6 × (1 - 2^-n)`;
- probability all six runes have appeared after `n ≥ 1` Trials:
  `1 - 6(1/2)^n + 15(1/5)^n - 20(1/20)^n`;
- expected Trials until all six have appeared: `327/76 ≈ 4.303`;
- expected interval for one specified rune: 2 Trials;
- expected interval for one specified pair together: 5 Trials;
- expected interval for one exact offer: 20 Trials.

Under uniform independent offer choices, a player's selected rune repeats on
the next Trial with probability `1/6`; the exact directed selected matchup
repeats with probability `1/30`. Measured human repetition above those baselines
can come from preference or payoff concentration rather than the offer
randomizer itself.

These are baselines for detecting streak protection, a bagged offer rule, or
human-selection concentration later. They are not arguments for independent
random offers.

### 5.3 Adding Rune Trial to the wheel

The current weights already consume 100%. Adding an eighth outcome necessarily
changes at least one existing probability.

| Purely mathematical interpretation | Classic | Each existing addition | Rune Trial | Personal-rune total |
|---|---:|---:|---:|---:|
| Keep integer weights 4:1 and add Trial at weight 1 | 36.36% | 9.09% | 9.09% | 90.91% |
| Scale the existing wheel to 90%, give Trial 10% | 36% | 9% | 10% | 90% |
| Preserve all six existing additions at 10%, take Trial from Classic | 30% | 10% | 10% | 90% |
| Preserve Classic at 40%, divide the other 60% equally among seven additions | 40% | 8.57% | 8.57% | 91.43% |
| Make all eight outcomes equal | 12.5% | 12.5% | 12.5% | 87.5% |

These are not recommendations. They expose the probability decision that the
phrase “one additional mode” creates.

Appending Trial at weight 1 preserves the existing 40/10 mode distribution
**conditional on receiving a personal-rune match**: the personal modes retain
relative weights 4:1:1:1:1:1:1. Scaling the existing wheel to 90% and assigning
Trial 10% preserves the same conditional distribution.

If successive ranked wheel outcomes are independent, then at Trial probability
`q`, independent-offer baselines measured in all ranked matches become:

- one Trial every `1/q` matches;
- one specified rune offered every `2/q` matches;
- one specified pair offered together every `5/q` matches;
- one exact offer every `20/q` matches;
- all six seen after approximately `4.303/q` matches on average.

With simple weight-1 append (`q = 1/11`), those are approximately 11 matches per
Trial, 22 per specified-rune exposure, and 47.3 matches to see all six through
Trial offers.

---

## 6. Balance questions by format

No verdict is recorded yet.

### 6.1 Personal-rune modes

Raw questions:

1. What is every current rune-versus-rune win rate in every current mode after
   both opener orientations—A opens against B and B opens against A—are run?
2. What is each fixed rune's weighted strength across the actual mode wheel?
3. Is any matchup highly polarized even when both runes have similar overall
   weighted strength?
4. Does a rune's advantage change sign between modes?
5. How much of each result survives opponent-aware placement and casting?
6. Does a single robust rune dominate pre-mode loadout selection?
7. Are mirrors fun and strategically different from rune-less Classic, even
   though rune assignment is symmetric by construction?

Candidate measurements, not selected thresholds:

- per-cell win rate with uncertainty and independent seeds;
- worst matchup and 5th/95th percentile matchup;
- weighted mean and spread per equipped rune;
- seat interaction and mode interaction;
- cast rate, cast timing, unused-charge rate, and realized score swing;
- matchup polarization versus overall rune strength;
- dominated runes, Condorcet winners, best-response/population equilibrium,
  and exploitability of that population;
- results with charm-aware, opponent-rune-aware policies versus the current
  charm-blind placement anchor.

#### What an opponent-aware comparison must add

The following are **strategy inferences from the rules**, not measured best
play or win-rate directions:

- against FATE or NUDGE, treat the current visible hand face as non-final while
  a legal charge remains; for FATE under LIMITED, that additionally requires at
  least one bag die. Evaluate any extra shared draw against the remaining
  horizon and last-move position;
- against WARD, compare redirecting a valuable strike with deliberately
  consuming the mark on a lower-value hit; a SUNDER policy must value warded
  and unwarded victim columns separately, while PILFER should know it bypasses
  the mark;
- against SUNDER, price repeated exposure of one face across several columns;
  under COLUMN SHIELD, completing a vulnerable column removes it from
  SUNDER's reach;
- against PILFER, price the top die and available room in the facing receiver.
  Under COLUMN SHIELD, completing the source bars theft and completing the
  receiver bars landing. Only in modes where a full receiver remains
  destructible can a later strike reopen room for a steal;
- against ANVIL, consider removing a die from a full eligible target before the
  cast, using an ordinary strike, SUNDER, or PILFER. Under COLUMN SHIELD that
  denial must occur before the column becomes full;
- in row modes, value WARD, PILFER, and ANVIL by exact row loss, destination,
  and reindexing rather than ordinary column score; in BOUNTY, include denied
  or widened banked kills rather than board swing alone.

The asymmetric v1 harness can now assign different runes, but it cannot
implement this opponent-aware comparison merely by increasing its game count.
Its placement search still has no opponent rune, charges, live charm, BOUNTY
bank, or LIMITED horizon (§6.5). A coordinated/opponent-aware policy revision
is a different measurement instrument and must be reported as such.

To measure the competitive value of collection breadth rather than assume it,
define for an owned collection `C`:

```text
V(C | μ) = max over rune r in C of r's expected wheel score
           against opponent pick distribution μ
```

The report must state whether `μ` is uniform, empirical, or an equilibrium
distribution. The incremental `V` added by each unlock is the mechanical
inventory advantage under a rational fixed-loadout model at that fixed `μ`. If
every added rune changes variety but not `V` beyond measurement uncertainty,
the collection is horizontal under that model. If `V` rises materially with
collection size, progression is also power progression under that model;
population shifts or collection-dependent switching can change the result.

#### Precommit removes direct counters, not the population metagame

Locking a rune before matchmaking means a player cannot react to this specific
opponent or mode. It does not make rune selection strategically irrelevant.
Let `Q(i,j)` be the seat-neutral, mode-weighted score of rune `i` against rune
`j`, and let `μ(j)` be the current opponent pick distribution. Then:

```text
score(i | μ) = Σj μ(j) × Q(i,j)
```

Players can therefore best-respond to the population without counter-picking an
individual opponent. The investigation must distinguish:

- one globally dominant loadout;
- a stable mixed/population equilibrium;
- cyclic counters that remain viable because the opponent is unknown;
- runes viable only inside rare modes or against rare picks.

**FACT:** ranked stores one ladder score per player, not rune-specific ratings.
**INFERENCE:** a player who keeps one loadout may eventually have some of its
strength absorbed into their opponent level, but switching rune or unlocking a
stronger option uses the same existing score. Rating adaptation can change who
they meet; it does not make an imbalanced individual game mechanically fair.

### 6.2 Rune Trial

Because both players receive the same offer, the primary question changes from
equal access to whether the choice is solved.

Raw questions:

1. For each of the 20 offers, does one rune strictly or practically dominate?
2. Does an offer have a stable mixed choice, a rock-paper-scissors relation, or
   one obvious mirror pick?
3. What mirror rate follows from equilibrium-like or measured human choices?
4. How often is an offered rune effectively decorative?
5. How much offer-to-offer strategic variety exists under the Trial board rule?
6. Does simultaneous secrecy create an actual prediction decision, or do raw
   rune strengths overwhelm it?

Candidate measurements:

- the complete payoff submatrix for each offer;
- dominated-choice count per offer;
- equilibrium or best-response choice shares;
- expected mirror rate `Σp²` for conditionally independent identical role
  distributions, or `Σp(i)q(i)` when opener and second-player distributions
  differ;
- choice entropy and concentration;
- effective number of choices and the best-versus-second payoff gap;
- regret of choosing for familiarity or unlocking rather than match strength;
- offer repetition and rune appearance streaks under the selected randomizer.

Equal offers establish procedural option fairness. They do not by themselves
establish varied choices or balanced realized matchups.

If opener and second player independently use different choice distributions
`p` and `q`, conditional on the offer, mirror probability is `Σ p(i)q(i)`, not
`Σp²`. **FACT:** ranked assigns the opener from ladder score before play.
**INFERENCE:** Trial analysis must retain role-specific choice strategies
because equal offers do not erase opener-dependent rune value. Correlated
choices can produce a different mirror rate from the same marginals.

### 6.3 Minimum statistical record

For each of the 252 opener-oriented personal-rune configurations, retain at
least:

- mode, opener rune, other rune, policy revision, seed, and game count;
- opener wins, other-player wins, and draws; draws remain score `0.5` rather
  than being discarded;
- final scores, game length, casts by seat, unused charges, cast timing, and
  realized effect/swing diagnostics;
- ideally the event log, so the exact run can be replayed and later compared
  against a more opponent-aware policy.

At 3,000 independent games per opener-oriented configuration:

- **DERIVATION:** the full 252-cell tensor costs 756,000 games;
- worst-case standard error near a 50% result is about 0.91 percentage points;
- a single-cell unadjusted 95% interval is approximately ±1.79 points;
- averaging two independent 3,000-game opener directions for a canonical
  asymmetric pair gives an unadjusted 95% interval of approximately ±1.27
  points under the worst-case variance bound.

The historical “0.9pp noise floor” is therefore approximately a standard-error
scale, not a 95% interval. Multiple-comparison uncertainty also matters when
examining 105 distinct asymmetric matchup/mode cells. Future reporting should
show effect-size threshold curves—for example, the fraction of cells exceeding
1, 2, 3.4, 5, and 10 points—before selecting a pass/fail threshold. The current
3.4-point seating effect is a comparison anchor, not automatically the correct
rune threshold.

Worst-case normal-approximation planning near 50%, before multiple-comparison
adjustment:

| Target single-cell 95% half-width | Games per oriented cell | Games for all 252 cells |
|---:|---:|---:|
| ±2.0pp | 2,401 | 605,052 |
| ±1.5pp | 4,269 | 1,075,788 |
| ±1.0pp | 9,604 | 2,420,208 |
| ±0.5pp | 38,416 | 9,680,832 |

Four independent 3,000-game replications of the complete tensor would cost
3,024,000 games and give approximately ±0.89pp unadjusted sampling precision
per oriented cell. Adding a second policy model doubles the play count; it does
not merely add another report column.

A seat-neutral pair summary should average A-opens-B with B-opens-A, but the two
directions must also remain visible. Ranked assigns the lower-rated player the
opening seat, and LIMITED reverses the ordinary measured opener advantage; a
single averaged headline can hide a rune × rating-seat × mode interaction.

### 6.4 Branch-safe balance scope before the owner decisions

The unresolved FATE cast count and Rune Trial board rule are experimental
factors, not reasons to merge incompatible assumptions. The exact scope below
shows what can be shared and what must be measured separately.

#### FATE branch: at most one cast per turn

- **FACT:** the written rule, local CPU, and maintained simulator all permit at
  most one cast attempt before placement (§3.3–§4.1).
- **FACT:** all reproduced current FATE power, cast-rate, timing, and swing
  measurements therefore apply to this branch only.
- **FACT:** the other five runes each have one lifetime charge. Matchups in
  which neither seat holds FATE are invariant to the cast-count decision.
- **INFERENCE:** the turn grammar is zero or one cast followed by placement,
  except that a legal cast such as PILFER may itself end the game:

  ```text
  turn := placement | cast → placement | terminal cast
  ```

- **INFERENCE:** authority must reject a second cast before the next placement,
  using either ordered history or an explicit projected per-turn cast marker.

#### FATE branch: same-turn casts while legal charges remain

- **FACT:** the normal human state flow and browser coverage permit two
  consecutive FATE casts before placement (§3.3).
- **FACT:** the individual FATE effect, two-charge limit, injected draw seam,
  and LIMITED bag consumption remain the same. The maintained FATE simulator
  result and current local CPU policy do not measure this larger action set.
- **FACT:** non-FATE-versus-non-FATE measurements remain mechanically
  invariant. The surviving direct PILFER–WARD historical result is therefore
  also cast-branch-independent.
- **HISTORICAL LIMIT:** even a historical non-FATE *aggregate row mean* cannot
  be transferred intact, because its opponent average included FATE and the
  lost harness's cast grammar is unknown.
- **DERIVATION:** in a FATE-versus-non-FATE cell, holding the opponent's action
  set fixed, adding the option of a second FATE cast cannot reduce the holder's
  best achievable value because the holder may decline it. This unilateral
  action-set bound does not determine FATE/FATE, where both action sets expand.
  A fixed heuristic or human population can also use the option badly, so the
  realized direction and magnitude remain unmeasured.
- **INFERENCE:** the turn grammar becomes:

  ```text
  turn := cast* → placement | terminal cast
  ```

  For the present roster `cast*` is bounded by two and only FATE reaches two.
  A useful event record must preserve the original hand die, every discard and
  deterministic redraw, and the final placed die. Placement closes the casting
  window; no separate “done casting” command is intrinsically required.

#### Exact cast-branch experiment size

The cast rule is a treatment factor; it does not create new rune pairings.
Only cells containing FATE can differ:

- **DERIVATION:** each mode has `36 - 5² = 11` FATE-containing directed cells:
  FATE/FATE plus FATE against each of five opponents in both opener directions;
- **DERIVATION:** seven modes therefore contain 77 branch-sensitive cells and
  175 invariant non-FATE cells;
- **DERIVATION:** a naive two-rule factorial is `2 × 252 = 504`
  configurations, or 1,512,000 games at 3,000 per configuration;
- **DERIVATION:** an exact reduced factorial measures 175 invariant cells once
  and 77 sensitive cells under both rules: `175 + 2 × 77 = 329`
  configurations, or 987,000 games at 3,000 each;
- **DERIVATION:** the second cast branch therefore adds 77 configurations or
  231,000 games to one complete seven-mode tensor, not another 756,000;
- **DERIVATION:** four independent 3,000-game replications of that reduced
  design cost 3,948,000 games.

For the small maintained one-sided/symmetric diagnostic, only two configured
rows are FATE rows. Repeating those two rows under chaining adds 6,000
one-sided plus 6,000 symmetric games. That 12,000-game comparison can measure
branch sensitivity under the current heuristic; it still cannot substitute for
the asymmetric tensor.

#### Rune Trial branch: Classic-backed selection format

- **DERIVATION:** after simultaneous reveal, play resolves to one of the
  existing 36 directed Classic rune matchups. Once those Classic cells have
  been measured for personal runes, Trial adds zero new *mechanical payoff*
  configurations under the assumption that only mode and chosen runes affect
  post-selection play.
- **DERIVATION:** Trial still has 20 offers and 180 opener-oriented
  offer/choice contexts. Those require strategic analysis and eventually human
  choice evidence; a 36-cell payoff matrix alone does not predict choice.
- **DERIVATION:** 10 of 20 offers contain FATE. Comparing both cast rules adds
  90 offer/rule contexts (`10 × 9`) to the 180-context baseline. Fifty of those
  90 ordered choice outcomes mechanically contain FATE (`10 × [9 - 2²]`), but
  all 90 can change strategically because FATE remains an alternative.
- **DERIVATION:** no Trial-specific gameplay simulation is needed beyond the
  11 alternate-rule FATE cells already present in the Classic matrix.

#### Rune Trial branch: genuinely new mechanical board mode

- **DECISION NEEDED:** scoring, destruction, supply, legal-rune, and terminal
  rules must be defined before this branch has measurable gameplay semantics.
  Calling Classic mechanics `modifier=trial` would be a storage alias, not a
  new mechanical mode.
- **DERIVATION:** if all six runes remain legal, the new rule needs its own
  `6 × 6 = 36` directed payoff cells. Seven personal modes plus mechanical
  Trial produce 288 cells, or 864,000 games at 3,000 per cell.
- **DERIVATION:** if both FATE cast rules are retained as treatments, the exact
  reduced eight-mode design is `25 × 8 + 2 × 11 × 8 = 376`
  configurations, or 1,128,000 games. The new mode adds 47 configurations—36
  baseline plus 11 alternate FATE cells—to the 329-cell seven-mode design.
- **UNKNOWN:** before the board rule exists, no payoff, first-mover effect,
  draw rate, duration, cast timing, unused-charge rate, rune legality,
  equilibrium, payoff-derived mirror rate, or Classic-to-Trial transfer can be
  inferred. The structural one-third mirror baseline for uniform independent
  choice remains valid regardless of the board rule.
  A supply-changing rule would also require an explicit redesign of FATE's draw
  interaction.

| Trial mechanics included in payoff study | One cast-rule branch | Both cast rules, exact reduced design | Games at 3,000/configuration |
|---|---:|---:|---:|
| Classic-backed Trial; seven mechanical modes | 252 | 329 | 987,000 |
| New mechanical Trial; eight mechanical modes | 288 | 376 | 1,128,000 |

These counts describe simulation coverage, not evidence that either Trial
branch is fun, comprehensible, or balanced.

### 6.5 Reproduced asymmetric v1 baseline

This section records the first complete rune-versus-rune measurement. It is a
baseline for the current shipped machine policy, not an estimate of optimal or
human play.

#### Preserved experiment

- **REPRODUCED:** seven mode-sharded raw reports contain 1,316 unique seeded
  cell records and 3,948,000 games. Every record contains 3,000 games.
- **REPRODUCED:** the one-cast branch contains 3,024,000 games. The additional
  FATE-sensitive chain treatment contains 924,000 games.
- **REPRODUCED:** pooling four independent seeds gives 12,000 games for every
  effective opener-oriented cell. Both analyzed branches contain all 252
  effective mode/rune/rune cells; the chain branch inherits the 175 cells in
  which neither rune is FATE.
- **REPRODUCED:** all 56 embedded runtime hashes—eight source files in each of
  seven reports—match the measured source revision. The finalized simulator
  hash is `a875c056c6f98071b679f184e0672e80438965148ae2bd76796b1acf42e90acf`.
- **REPRODUCED:** independent validation reconciled W/D/L, doubled outcome
  numerators, terminal totals, draw counts, actions, margins, charges, cast
  histograms, BOUNTY accounting, and internal seat alternation for every cell.
- **REPRODUCED:** rebuilding the derivative analysis from the seven raw reports
  produces exact JSON equality.

Artifacts:

- `docs/evidence/rune-matchups/v1/raw-<mode>.json` — seven raw reports;
- `docs/evidence/rune-matchups/v1/analysis.json` — validated pooled analysis;
- `tools/rune-matchups.ts` — deterministic v1 simulator;
- `tools/rune-matchup-analysis.ts` — deterministic analyzer;
- `tests/rune-matchups.test.ts` and
  `tests/rune-matchup-analysis.test.ts` — focused contracts.

The raw reports embed the runtime hashes they require. The derivative analysis
does not embed the seven raw-file hashes, so it must remain beside its raw
inputs and evidence manifest rather than be treated as self-authenticating.

#### Exact policy boundary

The measured player is the offline Normal anchor: depth-2 placement search,
risk weight 0.9, opponent weight 1, and `machineCast` at demand 16. The
following are explicit **FACTS ABOUT THE INSTRUMENT**:

- placement search does not know either player's rune or charges;
- placement search does not receive live WARD/SUNDER charm state;
- placement search does not value the BOUNTY bank or LIMITED horizon;
- cast policy is not opponent-rune-aware;
- mode rules themselves are applied exactly;
- within every oriented cell, the opener alternates between core identities
  `AI` and `ME`, so internal implementation seat cannot become rune role;
- independent simulation noise is not human-strategy, policy-model, or
  multiple-comparison uncertainty.

The unadjusted fixed-policy Monte Carlo 95% half-width of one 12,000-game
oriented cell is approximately 0.89 percentage points near 50%. Derived
strength intervals can be narrower because they average many independent
cells, but policy error does not shrink with game count.

#### Personal-rune results

The table is seat-neutral, weighted by the current `4:1:1:1:1:1:1` mode wheel,
and averaged against a uniform opponent-rune population. Draws score 0.5.

| Rune | At most one cast/turn | Same-turn FATE chaining |
|---|---:|---:|
| PILFER | 54.84% | 54.76% |
| FATE | 51.17% | 51.14% |
| ANVIL | 50.74% | 50.80% |
| SUNDER | 49.95% | 49.90% |
| NUDGE | 48.15% | 48.20% |
| WARD | 45.16% | 45.19% |
| strongest–weakest spread | 9.68pp | 9.57pp |

**REPRODUCED POINT ESTIMATE:** PILFER strictly dominates each other fixed
loadout in the wheel-weighted seat-neutral matrix under both cast branches.
The smallest pure dominance margin is 2.85pp under one-cast and 2.08pp under
chain. PILFER/PILFER is the sole pure saddle of both point-estimate precommit
games. This is a model-conditional balance result, not proof about human play.

**PROGRESSION INFERENCE:** under this baseline, rune ownership is not merely
cosmetic or horizontal. A player who owns PILFER has a fixed pre-match option
that a player without it cannot reproduce. Win-gated acquisition would
therefore couple present success to future mechanical option value unless a
starter set, loan system, or corrected balance model removes that gap.

Mode-specific one-cast strength against a uniform rune population:

| Rune | Classic | Row Switch | Row Multiply | Column Shield | Single Strike | Bounty | Limited |
|---|---:|---:|---:|---:|---:|---:|---:|
| ANVIL | 50.57% | 49.01% | 51.40% | 54.39% | 50.53% | 50.35% | 49.44% |
| FATE | 50.29% | 52.76% | 49.60% | 53.60% | 51.64% | 50.44% | 52.46% |
| NUDGE | 46.93% | 49.06% | 48.05% | 52.52% | 48.67% | 47.42% | 48.05% |
| PILFER | 52.96% | 59.42% | 56.10% | 55.65% | 59.24% | 51.31% | 54.86% |
| SUNDER | 52.12% | 47.87% | 50.04% | 43.21% | 47.59% | 52.53% | 49.72% |
| WARD | 47.13% | 41.87% | 44.82% | 40.63% | 42.33% | 47.94% | 45.47% |

Additional point-estimate facts:

- PILFER–WARD is the largest wheel-average split: PILFER scores 60.98%.
- Under SINGLE STRIKE, PILFER scores 67.64% against WARD. This independently
  reproduces the surviving historical “roughly 67–33” result under the current
  roster and instrument.
- Seven of 15 distinct rune pairs reverse their advantage sign across modes.
- NUDGE–SUNDER has the largest range: NUDGE moves from 44.01% in Classic to
  59.71% under COLUMN SHIELD, a 15.69pp swing.
- PILFER–SUNDER moves from 49.19% in BOUNTY to 62.35% in SINGLE STRIKE.
- ANVIL scores only 38.42% against PILFER in ROW SWITCH.
- Uniform-rune opener score is 50.84% in Classic, 52.87% in COLUMN SHIELD,
  and 46.10% in LIMITED. Seat averaging must not erase these mode interactions.

Under a hypothetical uniform rune population, the mode-averaged absolute
simulated edge is 3.65pp including mirrors and 4.38pp conditional on different
runes. Those are policy-model outcomes, not player telemetry.

#### FATE cast-grammar sensitivity

- Rune ordering, the PILFER pure saddle, and strict-dominance conclusion are
  unchanged between the two measured cast grammars.
- Every rune's wheel strength changes by less than 0.08pp.
- FATE consumes an additional 0.008–0.120 charges per player/game under
  chaining, depending on mode; COLUMN SHIELD changes most.
- In comparable FATE-containing LIMITED cells, supply-exhausting terminals
  move from 71.37% to 71.88%, a +0.51pp point estimate.
- Across 77 opener-oriented FATE-sensitive cells, the largest branch
  difference is 2.27pp and only one exceeds 2pp. The branches use independent
  treatment streams, so isolated deltas also include Monte Carlo variation.

**INFERENCE:** global balance does not select the FATE grammar. The action
protocol and human expectation still must select it, while the larger
cell-level differences justify retaining both raw branches until that decision.

#### Frozen-v1 Classic-backed Rune Trial results

Every offer reuses the same 36 Classic cells; the 20 offers are not 20
independent experiments.

Point-estimate game theory under both cast branches:

- all 20 offers have exactly one pure saddle;
- 16 saddles are mirrors;
- the four off-diagonal saddles are precisely the offers containing both
  PILFER and SUNDER; the opener selects SUNDER and the reply selects PILFER;
- every offer contains at least one strictly dominated choice for each role;
- NUDGE and WARD occupy no pure saddle;
- saddle identities are identical under both FATE grammars.

If each offer is resolved by its unique point-estimate pure saddle, uniform
offers produce this **selection convention**, not a human forecast:

| Metric | One cast | FATE chain |
|---|---:|---:|
| Mean opener payoff | 50.685% | 50.742% |
| Mirror-offer rate | 80% | 80% |
| Opener shares | A 15%, F 5%, P 30%, S 50% | same |
| Reply shares | A 15%, F 5%, P 50%, S 30% | same |

This is a strong solved-choice warning, but not yet a robust equilibrium claim:

- the four off-diagonal SUNDER/PILFER saddle deviation margins are only
  0.079pp;
- six one-cast and four chain saddles have minimum deviation margin below
  0.5pp;
- a typical Classic oriented cell's unadjusted 95% half-width is about 0.89pp;
- no bootstrap classification frequency, equilibrium-polytope range, or human
  choice model exists;
- simultaneous equal offers provide equal access, but the current policy makes
  many offered choices false options rather than meaningful variety.

**COORDINATED-SUNDER UPDATE:** the direct treatment overlay in §6.5 removes
the four off-diagonal pure saddles. Sixteen offers retain one mirror saddle;
the four offers containing both PILFER and SUNDER have no pure saddle at the
pooled point estimate. All 20 still contain a strictly dominated choice for
each role. The deterministic 50%/30% SUNDER/PILFER selection shares above are
therefore a frozen-v1 diagnostic, not a current forecast.

#### Operational facts relevant to multiplayer replay

- One-cast LIMITED exhausts supply in 259,918 of 432,000 games: 60.17%.
- PILFER ends games during the cast itself in 1.11%–7.81% of games containing
  PILFER, depending on mode; COLUMN SHIELD is highest.
- LIMITED separately records 682 games in which PILFER filled a board after
  the turn draw had also emptied supply. An online terminal record must preserve
  both facts.
- FATE uses almost both charges under this policy: one-cast unused-charge rates
  range from about 1% in ROW MULTIPLY to 26% for the reply in COLUMN SHIELD.
- WARD immediate swing is recorded as zero because its effect is delayed; zero
  in that diagnostic is not zero gameplay value.

#### Coordinated-policy defects discovered after v1

##### WARD: cast, then permanently shield the same column

The user's play observation exposed a material policy error after the baseline
was frozen.

- **REPRODUCED:** under COLUMN SHIELD, with AI board `[[6,6],[],[]]`, held die
  6, and an empty opponent board, both Normal and Hard cast WARD on column 0;
  depth 2, 4, and 5 placement search then places the 6 there. The completed
  column becomes permanently mode-shielded, so the spent WARD is redundant.
- **REPRODUCED:** in 5,000 seeded Normal-anchor WARD/WARD COLUMN SHIELD games,
  3,252 casts occurred; every cast targeted a two-die column and 3,033—93.3%
  of casts—were made redundant by immediately filling it.
- **FACT:** the raw v1 aggregate cannot recover this count. It records casts,
  targets only transiently, and delayed immediate swing as zero, but does not
  retain WARD triggers, final charm state, or “became shielded” events.
- **FACT:** the cause is sequential policy blindness: `machineCast` selects
  WARD before independent `searchRoot`; casting does not know placement intent,
  and placement search does not know charm state. More search depth cannot add
  omitted state.
- **FACT — current working tree:** WARD now declares the hazardous follow-up in
  its registry entry. Easy remains uncoordinated; Normal previews and vetoes
  the cast but independently chooses again; Hard reuses the safe preview. The
  turn flow contains no WARD-id branch (`src/core/spell-types.ts`,
  `src/core/spell-policy.ts`, `src/core/spells.ts`, `src/flow/spell-ai.ts`,
  `tests/spell-ai.test.ts`).
- **REPRODUCED TREATMENT:** a separate 156,000-game COLUMN SHIELD cohort covers
  all 11 directed one-cast cells containing WARD plus both directed FATE/WARD
  chain cells, with four seeds and 3,000 games per record. It validates and
  pairs against all 52 corresponding frozen-v1 records
  (`docs/evidence/rune-matchups/ward-coordination-v1/`).
- **REPRODUCED:** across 144,000 one-cast WARD role-game exposures (132,000
  actual games; WARD/WARD contributes two exposures), frozen v1 cast 41,976
  times. Coordinated Normal made 44,337 candidate-cast hazard previews, vetoed 41,688
  (94.03%), and cast 2,649 times. Preview and final placement diverged 15 times;
  only 5 successful casts (0.189%) were made immediately redundant. Hard's
  exact preview reuse makes this immediate recurrence impossible by
  construction.
- **REPRODUCED:** the correction did not rescue WARD in COLUMN SHIELD. Its
  one-cast score against a uniform rune population moved from 40.6274% to
  40.6038% (-0.0236pp), and no distinct matchup moved by more than 0.0605pp.
  A descriptive paired-seed t interval from four replications is approximately
  [-0.0529,+0.0057]pp, so the uniform result does not establish a negative
  effect. WARD/FATE's -0.0604pp cell is negative in all four paired seeds and
  merits confirmation, but it is a post-hoc unadjusted result with no
  multiplicity correction. The direct measured conclusion is that the 39,327
  fewer casts become exactly 39,327 additional unused charges.
- **LIMIT:** only immediate completion is counted. Later completion of the
  warded column, actual WARD triggers, and final live charm state remain
  unmeasured. This treatment is production Normal, not optimal human play.

##### SUNDER: cast for a wide move, then choose as if it were narrow

- **REPRODUCED:** in Classic with AI board `[[],[6],[]]`, opponent board
  `[[6,6],[],[]]`, and held die 6, SUNDER's cast heuristic measures a best
  narrow gain of 30 and best wide gain of 42. The 12-point delta exactly clears
  Normal's threshold and exceeds Hard's, so both cast.
- **REPRODUCED:** charm-blind depth-2, depth-4, and depth-5 placement all choose
  column 0 for its facing kill. That move has the same resulting boards and
  charm with or without SUNDER—the charge adds exactly zero. A SUNDER-aware
  root search instead chooses column 1, builds the own pair, still destroys the
  two opposing 6s globally, and realizes the 42-point gain. More blind depth
  therefore does not repair the missing state.
- **FACT:** SUNDER's global victim set depends on the die face, not the chosen
  placement column. The placement still matters for own building and for the
  ordinary no-SUNDER counterfactual. Its current cast heuristic compares the
  best wide and best narrow placements, while the later search chooses a plain
  placement independently (`src/core/spells.ts`, `src/core/rules.ts`,
  `src/core/ai.ts`).
- **FACT — frozen v1 / pre-correction:** the cast heuristic started the wide
  comparison from a fresh charm and therefore dropped a standing opponent
  WARD. In the exact state above, the fresh comparison is 42 versus 30; with a
  live WARD both plans are 18, so the correct marginal value is zero.
- **REPRODUCED BASELINE:** despite this defect, SUNDER is already the strongest
  BOUNTY loadout against a uniform rune population at 52.534%, versus PILFER at
  51.313%. It cast in 66,991 of 144,000 one-cast SUNDER-role BOUNTY games
  (46.52%). Correct coordination is therefore a potential BOUNTY balance change,
  not merely an AI-polish change.
- **FACT — current working tree:** `searchRoot` accepts an exact cloned charm
  for the root move; SUNDER's registry hook arms that clone while preserving
  live WARDs. Hard reuses the exact coordinated placement, Normal reuses it
  except for a named 5% slip, and Easy remains blind. No flow branch names
  SUNDER (`src/core/ai.ts`, `src/core/spell-types.ts`, `src/core/spells.ts`,
  `src/flow/spell-ai.ts`, `tests/spell-ai.test.ts`).
- **REPRODUCED CONTRACT:** a three-column BOUNTY state containing one 5 in each
  opponent column has board-only plain/wide gains of 10/20, but correct
  bounty-aware gains of 11/23. The 10-point board marginal makes Normal hold in
  Classic; the true 12-point BOUNTY marginal makes it cast. SUNDER alone opts
  into this off-board `+1` per kill, so FATE/NUDGE tuning is not silently
  changed.
- **REPRODUCED TREATMENT:** a separate 336,000-game paired cohort covers all
  11 directed one-cast SUNDER cells in Classic, all 11 in BOUNTY, both directed
  SUNDER/WARD cells in COLUMN SHIELD, and the four applicable FATE-chain cells.
  It validates all 112 frozen-v1 source records and preserves the baseline as a
  separate artifact (`docs/evidence/rune-matchups/sunder-coordination-v1/`).
- **REPRODUCED:** one-cast coordinated SUNDER moved from 52.1222% to 52.3010%
  against a uniform Classic rune population (+0.1788pp) and from 52.5344% to
  52.7847% in BOUNTY (+0.2503pp). Both deltas are positive in all four paired
  replications; descriptive four-seed t intervals are [+0.0325,+0.3252]pp and
  [+0.1568,+0.3439]pp. These narrow intervals describe this fixed policy only.
- **REPRODUCED:** SUNDER/WARD in COLUMN SHIELD moved +0.0146pp, with a
  descriptive interval of [-0.0534,+0.0825]pp. The treatment finds no material
  WARD-specific balance movement there.
- **REPRODUCED:** treatment SUNDER cast 67,316 times in 144,000 Classic role
  exposures and 68,924 times in 144,000 BOUNTY exposures. The coordinated and
  blind root columns differed on 14.31% and 14.57% of those casts. The named 5%
  slip occurred 4.96% and 4.94% of the time, but actually changed the final
  column on only 0.707% and 0.727% of casts because both searches usually
  agreed. That is about 0.33%-0.35% of SUNDER role-games.
- **REPRODUCED:** almost every coordinated use produced additional
  destruction: only 35 of 67,316 Classic casts and 45 of 68,924 BOUNTY casts
  were zero-kill/zero-marginal. BOUNTY recorded 157,591 attributable extra
  kills and exactly 157,591 attributable banked points. Planned and actual live
  WARD absorption also match exactly, showing the fresh-charm error is absent.
- **DERIVATION — Classic Trial overlay:** replacing only the 11 frozen Classic
  SUNDER cells with the treatment values leaves 16 of 20 offers with one pure
  saddle, all mirrors. The four offers containing both PILFER and SUNDER now
  have no pure saddle at the pooled point estimate; every offer still contains
  a strictly dominated choice for both roles. The earlier four off-diagonal
  saddles depended on a 0.0792pp deviation margin and do not survive this small
  policy correction. Removing the dominated third choice gives those four the
  same pooled 2x2 diagnostic: opener 7.79% PILFER / 92.21% SUNDER, reply 73.81%
  PILFER / 26.19% SUNDER, value 51.0440% to the opener. Those exact shares are
  uncertainty-sensitive, not a human-choice forecast.
- **DERIVATION — partial wheel only:** substituting measured Classic and
  BOUNTY cells while freezing unmeasured modes moves SUNDER from 49.9459% to
  approximately 50.0425%; PILFER remains approximately 54.8226% and scores
  approximately 55.0198% head-to-head against SUNDER. This mixed-policy
  diagnostic cannot replace a complete coordinated seven-mode rerun, but the
  measured correction is nowhere near the broad PILFER gap.

ANVIL, PILFER, FATE, and NUDGE mutate board or hand before placement, so their
updated state is visible and they do not lose same-turn state in this way.

**CURRENT BOUND:** the 3,948,000-game tensor remains valid evidence for the
named blind Normal policy and for discovering robust problem signals such as
PILFER dominance. The WARD treatment shows its immediate coordination defect
can be removed without materially moving COLUMN SHIELD balance. The SUNDER
treatment detects a small strength increase, strongest in BOUNTY, and overturns
the fragile four-offer Trial saddle classification. Only Classic and BOUNTY
have complete coordinated SUNDER rows and columns; the targeted COLUMN SHIELD
cell and untouched four modes cannot recompute a production-policy seven-mode
wheel. Both treatments remain separate, hashed sensitivities rather than
overwriting v1.

---

## 7. Multiplayer authority and replay feasibility

### 7.1 Current authority boundary — raw facts

- **FACT:** the browser uses the public Supabase key. Authenticated Edge
  Functions, grants, and RLS are the authority boundary; only the functions use
  the service role (`docs/architecture/backend.md:8-19`,
  `supabase/functions/_shared/http.ts:52-73`).
- **FACT:** the placement client submits match id, column intent, idempotency
  id, and expected move count. It does not submit an accepted die, score,
  rating, or resulting state (`src/online/match-api.ts:93-116`,
  `supabase/functions/README.md:28-33`).
- **FACT:** `pvp-move` verifies participant, active match, turn, authoritative
  seed replay, projection version, and legal column before persistence
  (`supabase/functions/pvp-move/operation.ts:75-130`).
- **FACT:** PostgreSQL locks the match, checks the expected projection, appends
  placements, advances the projection, and can settle atomically. The command
  response is retained for exact idempotent replay
  (`supabase/migrations/20260823132135_atomic_match_commands.sql:212-317`).
- **FACT:** the command RPCs are service-role-only; an authenticated client
  cannot invoke them directly (same migration, `:317-325`).

Existing visibility boundaries also fit the proposed reveal timing:

- **FACT:** a participant can read a match and its moves; a stranger cannot.
  Queue rows are owner-visible only. Match seeds are service-only
  (`supabase/migrations/0003_pvp_pivot_v2.sql:59-84`,
  `supabase/migrations/0005_pvp_seed_secrecy.sql:1-14`,
  `supabase/tests/database/rls-boundaries.test.sql`).
- **INFERENCE:** a personal rune can therefore stay private while queued and
  become visible after pairing by copying an immutable snapshot onto the
  participant-visible match. This uses the existing trust boundary; it does not
  require hiding information from the server.

### 7.2 Current data and rule seams — raw facts

- **FACT:** `matches` has participants, status, turn, result, clock, shared
  mode, and public next die. It has no match-format, offer, or per-seat rune
  fields (`supabase/migrations/0003_pvp_pivot_v2.sql:42-55`,
  `supabase/migrations/0009_match_modifier_wheel.sql:1-7`).
- **FACT:** `matchmaking_queue` stores only `player_id` and `created_at`; it
  cannot currently lock an equipped rune
  (`supabase/migrations/0003_pvp_pivot_v2.sql:79-84`).
- **FACT:** `match_moves` stores ordered placements—player, column, and die—but
  no cast or selection event (`supabase/migrations/0003_pvp_pivot_v2.sql:64-70`,
  `supabase/migrations/0008_pvp_move_die.sql:1-6`).
- **FACT:** the owner-only `player_settings` row contains presentation settings,
  not rune equipment or ownership
  (`supabase/migrations/20260823192604_player_settings.sql`).
- **FACT:** there is no inventory/unlock table. Match settlement currently
  writes the result, both season rows, and profile rating mirrors, not item
  grants (`supabase/migrations/20260823112009_atomic_match_settlement.sql:98-162`).
- **FACT:** ranked explicitly calls `clearSpells()` and reconstructs an empty
  hand. No current repository Edge-function closure imports `core/spells.ts`
  (`src/online/play.ts:59-68`, `src/flow/spells.ts:114-122`,
  `tests/fnsync.test.ts:129-145`).

The rule implementation is reusable, but its current orchestration is not:

- **FACT:** `CastCtx` already expresses mode, current die, an injectable draw,
  remaining finite supply, and persistent charm. Offline supplies
  `Math.random`; an authoritative caller can instead supply a deterministic
  stream. The spell registry is pure (`src/core/spell-types.ts:3-15`,
  `src/core/spells.ts:1-15`, `src/flow/spells.ts:71-89`).
- **FACT:** core placement already accepts WARD/SUNDER charm state, and visible
  placement has a charm seam (`src/core/rules.ts:157-207`,
  `src/ui/game/move-view.ts:46-56`).
- **FACT:** spell animation wraps one mutation callback
  (`src/flow/spell-effects.ts`, `src/flow/spell-effects/types.ts`).
- **INFERENCE:** that presentation seam can potentially wrap a future accepted
  server action, but no online integration currently proves it end to end.
- **FACT:** the current browser spell controller itself spends charges and
  mutates state locally. It is not an online command client
  (`src/flow/spells.ts:236-296`).
- **FACT:** no current rune asks for an opponent interrupt. Latency therefore
  need not decide a reaction race (`docs/SPELLS.md:64-69`).

### 7.3 The placement-log invariant does not represent casts

The current database command is narrower than the future-looking prose in
`docs/SPELLS.md:619-623`:

- **FACT:** one command accepts a JSON array of one or two entries. Every entry
  must contain placement index, alternating player, legal column, and die; the
  first die must equal the match's public `next_die`
  (`supabase/migrations/20260823132135_atomic_match_commands.sql:202-270`). The
  second entry exists for an inline bot reply, not for a second same-turn action.
- **FACT:** core ranked replay treats every log row as one placement, consumes
  one supply die per row, and alternates the turn after every row. Its replay
  state has boards, turn, next die, move count, and bounty, but no charges,
  charm, transformed hand, or selection phase (`src/core/match.ts:12-47`).

Current runes break different parts of that invariant:

- FATE consumes an extra deterministic supply draw without placing.
- NUDGE changes the public die that must later be placed.
- WARD and SUNDER create state that persists until a later placement resolves
  it.
- PILFER and ANVIL mutate a board without ending the turn.
- PILFER can fill the caster's board and end the match before the promised
  placement (`tests/browser/spells/scenarios/casting.mjs:155-180`).
- The unresolved one-versus-multiple-casts-per-turn rule changes how many
  same-turn events must be legal (§3.3).

**INFERENCE — shared prerequisite for both proposed formats:** casts and
placements need one authoritative total order, one monotonically advancing
action version, deterministic replay, and idempotent command semantics. A
separate cast table without a database-enforced global order would leave
cast-versus-placement replay and retries ambiguous. Whether the storage is one
table or an equivalent ordered representation is an implementation decision;
the total order is the required property.

**INFERENCE:** the client should continue to submit intent only: rune id and
semantic target for a cast, or column for a placement. The Edge boundary must
rebuild and validate rune assignment, charge, turn/phase, target legality,
supply, and charm; the database must append the accepted action and projection
atomically. The client must not claim its remaining charge, FATE draw, board
mutation, or terminal score.

#### Cast-count branch effects on the protocol

**INFERENCE — shared under either rule:** replace placement count as the sole
ordered cursor; replay hand die, supply cursor, charges, charm, turn, and
terminal state; make cast commands intent-only and idempotent; and use the same
cast-aware reconstruction for Realtime, reconnect, final redraw, claim, bot
openers/replies, and settlement. FATE and PILFER already make this work
necessary even if only one cast is allowed per turn.

| Concern | At most one cast per turn | Cast repeatedly while legal charges remain |
|---|---|---|
| Authoritative grammar | `cast? → placement`, with a cast-terminal exception; reject a second pre-placement cast | `cast* → placement`, with a cast-terminal exception; commit every cast independently because each FATE redraw informs the next decision |
| Projection | Derive or durably project `cast_used_this_turn` / place-only phase | Preserve every intermediate hand and charge state; an expected action version rejects stale or concurrent actions, while reuse of one idempotency key returns the committed response without drawing or spending twice |
| Clock rule still needed | Decide whether the single cast refreshes the deadline at all | Decide whether each cast refreshes; if every cast refreshes, two FATE casts can extend one turn twice. A fixed turn deadline avoids that extension |
| Bot requirement | Optional cast plus placement; bounded at two accepted actions per bot turn | A terminating cast/re-evaluate loop followed by placement; bot openers/replies become variable-length action sequences |
| Existing policy evidence | Local CPU and simulator already have the one-attempt shape | Current local CPU and simulator do not exercise the branch |
| Client/versioning | Disable FATE's remaining charge until the next turn; snapshot an immutable cast-rule version | Support intermediate same-turn cast states and declare that capability; snapshot the same immutable rule version |

Placement itself can close the cast window in either branch. A separate
“finish casting” action is unnecessary unless a later UX or clock rule requires
it. An inline transaction that includes a preceding human placement plus a bot
cast and bot placement may already need three ordered actions; the current
command accepts at most two placement entries. Timeout policy must also decide
whether autoplay immediately places the latest transformed die and waives
unused casts, or may itself cast before placement.

### 7.4 Synchronization, clocks, bots, settlement, and rollout

- **FACT:** Realtime currently observes only `match_moves` inserts and
  `matches` updates (`src/online/match-api.ts:165-177`).
- **FACT:** the healing/reconnect path uses number of placement rows as its
  applied version and rebuilds via plain `applyMove` without charm. The final
  result redraw repeats the same placement-only reconstruction
  (`src/online/play.ts:229-270`, `src/online/play-finish.ts:27-70`).
- **FACT:** `pvp-join` infers “rejoined” from whether the caller already owns a
  placement row. A player who selected a Trial rune or cast without placing is
  not representable by that heuristic
  (`supabase/functions/pvp-join/operation.ts:50-60`).
- **FACT:** the visible turn clock auto-places after 10 seconds; the server
  accepts auto-play after 12 seconds; a stalled human may be claimed after 30
  seconds. `last_move_at` and checked projection count are advanced by
  placements (`src/online/play.ts:135-155`, `:273-299`,
  `supabase/functions/pvp-move/operation.ts:19-33`,
  `supabase/functions/pvp-claim/operation.ts:9-55`,
  `supabase/migrations/20260823132135_atomic_match_commands.sql:23-65,236-280`).
- **FACT:** the current pregame “ready” signal is an ephemeral Realtime
  broadcast, not a durable match phase (`src/online/match-api.ts:150-162`). A
  Trial choice cannot rely on it for reconnect or secrecy.
- **FACT:** online bots are placement-only. A lower-rated bot can make the
  opening placement inside match creation before either client enters, and bot
  replies can be committed in the human placement request
  (`supabase/functions/pvp-join/operation.ts:137-160`,
  `supabase/functions/pvp-move/operation.ts:117-145`, `src/core/bot.ts`). A pure
  `machineCast` policy exists, but online functions do not call it.
- **FACT:** normal completion, resignation/stall settlement, and abandoned
  human-versus-bot cleanup currently derive a placement-only match. Because
  PILFER can be terminal, those replaying terminal paths must understand the
  same cast-aware state as the ordinary action path
  (`supabase/functions/pvp-claim/operation.ts`,
  `supabase/functions/pvp-join/operation.ts:63-98`).
- **FACT:** account deletion is different: it freezes active matches and settles
  from stored scores, defaulting null scores to zero; it does not rebuild the
  placement log (`supabase/functions/_shared/account-deletion.ts:17-36`).
  **INFERENCE:** rune selection/cast-terminal introduction therefore requires an
  explicit deletion-phase and authoritative-score policy, not necessarily replay
  inside deletion itself.
- **FACT:** history returns mode, scores, rating delta, and result, but not
  format, offer, or rune snapshots
  (`supabase/migrations/20260823132602_history_index_order.sql:17-50`). Account
  deletion cascades match history. Any longer-lived anonymized matchup
  aggregate therefore needs an explicit retention/privacy decision rather than
  silently relying on raw matches.
- **FACT:** join input carries no client capability or protocol version. The
  project previously deployed mode-aware server rules before the compatible
  client, causing old clients to render modified matches as Classic
  (`supabase/functions/_shared/types.ts:43-50`, `docs/MODES.md:87-93`). Cached
  clients that cannot replay casts must not be matched into rune games.

**INFERENCE:** a cast that retains the turn and a Trial selection wait require
an action/phase version and clock boundary distinct from placement count.
Reconnect, watchdog, bot, and terminal paths must consume that same version.

### 7.5 Format A — personal-rune feasibility

Once the shared action protocol exists, personal equipment adds a comparatively
small match-setup contract:

1. **INFERENCE:** validate and snapshot the equipped rune when the player
   enters the queue, because “locked before matchmaking” is incompatible with a
   later mutable settings lookup.
2. **INFERENCE:** copy immutable `p1_rune` and `p2_rune` assignments onto the
   match and reveal both through the existing participant-only response.
3. **FACT/INFERENCE:** initialize the already-independent per-seat charge
   records from those assignments instead of the current same-rune dealer.
4. **INFERENCE:** keep matching itself rune-agnostic unless balance evidence
   forces a different policy; rune-bucket matchmaking would fragment the
   existing queue and change the proposal from “bring your identity” to a
   hidden matchup-control system.

No secret-selection phase is inherently required: both choices were fixed
before pairing. Reveal abandonment still needs an explicit forfeit/dodge rule.

**FEASIBILITY INFERENCE:** feasible in principle, with substantial unproven
protocol work; launch readiness is currently blocked by protocol and balance
evidence. The dominant shared costs are ordered cast replay, bot correctness,
reconnect, settlement, and compatible rollout. The dominant format-specific
launch risk is the unmeasured asymmetric balance tensor.

### 7.6 Format B — Rune Trial feasibility

Rune Trial reuses the cast protocol but adds a durable pregame state machine:

1. **INFERENCE:** the server derives three distinct rune ids from a separate
   seed domain and publishes one common offer. Existing mode and LIMITED supply
   randomness already use isolated suffixes, so an offer suffix can avoid
   shifting either stream (`src/core/modes.ts:69-72`, `src/core/dice.ts:35-48`).
2. **INFERENCE:** each authenticated participant writes one choice through a
   private server boundary. An unrevealed choice remains hidden from the
   opponent, while the chooser can recover their own submitted choice.
3. **INFERENCE:** the second accepted choice atomically snapshots both runes
   onto the participant-visible match, advances to gameplay, and starts the turn
   clock.
4. **INFERENCE:** reconnect reads durable phase, offer, and the caller's own
   submission state rather than relying on a broadcast or placement count.

The current model already trusts the server with seeds, turns, and settlement,
so client cryptographic commit/reveal is unnecessary. An unrevealed choice
cannot live directly on `public.matches`, whose participant RLS exposes the row
to both players. Service-private storage or a caller-filtered RPC, idempotent
compare-and-set submission, and atomic reveal provide the required semantics.

A separate `phase` while the match remains active is safer than casually adding
`selecting` as a new status, because current queries often treat non-active
statuses as finished. That is an engineering inference, not a selected schema.
The contract still needs decisions for selection timeout, auto-pick versus
forfeit/cancel, resignation and deletion during selection, bot choice timing,
what a first submitter sees on reconnect, and when the gameplay clock begins.

#### Classic-backed versus mechanically new Trial

The private selection state machine is shared by both board-rule branches. Both
need a durable offer, idempotent caller-private choices, atomic reveal,
immutable per-seat rune snapshots, a selection deadline, reconnect and bot
choice behaviour, abandonment semantics, history fields, a separate offer seed
domain, and rune-protocol capability gating.

Under **Classic-backed Trial**:

- **INFERENCE:** represent Trial as a format discriminator plus Classic as the
  mechanical mode—for example `format='trial'` and `modifier='classic'`. The
  wheel then selects a `(format, base mode)` outcome rather than only a mode id.
- **FACT/INFERENCE:** scoring, destruction, supply, terminal logic, and
  `CastCtx.mode=CLASSIC` are reusable. No new core mode rule, mode constraint,
  or placement-AI mode heuristic follows from this branch.
- **INFERENCE:** history and UI must use the format field; modifier alone would
  mislabel a Trial as ordinary Classic.
- **INFERENCE:** an old client could understand the Classic board mechanics but
  would skip private selection and runes, so capability gating remains
  mandatory despite lower mechanical replay risk.

Under a **new mechanical Trial mode**:

- **DECISION NEEDED:** define a real scoring, destruction, or supply change
  first. Otherwise the branch is only Classic-backed Trial under another id.
- **INFERENCE:** add a stable mode id and database constraint, implement the
  rule in core replay and every settlement path, and provide mode-aware bot
  evaluation. A supply change also needs a deterministic supply stream/cursor
  contract compatible with FATE.
- **FACT:** `modeById()` currently maps an unknown id to Classic, and the
  project has already recorded a server-before-client mode rollout that caused
  old clients to render and locally display Classic scoring while the server
  used the stored modifier (`src/core/modes.ts:60-62`,
  `docs/MODES.md:87-93`).
- **INFERENCE:** an unknown new mechanical Trial id must fail closed, with the
  database, functions, client capability, and immutable rules version rolled
  out coherently. This branch also requires the new 36-cell payoff matrix in
  §6.4.

**FEASIBILITY INFERENCE:** the shared selection layer and Classic-backed Trial
are feasible in principle, with substantial shared rune-protocol work and
moderate-to-high format-specific complexity concentrated in setup secrecy,
liveness, and reconnect. A genuinely new mechanical Trial cannot yet receive a
specific feasibility verdict: its board rule, replay, AI, settlement, balance,
and rollout scope are undefined. Neither branch is launch-ready, and neither
requires client cryptography under the current trusted-server model.

### 7.7 Consolidated risk inventory

**Critical shared risks**

1. No authoritative cast/action protocol exists; all current replay assumes
   placements.
2. Bots are not rune-capable and may act before a client enters.
3. Every path that derives boards or scores must use identical rune state;
   PILFER can settle from a cast. Non-replaying paths such as account deletion
   still need explicit phase and authoritative-score semantics.
4. The repository's fresh-schema LIMITED constraint mismatch (§3.1) undermines
   the baseline claim “all seven modes.”

**Critical Trial-specific risk**

5. The first choice and setup liveness must be durable and server-private;
   current Realtime-ready broadcast is neither.

**High risks**

6. FATE breaks “one log row = one supply draw.”
7. WARD/SUNDER require persistent replay; PILFER/ANVIL require non-placement
   board mutations.
8. Clocks and reconnect use placement count, while casts retain the turn and
   Trial selection is not a turn.
9. The one-cast rule is internally inconsistent.
10. Old cached clients have no capability negotiation and cannot interpret rune
    matches.
11. Active replay has no immutable rune rules/protocol version. A spell-rule
    deployment could reinterpret an existing action log unless the match
    snapshots a version or rollout explicitly migrates/finishes active matches.

**Medium risks**

12. History lacks the immutable format/rune facts needed for post-launch
    balance analysis.
13. Equipment and ownership persistence do not exist; ownership validation and
    any grant must be server-owned and idempotent.
14. The production rollout spans database, all PvP function closures, web/PWA
    clients, RLS/database tests, and live verification; repository state cannot
    establish the currently deployed function/schema versions.

These are protocol requirements and scope facts, not arguments that either
format is infeasible.

---

## 8. Limited progression and repeat-play scope

### 8.1 Current facts

- All six runes are immediately available offline; NONE is the default
  (`src/ui/library.ts`, `src/core/spells.ts:221-240`).
- No inventory, equipped-rune, rune mastery, or unlock reward exists in the
  current ranked data model.
- The ladder already gives progression on every result and intentionally drifts
  upward at a 50% win rate (`docs/LADDER.md:20-74`).
- Newcomer bot tuning intentionally targets a high early human win rate; the
  recorded reason is that a 50% beginner loss rate caused quit concern
  (`docs/LADDER.md:227-239`).
- Bot matches currently settle through the same result system as human matches.
  Any future “win” reward needs an explicit bot-win rule.

### 8.2 Exact pacing formulae

If match outcomes are independent Bernoulli trials with constant win
probability `p`, an unlock requiring `k` wins has expected wait `k / p`
matches. This says nothing about retention or enjoyment; it only exposes the
pacing implied by that simplified win gate.

If unlock opportunities occur only in Rune Trial with wheel probability `q`,
successive wheel outcomes are independent, `p_T = P(win | Trial)` is constant,
and one eligible Trial win grants an unlock, the lower-bound expected ranked
matches per unlock is:

```text
1 / (q × p_T)
```

before accounting for whether an unowned rune appears, whether the player
chooses it, or whether the reward has duplicate protection. At `q = 10%` and
`p_T = 50%`, that lower bound is 20 ranked matches per unlock.

For a uniform three-of-six Trial offer and `u` already-owned runes:

- expected unowned runes in the offer = `(6 - u) / 2`;
- the exact count `U` of unowned runes in an offer is hypergeometric:

  ```text
  P(U = x) = C(6 - u, x) × C(u, 3 - x) / C(6,3)
  ```

- probability of at least one unowned rune is
  `1 - C(u,3) / C(6,3)` when `u ≥ 3`, and 100% when `u < 3`;
- that probability is 95% at `u=3`, 80% at `u=4`, and 50% at `u=5`.

| Runes already owned | Expected unowned runes offered | Chance at least one is unowned |
|---:|---:|---:|
| 0 | 3.0 | 100% |
| 1 | 2.5 | 100% |
| 2 | 2.0 | 100% |
| 3 | 1.5 | 95% |
| 4 | 1.0 | 80% |
| 5 | 0.5 | 50% |
| 6 | 0.0 | 0% |

These calculations do not decide whether Trial wins should unlock runes.

If the full qualifying chain has independent per-match probability `s`, the
wait to one unlock is geometric:

```text
expected wait = 1 / s
P(no unlock after n matches) = (1 - s)^n
```

The earlier `q=10%`, `p_T=50%` lower-bound example gives `s=5%` before offer
and choice restrictions. Its mean is 20 matches, but the probability of still
having no qualifying win is 35.8% after 20 matches and 12.9% after 40. The mean
alone therefore hides a material unlucky tail. Any additional requirement to
see, choose, or win with a particular unowned rune lowers `s` further.

### 8.3 Hypotheses and risks requiring evidence

- **HYPOTHESIS:** personal equipment can create recognizable player identity
  and long-term rune mastery.
- **HYPOTHESIS:** occasional Rune Trial can interrupt one-rune repetition and
  expose players to unfamiliar effects.
- **INFERENCE:** if measured `V(C | μ)` increases with collection breadth, a
  win-gated inventory can create a positive feedback loop: match success adds
  future mechanical option value while losses do not. Unequal rune strength
  alone is insufficient—for example, the starter set might already contain the
  strongest option under `μ`.
- **INFERENCE:** if a Trial player must choose an unfamiliar rune to unlock it,
  ladder-optimal choice and collection-optimal choice may conflict.
- **INFERENCE:** variable Trial appearance plus win-only acquisition compounds
  waiting probabilities. Pacing must be calculated from the full chain, not from
  “one rune per win” in isolation.
- **DECISION NEEDED:** whether losses make any unlock progress.
- **DECISION NEEDED:** whether bot wins, rematches, forfeits, and Trial wins all
  award the same progression.
- **DECISION NEEDED:** whether unlocks are permanent or seasonal.
- **DECISION NEEDED:** whether Rune Trial loans every offered rune regardless of
  ownership and whether winning with an unowned choice keeps it.

This investigation does not optimize compulsion, infinite grind, monetization,
or variable-reward pressure. It should flag such consequences when a balance or
unlock rule creates them unintentionally.

### 8.4 Evidence boundary for repeat-play claims

- **FACT:** the repository contains no human Rune Trial choice data, no online
  personal-rune retention data, and no evidence that either format increases or
  decreases compulsive play.
- **FACT/DERIVATION:** simulation can measure mechanical collection advantage,
  exposure cadence, offer repetition, choice concentration, and reward-wait
  distributions. It cannot establish enjoyment, retention, habit formation, or
  addiction.
- **INFERENCE:** a random Trial wheel followed by a win-only reward is a
  variable waiting process even if the reward itself is fixed. Making that wait
  finite and legible, reporting its tail rather than only its mean, and avoiding
  competitive power escalation are the progression questions relevant to this
  balance investigation.

---

## 9. Required evidence before a product/launch verdict

### Phase A — recover and preserve the baseline

- [x] Record current rules, roster, modes, and probabilities.
- [x] Reproduce the committed one-sided/symmetric simulator at its documented
  3,000-game command.
- [x] Audit Git history and unreachable objects for the historical asymmetric
  harness/raw matrix. Neither is recoverable from the current repository; only
  the written summary survives (§4.3).
- [x] Explain the current ANVIL/history difference: the published focused run
  and the all-roster run consume different portions of one continuing RNG
  stream; the focused default-seed result reproduces exactly.
- [x] Record a common four-seed sensitivity panel for every maintained
  configuration. The later full v1 matrix derives independent streams per cell;
  any next policy rerun should preselect its uncertainty and multiplicity plan.
- [x] Audit the cast-count disagreement across written rules, normal human UI,
  local CPU, simulator, executable browser coverage, and Git history (§3.3).
- [x] Map every one of the 15 distinct rune pairs across all seven current
  modes at rules level, keeping mechanics separate from win-rate claims (§3.6).

### Phase B — personal-rune payoff matrix

- [x] Scope both FATE cast-rule branches without duplicating invariant cells:
  329 configurations / 987,000 games at 3,000 each for the exact reduced
  two-branch design (§6.4).
- [ ] Resolve and enforce the one-versus-multiple-casts-per-turn rule before
  treating any FATE result as authoritative.
- [x] Measure all six runes against all six under all seven modes under the
  frozen blind Normal policy (§6.5).
- [x] Run both opener orientations for every distinct pair; do not add a second
  duplicate “seat assignment” factor to the 252-cell tensor.
- [x] Use independent seeds and report confidence/replication, not one rounded
  percentage.
- [x] Preserve raw machine-readable output and the exact harness revision.
- [x] Rerun all directed WARD cells in COLUMN SHIELD with production Normal
  cast/placement coordination; retain v1 rather than replacing it (§6.5).
- [x] Rerun SUNDER-sensitive cells with charm-aware placement, explicitly
  including Classic, BOUNTY, and SUNDER/WARD; record cast-attributable kills
  and bounty rather than win rate alone.
- [ ] Compare the current charm-blind placement anchor with an opponent-aware
  policy; do not mistake either policy for optimal human play.
- [x] Compute weighted pre-mode loadout strength, point-estimate pure dominance,
  mode reversals, opener effects, and worst matchup cliffs.

### Phase C — Rune Trial choice analysis

- [x] Derive the 20 offers, 180 ordered choice contexts, Classic payoff reuse,
  and the additional 36-cell cost of a genuinely new board mode (§5.2, §6.4).
- [ ] Confirm Rune Trial's board rule and wheel probability.
- [x] Analyze all 20 three-rune offers from the v1 Classic payoff matrix,
  retaining their shared-cell dependency and point-estimate caveat (§6.5).
- [x] Identify point-estimate pure saddles, dominated choices, mirror saddles,
  and unused decorative choices; bootstrap robustness and human choice remain
  unmeasured.
- [ ] Decide whether the offer randomizer is independent, bagged, or protected
  against recent repetition; measure the selected rule.

### Phase D — multiplayer feasibility contract

- [x] Trace how one-cast versus chained FATE and Classic-backed versus
  mechanically new Trial change action grammar, clock, bot, replay, and rollout
  scope (§7.3, §7.6).
- [ ] Specify authoritative match snapshot fields without yet writing a
  migration.
- [ ] Reconcile the repository/live mode constraint baseline before using it as
  the foundation for a new Rune Trial modifier; do not fold that repair into a
  rune migration silently.
- [ ] Specify the replay event grammar for cast, placement, FATE supply draws,
  persistent charm, and cast-terminal matches.
- [ ] Replace placement count as the only synchronization/version clock; trace
  every current terminal, retry, reconnect, bot, and timeout path against the
  new grammar.
- [ ] Specify Rune Trial secret commitment and abandonment behaviour.
- [ ] Define history/replay visibility, client capability negotiation, and
  stable-rule versioning expectations.

### Phase E — limited progression validation

- [ ] Select a candidate acquisition rule only after balance results exist.
- [ ] Calculate expected unlock pacing by win rate, Trial frequency, collection
  size, bot frequency, and duplicate policy.
- [ ] Test whether collection incentives distort ranked rune choice.
- [ ] Prefer finite, legible progression measurements over open-ended engagement
  claims.

---

## 10. Current evidence-bounded position

This section intentionally remains narrow while the investigation is active.

1. **INFERENCE:** current rune rules fit the broad deterministic-turn model and
   require no reaction-time networking, but online runes remain unimplemented
   end to end.
2. **REPRODUCED:** a preserved 3,948,000-game baseline now covers all six runes,
   seven modes, both opener orientations, four seeds, and both FATE cast
   grammars. Under the frozen blind Normal policy, PILFER strictly dominates
   every other fixed wheel loadout at the point estimate and the strongest to
   weakest uniform-population spread is approximately 9.6pp.
3. **REPRODUCED:** PILFER scores 60.98% against WARD across the wheel and 67.64%
   under SINGLE STRIKE. Seven of 15 pairs reverse advantage across modes, so a
   single roster-wide strength number hides material mode interactions.
4. **REPRODUCED:** 93.3% of WARD casts in the original focused Normal
   WARD/WARD COLUMN SHIELD diagnostic were immediately redundant. After the
   registry-owned coordination fix, a separate 156,000-game treatment observed
   only 5 immediate recurrences among 2,649 successful one-cast WARD casts
   (0.189%), while WARD's uniform-population COLUMN SHIELD score moved only
   -0.0236pp. The recurrence rates come from different cohorts and are not a
   paired effect estimate. **INFERENCE:** the direct contracts plus treatment
   show the obvious AI defect is controlled without rescuing WARD's balance
   position.
5. **REPRODUCED:** the SUNDER root-placement and live-WARD defects are repaired
   by registry-owned coordination. In a separate 336,000-game treatment,
   SUNDER's uniform-opponent score moves +0.1788pp in Classic and +0.2503pp in
   BOUNTY; SUNDER/WARD in COLUMN SHIELD moves only +0.0146pp. BOUNTY SUNDER now
   measures 52.7847% and beats every distinct rune at the point estimate.
   **INFERENCE:** the repair is correct and its balance movement is small, but
   it strengthens an existing BOUNTY specialist rather than closing the roster.
6. **REPRODUCED:** FATE chaining changes no global ordering and moves every
   rune's wheel strength by less than 0.08pp. **INFERENCE:** balance aggregates
   do not choose the cast grammar; protocol clarity still must.
7. **REPRODUCED/DERIVED POINT ESTIMATE:** frozen v1 gives all 20 Classic-backed
   Trial offers one pure saddle. After substituting coordinated SUNDER, 16
   offers retain one mirror saddle and the four PILFER/SUNDER offers have no
   pure saddle; every offer still has a dominated choice for each role.
   **STATISTICAL LIMIT:** the changed classification was separated by only
   0.0792pp, individual replications flip it, and no classification bootstrap
   or human-choice model exists. The stable conclusion is false-choice risk,
   not a deterministic Trial metagame.
8. **PROGRESSION INFERENCE:** personal-rune unlocks are mechanically horizontal
   only if corrected payoff value does not rise with collection breadth. The v1
   baseline fails that condition because access to PILFER adds a strictly
   dominant fixed option.
9. **INFERENCE:** launch feasibility and readiness depend more on authoritative
   event grammar, replay, bot parity, and balance than on the existing client
   hand representation.
10. **INFERENCE:** personal equipped runes are feasible in principle but require
   substantial unproven shared protocol work. Their format-specific setup is
   the smaller of the two only after that shared protocol exists.
11. **INFERENCE:** Rune Trial's selection layer and Classic-backed branch are
   feasible in principle. Their additional difficulty is a durable private
   selection/liveness phase, not cryptographic commit/reveal. Feasibility of a
   genuinely new mechanical Trial mode remains undetermined until its board
   rule defines the required payoff matrix, replay, bot policy, settlement, and
   compatibility rollout. Neither branch is launch-ready.
12. **FACT:** the written, local-human, local-CPU, and simulator cast-count rules
   are not aligned. **INFERENCE:** this must be resolved before final protocol
   implementation and launch—unless the protocol deliberately versions and
   supports both rules—and before one FATE branch is treated as the balance
   baseline.

### 10.1 Evidence-bounded recommendation

1. **Do not win-gate ranked mechanical access with the present roster.** Give
   every ranked player the same six-rune access, or loan the equipped/offered
   rune for that match. Wins can advance finite mastery, cosmetics, titles, or
   a transparent collection track without changing the next ranked match's
   option set.
2. **Keep the two formats distinct.** Personal-rune matches should lock the
   equipped rune before matchmaking and reveal the shared mode plus both runes
   after matching. Rune Trial should ignore equipment, reveal Trial, loan the
   same three-rune offer to both players, keep choices private, then reveal both
   together. Trial should not silently become a modifier layered over all seven
   modes without a new balance tensor.
3. **Prototype personal runes first in an unranked balance lab.** They require
   the shared cast/replay protocol but no private selection phase. Trial is the
   fairer public acquisition surface once its extra selection/liveness state is
   implemented, because ownership cannot change the offered options.
4. **Tune PILFER/WARD globally and SUNDER specifically in BOUNTY before ranked
   launch.** PILFER's v1 dominance and WARD's deep weakness are much larger than
   the measured coordination deltas. Coordinated SUNDER is a small overall
   correction but reinforces an already strong BOUNTY specialist.
5. **Treat the 5% Normal SUNDER slip as flavour, not a difficulty control.** It
   changes the executed column on only about 0.7% of casts in Classic/BOUNTY.
   That is appropriately rare, but too infrequent to make Normal observably
   weaker by itself.
6. **Build one versioned authoritative action grammar before either format is
   ranked.** It must cover cast, placement, FATE draw, persistent charm,
   cast-terminal games, bot actions, reconnect, and replay. Trial then adds a
   durable private offer/selection phase; personal runes add locked loadouts.

A launch verdict remains premature until the Trial board/wheel decisions and
the Phase D protocol contract exist. The policy-sensitivity baseline is now
complete enough for a balance verdict: do not treat the present rune numbers
as launch-balanced, and do not make ranked mechanical access depend on wins.

---

## Appendix A — source map

| Question | Primary source |
|---|---|
| Rune rules and policies | `src/core/spells.ts`, `src/core/spell-policy.ts`, `src/core/spell-types.ts` |
| Scoring, destruction, charm state | `src/core/rules.ts` |
| Mode registry and weights | `src/core/modes.ts`, `docs/MODES.md` |
| Spell design and historical measurements | `docs/SPELLS.md`, `tools/spellsim.ts` |
| Asymmetric v1 raw evidence | `docs/evidence/rune-matchups/v1/raw-*.json`, `tools/rune-matchups.ts` |
| Pooled matrices and Trial analysis | `docs/evidence/rune-matchups/v1/analysis.json`, `tools/rune-matchup-analysis.ts` |
| Coordinated WARD treatment | `docs/evidence/rune-matchups/ward-coordination-v1/`, `tools/rune-ward-sensitivity.ts` |
| Coordinated SUNDER treatment | `docs/evidence/rune-matchups/sunder-coordination-v1/`, `tools/rune-sunder-sensitivity.ts` |
| Ladder and seating measurements | `docs/LADDER.md`, `src/core/ladder.ts` |
| Online lifecycle and authority | `docs/architecture/backend.md`, `supabase/functions/README.md` |
| Match schema and commands | `supabase/migrations/`, `supabase/functions/pvp-join/`, `supabase/functions/pvp-move/` |
| Client sync, clocks, and reconnect | `src/online/play.ts`, `src/online/play-finish.ts`, `src/online/match-api.ts` |
| Browser rune behaviour | `tests/browser/spells/scenarios/` |
| Verification policy | `docs/architecture/testing.md` |

## Appendix B — unresolved owner decisions

1. Does Rune Trial use otherwise-Classic board rules?
2. What probability should Rune Trial take from the current wheel?
3. Is the Trial offer drawn from the full roster regardless of ownership?
4. Does winning with an unowned Trial rune unlock it?
5. Does a loss advance acquisition at all?
6. Do bot wins grant identical acquisition progress?
7. What competitive imbalance is unacceptable: weighted loadout spread,
   worst-cell matchup, or both?
8. Are runes intended as pure horizontal identities, or may later unlocks be
   intentionally stronger?
9. Is the authoritative rule one cast per turn, or any number while charges
   remain?
10. Is Rune Trial technically stored as Classic plus a match-format field, or
    does it deliberately become a new mechanical mode with another board rule?
11. What happens when one Trial player does not select: auto-pick, forfeit, or
    cancellation, and when does the gameplay clock start?
12. Must old clients negotiate a rune-protocol capability before matchmaking?
13. Which immutable rune/format facts survive account-history deletion for
    aggregate balance analysis, if any?
14. How much deeper future charm state should search retain after SUNDER's
    user-directed charm-aware root correction, beyond the already selected
    Easy/Normal/Hard behaviour?
15. Which runes, if any, are guaranteed in the starter collection before a
    win-gated unlock cadence is evaluated?
