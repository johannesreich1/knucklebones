# iOS App Store screenshot campaign — v4 decisions

**Decision date:** 2026-08-25
**Status:** Draft only — not approved for App Store upload
**Output:** Six English portrait screenshots at 1320 × 2868 px
**Capture build:** `19d82a76`

This is the creative, fixture, and truthfulness contract for the fourth campaign
pass. It supersedes earlier exported sequences. The order is deliberate: core
play, mode variety, defensive rune, offensive rune, signature-mode spectacle,
then ranked progression.

## Locked six-frame story

| # | Product state | Visible context | Creative purpose |
|---|---|---|---|
| 1 | ROW MULTIPLY board | `FrostLynx303` vs `EmberCrow896` | Lead with one `×2` row and one `×3` row so both multiplier tiers are visible. |
| 2 | Orbit dial landed on COLUMN SHIELD | Named ranked opponents and ratings | Show all seven modes through the game's distinctive pre-match theatre. |
| 3 | WARD absorbing a real strike | `AI · NORMAL` | Make protection instantly readable: one mint seal, one incoming die, no lost dice. |
| 4 | SUNDER committed against four victims | `AI · NORMAL` | Counter WARD's precision with the widest and most explosive rune preview. |
| 5 | BOUNTY two-die strike + later active turn | Named ranked opponents | Align two shipped coin impacts with the visible `✦2`, then add an enlarged face-up WARD, die, and clock from a second production moment. |
| 6 | Ranked ladder | Named ranked players | Combine the victory claim with visible progression and a nearby rival to chase. |

Four of six frames visibly belong to the named ranked experience. The two
rune-led frames use the real `AI · NORMAL` presentation. The BOUNTY composite
also previews the planned ranked rune rail through the production armed-card
pose; that is why the entire campaign remains gated on ranked-rune launch. The
preview copy makes no availability claim.

## Exact deterministic fixtures

The states below are fictional marketing fixtures, not claims that a live
customer produced a particular match. Fixture data may be staged, but the
production components must render every product pixel.

### 1 — ROW MULTIPLY

- Render the shared production board in its ranked presentation with
  `FrostLynx303` in cyan and `EmberCrow896` in magenta. Keep the ranked clock
  lane and identity treatment visible.
- Use ROW MULTIPLY and stage FrostLynx303's board as
  `[[6, 5, 1], [6, 5, 3], [6]]`.
- This produces exactly two multiplied rows with different tiers: the three
  sixes form one `×3` row, while exactly two fives form one `×2` row and the
  third seat in that row is empty. The remaining row contains `1`, `3`, and
  one empty seat, so it must not light a third multiplier rail.
- The state remains playable because the right column has two empty seats.
  Its production ROW MULTIPLY total is 106, combining the ordinary column
  total with the visible `54 ×3` and `20 ×2` row awards.
- Keep EmberCrow896 at `[[2, 2], [5], [1, 4]]`; no opponent row multiplies.

### 2 — COLUMN SHIELD orbit dial

- Use the production mode-reveal overlay, not the mode library or a recreated
  wheel. Show all seven registry-provided nodes and hold the landed state on
  COLUMN SHIELD.
- Present `FrostLynx303 · 2,494` against `EmberCrow896 · 2,468` in the real
  ranked face-off.
- The selected node, centre icon, and `COLUMN SHIELD` answer use the production
  yellow-gold token `#ffd166` (`rgb(255, 209, 102)`). WARD does not borrow this
  colour; its separate identity is mint.
- Reduced motion leaves a 60 ms colour transition from inherited white.
  Capture readiness therefore waits for the computed gold value, not merely
  the dial's landed class. The earlier white proof sampled that transition's
  first frame; it was not the selected-state design.

### 3 — WARD strike contact

- Use CLASSIC with WARD in the production `AI · NORMAL` game view.
- Stage the player board as `[[5, 2], [4, 4], [6]]` and the AI board as
  `[[3, 3], [2], [5, 1]]`. The middle `[4, 4]` pair is the valuable protected
  stack and the surrounding nonmatches keep the story singular.
- Cast WARD through the production rune controller onto the player's middle
  column. Then give the AI a `4` and perform the real placement into its middle
  column. The settled AI column becomes `[2, 4]`.
- Capture the authored strike-contact beat: one attacking-die ghost reaches
  the centre-facing clasp, the mint seal snaps, the WARD charge becomes zero,
  and the protected `[4, 4]` pair remains untouched.
- Motion must be enabled for this frame; reduced motion intentionally omits the
  ghost and snap. Freeze only the real 1,024 ms recoil and the five WARD snap
  animations at 192 ms, where the chip flare is at its authored peak. Pause
  continuous background/multiplier loops at a fixed phase and clear the seal's
  1,660 ms cleanup timer so independent top and bottom captures hold one state.
- Assert the WARD mark's computed colour is the production mint
  `#7dffc4` (`rgb(125, 255, 196)`). The matching pair may still use the game's
  normal multiplier gold; the protection mark itself remains mint.
- Copy says the seal absorbs an enemy strike that would destroy dice. It must
  not imply that an ordinary miss spends WARD.

### 4 — SUNDER overload

- Use CLASSIC with SUNDER in the production `AI · NORMAL` game view.
- Stage a `4` in hand, the player's board as
  `[[6, 6], [3], [2]]`, and the AI board as
  `[[4, 4], [5, 4], [1, 4]]`.
- Commit SUNDER through the production rune controller. The real preview must
  mark four authoritative victim dice across all three enemy columns.
- Capture before placement. The heated hand die, doomed-die angles, embers,
  rune rail, and status line all come from the runtime; none are added later.

### 5 — BOUNTY double strike + active turn

- Source A is the real reduced-motion strike. Start FrostLynx303 at
  `[[6, 2], [5], [3, 1]]`, EmberCrow896 at
  `[[4, 4], [2, 5], [1, 6]]`, and both bounty banks at zero. Place the `4`
  through the production move controller into FrostLynx303's first column.
  Hold only when exactly two victim dice carry centred production BOUNTY
  coins. The ranked clock is correctly absent while the move resolves.
- Source B is a later, rules-reachable active turn. The double kill has settled
  FrostLynx303 at `[[6, 2, 4], [5], [3, 1]]` with `✦2`; EmberCrow896 has then
  safely placed a `1` into the emptied first column and stands at
  `[[1], [2, 5], [1, 6]]`. FrostLynx303 legitimately holds a new `4`.
- Source B arms WARD through the production rune controller. The real card
  turns face-up, enlarges to its activated pose, marks its legal columns, and
  changes the production status to `TAP YOUR OWN COLUMN`. The real `4` remains
  in hand beside it, while the ranked warning clock is frozen at 4 seconds
  with 40% of its ten-second track remaining. This is the later player's
  targeting decision, not a card painted into the resolving strike.
- The final is explicitly chronological, not one simultaneous game state.
  Source A is opaque through output row 1728, transitions linearly through the
  empty board-to-centre gap, and is fully transparent from row 1750. Source B
  supplies the complete centre and lower game view. No board, coin, rune, die,
  status, clock, score, or identity pixel is painted by the export script.
- The two visible coin strikes therefore explain the later visible `✦2` exactly.
  Using three victims made the effect and tally disagree at a glance.
- Copy states the actual rule: each destroyed die banks a permanent +1.

### 6 — ranked ladder

- Use the production online ladder renderer with deterministic fictional rows.
  Mock transport only; do not paint the list or league horizons by hand.
- Use a population of 199. `PrismWolf771` is the only `NEON`/apex row at #1;
  `NovaComet992` is #2; `CipherMoth440` is `GOLD · #3` at 2,550;
  `FrostLynx303` is highlighted at `GOLD · #4` with 2,510; and
  `EmberCrow896` follows at `GOLD · #5` with 2,431.
- FrostLynx303's record is 35 wins, 18 losses, and 2 draws: 55 games in total.
  The next named rival is only 40 points ahead, so the visible `+40 on you`
  gap gives `WIN. CLIMB. REPEAT.` a concrete target rather than an abstract
  promise.
- Preserve the production `NEON`, `OBSIDIAN`, `GOLD`, `SILVER`, and `IVORY`
  horizons, group thresholds, avatars, progress, gap language, and row layout.
- The subhead's top-1% claim is the product's NEON threshold. With population
  199, only rank #1 belongs there, keeping the fixture internally consistent.

## Why this sequence won

- **ROW MULTIPLY** explains the core scoring hook without prose. Two rails read
  as a deliberate combo; three lit rows made the earlier hero indiscriminate.
- **The orbit dial** changes silhouette after the board hero and communicates
  seven modes at a glance. Its selected yellow state is now explicitly tested.
- **WARD and SUNDER together** prove that runes are not six versions of the
  same attack. WARD is sparse, mint, protective, and singular; SUNDER is
  orange, chaotic, offensive, and board-wide.
- **BOUNTY** restores energy after the two tactical frames. Two struck coins
  remain unmistakable at thumbnail size, while the later enlarged face-up
  WARD, die, targeting prompt, and warning clock add a second layer of tactical
  urgency. Matching the two impacts to `✦2` is clearer than the earlier
  triple-impact composition.
- **The ladder** is a stronger use of the final slot than a second ranked
  summary screen: named rivals, a +40 target, league horizons, and the headline
  now express the complete win → climb → repeat loop in one composition.

## Superseded alternatives

| Earlier choice | Current decision and reason |
|---|---|
| AI ROW MULTIPLY with all three row rails active | Use named rivals and exactly two active rows so the multiplier idea stays selective. |
| Full Game Modes library | Use the orbit dial; it is more visual and is the real pre-match mode reveal. |
| PILFER targeting | SUNDER is more spectacular in a still, while WARD adds the defensive counterpoint. |
| Availability-labelled rune copy | Use neutral tactical copy and let the truthful `AI · NORMAL` product context speak for itself. |
| LIMITED bag | BOUNTY's two minted strikes plus the active-turn controls are more distinctive at App Store scale. |
| Three BOUNTY victims beside `✦2` | Use exactly two victims, then transition to the later active state where those two kills have settled into `✦2`. |
| Restored hand die inside the frozen strike | Use a second real, rules-reachable active-turn rendering; never resurrect a consumed die in the strike DOM. |
| Local victory | Replaced in v2 by the production online result with identity plates and BEATEN stamp. |
| Standalone ranked victory | Removed in v3 at the owner's direction; transfer `WIN. CLIMB. REPEAT.` to the ladder and use the freed slot for WARD. |

The retired online-result fixture remains a documented alternate: a non-forfeit
47–30 win by FrostLynx303 over EmberCrow896, `+83`, settled `GOLD · #3` and
`GOLD · #5` plates, and the production `BEATEN` stamp. If revived, it must be
regenerated from the current online result component and current product
design; the obsolete exported PNG is intentionally not part of this set.

## Truthfulness and draft caveats

1. **Every app panel is real product rendering.** Board state, ratings, and
   ladder rows may be mocked deterministically, as in browser tests. The shared
   board, dial, rune controller, strike effects, and ladder own the pixels.
2. **Animation stills are real frames.** Pausing an authored animation at a
   reproducible time is allowed. Recreating a ghost, seal, ember, coin, comet,
   or league row in the export is not.
3. **Usernames are fictional fixtures.** They are not live accounts,
   endorsements, or claimed leaderboard positions.
4. **Rune contexts are explicit.** WARD and SUNDER visibly use `AI · NORMAL`;
   they carry no ranked names, ratings, or clock furniture. The armed,
   face-up WARD in BOUNTY is planned ranked-rune artwork and keeps the whole
   campaign in draft until that implementation ships.
5. **The leave control is intentionally suppressed.** `#btnLeave` is hidden by
   the capture fixture in every preview so store art contains no exit affordance.
   No product stylesheet or runtime behavior is changed.
6. **BOUNTY is a disclosed chronological composite.** Its upper double-strike
   hold and lower active turn are two authentic production-rendered moments.
   The 22 px feather sits only in the empty gap between them. The visible `4`
   is a later legal roll; it is not restored inside the resolving move.
7. **The campaign remains a draft while ranked runes are unshipped.** This is
   an owner release constraint for the planned campaign even though both rune
   images truthfully depict existing game states.
8. **Store-name clearance remains unresolved.** “Knucklebones Neon,” its
   lockup, and name-bearing metadata are provisional. A cleared name change
   affects all six previews.

## Regeneration contract

1. Build the current production runtime with Node 24 before final capture. Do
   not reuse a build after game, mode, rune, online, typography, responsive, or
   localization changes that affect these pixels.
2. Drive each state through its owner:
   - shared board renderer for ROW MULTIPLY and both BOUNTY sources;
   - production reveal flow for the orbit dial;
   - production rune and move controllers for WARD and SUNDER;
   - online ladder renderer for the final frame.
3. Set `data-ready=1` only after fonts, layout, computed colours, exact counts,
   and the intended authored animation frame have been verified.
4. Independent top and bottom source loads must represent the same state and
   animation time. Use overlap comparison to detect clock, loop, or effect
   drift before joining. BOUNTY additionally requires complete `hero` and
   `active` source pairs; the finalizer alone owns their manifest-defined
   1728–1750 chronological transition.
5. Keep `source.html`, `manifest.json`, raw stems, export stems, checksums,
   capture-build tag, contact sheet, README, and this decision log synchronized
   with the locked order.
6. Any product or campaign design change that affects a preview requires its
   raw segments, final PNG, checksum, and the contact sheet to be regenerated
   in the same change. A stale generated preview is a failing handoff, even if
   source tests pass. This rule is also mirrored in `AGENTS.md` and
   `CLAUDE.md` so future coding agents see it before handoff.
7. Validate six opaque sRGB PNGs at exactly 1320 × 2868, then review each at
   full resolution and as a contact sheet for clipping, seams, stale scenes,
   colour drift, and AI/ranked mixing.

## Release acceptance

The campaign is ready for a new internal review only when all six exports match
this sequence and fixture contract. App Store upload also requires the owner to
resolve the ranked-rune launch dependency and store-name clearance.
