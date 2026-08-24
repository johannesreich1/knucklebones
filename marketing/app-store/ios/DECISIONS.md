# iOS App Store screenshot campaign — v2 decisions

**Decision date:** 2026-08-24
**Status:** Draft only — not approved for App Store upload
**Output:** Six English portrait screenshots at 1320 × 2868 px

This document is the creative and truthfulness contract for the second
campaign pass. It supersedes the scene choices in exports made before this
decision. The order is intentional: core play, variety, one rune decision, a
signature mode effect, the ranked payoff, then the ladder aspiration.

## Locked six-frame story

| # | Product state | Visible context | Creative purpose |
|---|---|---|---|
| 1 | ROW MULTIPLY board | Named ranked opponents | Lead with the core dice interaction and two unmistakable horizontal multipliers. |
| 2 | Orbit mode dial, landed on COLUMN SHIELD | Named ranked opponents and ratings | Show all seven modes through the game's most distinctive pre-match theatre. |
| 3 | SUNDER committed with four marked victims | `AI · NORMAL` | Show the most visually dramatic rune decision without implying that runes are currently ranked. |
| 4 | BOUNTY triple-die strike | Named ranked opponents | Replace the quiet LIMITED bag with the shipped struck-coin signature. |
| 5 | Ranked victory | Named ranked opponents, points delta, ranks, and BEATEN stamp | Show the competitive reward and the full online result treatment. |
| 6 | Ladder | Named ranked players | End on progression, identity, and the reason to play another duel. |

Five frames therefore belong visibly to the named online experience. The
single rune frame is the exception and must visibly say `AI · NORMAL`.

## Exact staged fixture intent

The fixtures below are deterministic marketing fixtures, not claims that a
live player produced a particular match. They must be fed into the real game
and online components. Staging data is allowed; painting a substitute game UI
is not.

### 1 — ROW MULTIPLY

- Render the shared production board in its ranked presentation with
  `FrostLynx303` in cyan and
  `EmberCrow896` in magenta. Keep the ranked clock and ranked identity
  treatment visible.
- Use ROW MULTIPLY and stage FrostLynx303's board as
  `[[6, 5, 1], [6, 5], [6, 5, 3]]`.
- This creates exactly two multiplied rows: the three sixes and the three
  fives. The remaining row contains `1`, an empty seat, and `3`, so it must
  not light a third multiplier rail.
- The state is still playable because the middle column has one open seat.
  Its real ROW MULTIPLY total is 136.
- Keep EmberCrow896's rows unmultiplied so the screen contains exactly two
  active row multipliers in total. The v1 opponent board
  `[[2, 2], [5], [1, 4]]` remains suitable.
- The copy should continue to sell matching and multiplying; it must not
  claim that ROW MULTIPLY replaces ordinary column scoring.

### 2 — COLUMN SHIELD orbit dial

- Use the production mode-reveal overlay, not the mode library and not a
  reconstructed wheel.
- Show the landed, readable hold state with every registry-provided mode node
  around the ring, the comet stopped on COLUMN SHIELD, the shield blooming in
  the centre, and the production name and blurb below it.
- Present `FrostLynx303` and `EmberCrow896` with their ratings in the real
  ranked face-off above the dial.
- The selected icon, node, and `COLUMN SHIELD` answer must all settle to the
  production gold token (`#ffd166`, computed `rgb(255, 209, 102)`). Reduced
  motion leaves a 60 ms color transition from inherited white, so readiness
  must wait for the computed gold value rather than merely for the landed
  class. The white early proof was that transition's first frame, not a token
  or cascade defect.
- The frame may be held at the production reveal's landed state for capture,
  but its geometry, icons, colors, name, and rule copy must come from the
  shipped dial and mode registry.

### 3 — SUNDER rune

- This is the campaign's only rune frame. It must show `AI · NORMAL`; do not
  use a username for the opponent and do not display ranked furniture.
- No text in the outer screenshot may use the word **offline**. This applies
  to the eyebrow, headline, subhead, and any added caption. Neutral language
  such as “Six tactical runes” is acceptable.
- Stage CLASSIC with SUNDER, a die of `4` in hand, the player's board
  `[[6, 6], [3], [2]]`, and the AI board
  `[[4, 4], [5, 4], [1, 4]]`.
- Commit SUNDER through the production rune controller. The real preview must
  mark four authoritative victim dice across all three enemy columns. The
  hand-die heat, crooked doomed dice, embers, rune rail, and status line must
  all be the runtime's own presentation.
- Capture the committed warning state before placement. Do not add victim
  glows or embers to the final PNG by hand.

### 4 — BOUNTY triple strike

- Render the shared production BOUNTY board with the same two named users,
  ranked mode badge, scores, identity treatment, and reserved clock lane. The
  active clock bar is correctly hidden while the move resolves.
- Stage a `4` in FrostLynx303's hand opposite an EmberCrow896 column of
  `[4, 4, 4]`, then perform the legal facing placement through the real move
  animation.
- Capture the production struck-coin beat when all three destroyed dice carry
  their centred BOUNTY `✦` coins. The three coins, victim compression, seat
  rings, and stagger must come from the shipped BOUNTY presentation.
- A pre-existing visible bounty tally may be staged to show that earlier kills
  remain banked. It must represent prior legal kills; do not prematurely add
  the current triple to the tally while its strike is still resolving.
- Copy must state the actual rule: each destroyed die banks a permanent +1.
  Do not combine this frame with SUNDER, because ranked runes are not shipped.

### 5 — ranked victory

- Enter the result through the production online result controller with a
  non-forfeit win. A local result screen is not acceptable.
- Use the stable fixture outcome `47–30`, with FrostLynx303 defeating
  EmberCrow896.
- Use the ladder-consistent result authored by the product design:
  FrostLynx303 moves from 2,427 to 2,510 for `+83`, while EmberCrow896 moves
  from 2,493 to 2,431. The settled plates show `GOLD · #3` and `GOLD · #5`.
- The final frame must visibly include both identity plates, FrostLynx303's
  points delta, the opponent's **BEATEN** stamp, Share result, Next duel, and
  Home. `forfeit` must be false so the product chooses BEATEN rather than its
  forfeit stamp.
- Profile, standing, ladder, and opponent-card responses may be deterministic
  transport fixtures, but the online result component must consume them and
  render the screen itself.

### 6 — ladder

- Use the real online ladder renderer with deterministic, fictional player
  rows. Centre the list on FrostLynx303's highlighted row.
- Keep the campaign's result continuity: FrostLynx303 is `GOLD · #3` at
  2,510 and EmberCrow896 is `GOLD · #5` at 2,431. Surround them with enough
  named rows and group horizons to make the climb legible.
- Preserve production group names, thresholds, avatars, gap language, row
  geometry, and scrolling behavior. Mock only the server data returned to the
  renderer.
- The ladder replaces Home because it is more visually distinctive and gives
  the ranked story an aspirational final beat.

## Why these six won

- **ROW MULTIPLY** makes the scoring idea visible without explanation. Two
  rails read as a deliberate combo; three hot rows made the v1 hero visually
  indiscriminate.
- **The orbit dial** is the game's own icon system in motion and communicates
  seven modes at a glance. A long library is useful documentation inside the
  app but reads like settings copy at App Store scale.
- **SUNDER** has the strongest stable rune silhouette: one heated hand die and
  multiple exact victims spread across the opposing board. It communicates a
  tactical decision more immediately than PILFER's target rings.
- **BOUNTY** owns a production signature no other mode has: defeated dice are
  literally minted into the points they bank. It remains legible in a still
  and has more visual drama than LIMITED's deliberately quiet supply gauge.
- **The ranked result** contains the campaign's emotional payoff: verdict,
  score, identity, movement on the ladder, and the physical BEATEN stamp.
- **The ladder** closes on continued ambition instead of repeating the app's
  navigation choices.

## Rejected v1 choices

| V1 choice | Decision |
|---|---|
| AI ROW MULTIPLY with all three row rails active | Replace with a named ranked fixture and exactly two active rows. |
| Full Game Modes library | Replace with the actual orbit dial landed on COLUMN SHIELD. |
| PILFER targeting | Replace with SUNDER committed against four exact victims. |
| “Offline runes” in marketing copy | Remove the word “offline”; preserve truth through the visible `AI · NORMAL` context. |
| LIMITED bag | Replace with an online BOUNTY triple-coin strike. |
| Local victory | Replace with the online result, identity plates, valid delta, ranks, and BEATEN stamp. |
| Home | Replace with the ladder as the final aspirational screen. |

These are creative rejections, not product criticisms. The library, PILFER,
LIMITED, local result, and Home remain valid product screens; they are simply
less effective in this six-image marketing sequence.

## Truthfulness and draft caveats

1. **The app area is always real product rendering.** Board state, usernames,
   ratings, result reports, and ladder rows may be mocked deterministically,
   as they are in browser tests. The production board, dial, spell controller,
   move effects, online result, plates, stamp, and ladder must draw the pixels.
   No screenshot may replace those components with hand-built HTML, traced
   artwork, image-generation, or post-painted effects.
2. **Animation stills must be real frames.** It is acceptable to pause a
   production animation at a reproducible time for capture. It is not
   acceptable to recreate its final classes or draw coins, embers, the comet,
   or the stamp into the export.
3. **The usernames are fictional fixtures.** They do not represent real
   customer accounts, endorsements, or live leaderboard positions.
4. **Runes are not currently online.** The SUNDER frame is truthfully an
   `AI · NORMAL` game even though its outer copy does not say “offline.” It
   must never be dressed with ranked names, ratings, a ranked clock, or copy
   that implies online casting.
5. **The whole campaign remains draft while online runes are unshipped.** This
   is an owner constraint even though the individual AI rune frame is a real
   current product state. Do not mark the set upload-ready until that product
   dependency is resolved.
6. **Store-name clearance is unresolved.** “Knucklebones Neon,” its lockup,
   and any name-bearing metadata remain provisional. A cleared name change
   requires regeneration of every outer lockup and associated manifest copy.

## Regeneration dependencies

1. Build the current production runtime with Node 24 before every final
   capture. Do not reuse a previous build after mode, rune, result, ladder,
   typography, responsive, or localization changes.
2. Provide deterministic transport fixtures for the named online board,
   ranked reveal, result RPCs, and ladder. Never depend on live Supabase data
   or real player accounts for campaign regeneration.
3. Drive each state through its real owner:
   - shared ranked board renderer for ROW MULTIPLY and BOUNTY;
   - production reveal flow for the orbit dial;
   - production rune controller for SUNDER;
   - production move animation for the BOUNTY strike;
   - online result controller for the victory;
   - online ladder renderer for the last frame.
4. Make each capture deterministic before setting the campaign page ready:
   fonts loaded, layout fitted, transitions settled, and the intended
   animation frame or hold state reached. The dial must not disappear into the
   next reveal beat, the clock must show the same value in both segments, and
   the BOUNTY capture must occur while all three real coins are visible.
5. The top and bottom source segments for one export must represent the exact
   same runtime state and animation time. Do not stitch two different BOUNTY,
   dial, clock, or stamp frames across the horizontal join.
6. Keep `source.html`, `manifest.json`, exported filenames, and campaign copy
   synchronized with this order. Exports that predate these decisions are
   superseded and must not be uploaded.
7. Run the deterministic join/export step, then verify all six outputs are
   opaque RGB PNGs at exactly 1320 × 2868. Review every full-resolution frame
   and the contact sheet for clipped copy, stale v1 scenes, animation seams,
   accidental AI/ranked mixing, and inconsistent names or ratings.

## Release acceptance

The campaign is ready for a new internal review only when all six frames match
the locked sequence and fixture intent above. App Store upload additionally
requires explicit resolution of both draft blockers: the online-rune product
dependency and store-name clearance.
