# iOS App Store campaign — v5 decisions

**Decision date:** 2026-08-25
**Status:** Approved for editable-draft synchronization; not approved for review submission
**Output:** 36 localized portrait screenshots: 3 locales × 2 devices × 6 frames
**Capture build:** `304a44e6`

This is the creative, fixture, localization, delivery, and truthfulness
contract for the fifth campaign pass. It supersedes every earlier exported
sequence. The order is deliberate: core play, mode variety, defensive rune,
offensive rune, signature-mode spectacle, then ranked progression. The same
six-frame story is rendered in English, German, and French for both required
Apple device targets; it is not one English master duplicated across locales.

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

## Locale and device matrix

The campaign covers exactly the product's supported store locales and both
device classes declared by the universal iOS target:

| App Store locale | Runtime locale | Runtime viewport | Final export | Frames |
|---|---|---|---|---:|
| `en-GB` | `en` | iPhone 440 × 956 | 1320 × 2868 (`APP_IPHONE_67`) | 6 |
| `en-GB` | `en` | iPad 1032 × 1376 | 2064 × 2752 (`APP_IPAD_PRO_3GEN_129`) | 6 |
| `de-DE` | `de` | iPhone 440 × 956 | 1320 × 2868 (`APP_IPHONE_67`) | 6 |
| `de-DE` | `de` | iPad 1032 × 1376 | 2064 × 2752 (`APP_IPAD_PRO_3GEN_129`) | 6 |
| `fr-FR` | `fr` | iPhone 440 × 956 | 1320 × 2868 (`APP_IPHONE_67`) | 6 |
| `fr-FR` | `fr` | iPad 1032 × 1376 | 2064 × 2752 (`APP_IPAD_PRO_3GEN_129`) | 6 |

Both the marketing overlay and every player-visible product string use the
selected runtime locale. Localizing only the headline while leaving the game
UI in English was rejected: it would look like a mockup and would not prove
the actual German and French layouts. Adding unsupported store languages was
also rejected; the truthful scope is the three languages users can select in
the app.

The iPad images come from a real 1032 × 1376 runtime layout with iPad safe
areas, not an enlarged or cropped phone canvas. One deterministic capture
pipeline owns both devices so fixture meaning stays identical while the real
responsive product layout is allowed to differ. This produces six managed
locale/device sets and 36 final PNGs. BOUNTY needs one extra authentic active
source for every set, so a complete capture contains 42 raw frames.

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
  1,660 ms cleanup timer so every locale/device capture holds the same state.
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
  Source A is opaque through 60.25104603% of the output, transitions linearly
  through the empty board-to-centre gap, and is fully transparent from
  61.0181311%. Source B supplies the complete centre and lower game view. The
  manifest stores ratios rather than phone-only rows so the transition keeps
  the same semantic position on iPhone and iPad. No board, coin, rune, die,
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
   The manifest-ratio feather sits only in the empty gap between them. The
   visible `4` is a later legal roll; it is not restored inside the resolving
   move.
7. **Draft synchronization is not release approval.** The exact campaign may
   be staged in the editable App Store Connect draft. Ranked runes must ship
   and the BOUNTY preview must be regenerated from that shipping implementation
   before review submission.
8. **Store-name clearance remains unresolved.** “Knucklebones Neon,” its
   lockup, and name-bearing metadata are provisional. A cleared name change
   affects all 36 previews and three metadata localizations.
9. **Listing ownership is narrow.** The campaign owns localized name,
   subtitle, promotional text, keywords, and description only. It does not
   invent support, privacy, privacy-choices, or marketing URLs while the
   localized public destinations do not exist. Metadata describes ranked and
   runes separately and makes no ranked-rune availability claim.

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
4. Capture one full lossless raw frame for every locale/device/hero tuple.
   BOUNTY additionally requires complete `hero` and `active` frames for each
   tuple; the finalizer alone owns their manifest-ratio chronological
   transition. A complete run therefore produces 42 raw frames and 36 finals.
5. Keep `source.html`, `manifest.json`, `metadata.json`, raw/export stems,
   checksums, `capture-provenance.json`, six contact sheets, README, and this
   decision log synchronized with the locked order and locale/device matrix.
6. Any product or campaign design change that affects one scene requires that
   scene to be regenerated in all three locales and both devices. Changes to
   shared UI, layout, typography, localization plumbing, or capture/finalizer
   code require the complete matrix to be regenerated with
   `mise exec -- npm run appstore:screenshots:generate`. A BOUNTY change always
   regenerates both sources in all six locale/device sets.
7. Commit affected raw frames, final PNGs, checksums, provenance, and contact
   sheets in the same change as their source. A stale generated preview is a
   failing handoff even when source tests pass. This rule is mirrored in
   `AGENTS.md` and `CLAUDE.md` so future coding agents see it before handoff.
8. Validate all 36 opaque PNGs at 1320 × 2868 or 2064 × 2752, then review the
   six contact sheets and representative finals at full resolution for
   clipping, seams, source-language leaks, stale scenes, colour drift,
   responsive defects, exit-button leakage, and AI/ranked mixing.

## Release acceptance

The campaign is ready for editable-draft synchronization only when all 36
exports and three metadata localizations match this contract, focused checks
are green, every input is committed, the owner has reviewed the remote plan,
and the confirmation token matches. That permission does not authorize review
submission. Submission additionally requires shipping ranked runes,
regenerating affected previews from the shipping implementation, clearing the
store name, publishing truthful localized legal/support destinations, and an
explicit future release decision.

## Delivery decision

The uploader is owner-local, explicit, and separate from application deploys.
Screenshots are App Store listing metadata rather than binary content; coupling
them to every Cloudflare push, native sync, or archive would grant store-write
credentials to an unrelated path and could publish a draft after an ordinary
code change.

Fastlane 2.238.0 is locked because the targeted implementation uses its
Spaceship App Store Connect models. Generic Deliver overwrite was rejected:
this is a universal iPhone/iPad app, and that action can clear or reorder all
screenshot sets in an included locale. The selected workflow reads the exact
app and editable iOS version, manages only `en-GB`, `de-DE`, and `fr-FR` plus
their `APP_IPHONE_67` and `APP_IPAD_PRO_3GEN_129` sets, snapshots every unowned
field and other locale/device set, and verifies that protected snapshot after
the operation.

The workflow separates local check, remote read-only plan, and mutation. A
confirmation token binds the app id, version, all localized owned metadata,
ordered checksums for six screenshot sets, and complete current remote
inventory; a changed file or remote edit invalidates it. A plan additionally
requires the whole marketing input/export directory to be tracked and clean,
along with the Fastlane implementation, package commands, Gemfile, and lock.
An unreviewed local capture or uploader edit cannot run against the store.

The mutation may create only missing localizations for the three managed
locales, patch only `name`, `subtitle`, `promotionalText`, `keywords`, and
`description`, and synchronize six ordered screenshots per managed target.
Because Apple's current create schema requires an App Info `name`, a missing
locale is created atomically with the confirmed localized name and subtitle;
the matching version locale is created with its confirmed three owned fields.
Returned values must match the confirmed request before any screenshot work.
Uploads fill spare capacity before stale target images are removed, while a
full ten-image target deletes only one proven-stale member at a time. This
makes partial failure recoverable without blanking the set. The lane preserves
unowned URLs, update notes, other locales, and other device inventories. It
does not create an app/version, upload a binary, or submit for review.

Machine-readable draft approval is deliberately independent of credentials.
The reviewed configuration uses `draftSyncApproved: true` with manifest status
exactly `approved for draft App Store Connect synchronization` to authorize
this draft-only mutation. `reviewSubmissionApproved: false` is separate and
must remain false: a valid API key, successful draft sync, and confirmation
token are not release approval. The ranked-rune truth gate, regenerated
shipping-state previews, store-name clearance, and public localized URLs all
remain required before any future review-submission workflow may exist.
