# Project Status

*Last updated: 2026-08-20. This is the "where do we stand" document — the
README explains how the project works; this file records what exists, what
was decided, and what's still open.*

## Production state, right now

| Piece | State |
|---|---|
| **Web** | **LIVE** at https://knucklebones-asg.pages.dev — Cloudflare Pages, auto-deploys every push to `main` |
| **Backend** | Supabase project `euzjcejbkxvqfrttgaxu` (EU) — schema through migration 0024, RLS + column-grant hardened. 0014 (Game Center ids) is written but NOT applied — it waits for a device |
| **Edge Functions** | `pvp-join` v17, `pvp-move` v15, `pvp-claim` v10, `account-delete` v1 — all ACTIVE, nothing dead deployed. `gc-auth` is written but undeployed (same reason). CAREFUL: `pvp-move`'s deployed `index.ts` is the away-turns version from the UNMERGED branch `claude/duell-away-auto-play-9d2203` — redeploying it from main alone reverts live behavior until that branch lands |
| **CI** | GitHub Actions: build + full test gate (24 suites) on every push — green through current `main` |
| **Design system** | 170 cards (44 screens × 4 device sizes + the two `00-` specs) in the Claude Design project "Knucklebones", generated from the app's real CSS **and its real code** — see "Cards render the app" below |
| **Signups** | **Open** — a first tap on RANKED mints a guest account (no email, no form). Attaching an email still waits on SMTP; see `docs/IDENTITY.md` |

Verified live on 2026-08-17: build tag on the deployed page matches the local
build, service worker activates with the matching cache key, the online chunk
lazy-loads from the production origin, and Supabase answers it. A full
two-browser PvP match (and a human-vs-bot match) ran clean against this
backend during development.

## What was built (Aug 2026 sprint)

1. **Repo + CI baseline** — GitHub repo, Actions workflow running the entire
   Playwright gate + AI bench on every push.
2. **Monolith → modules** — the single-file game became typed Vite/TS modules
   (`core/` strict and DOM-free) while `build.mjs` still emits every original
   artifact shape (PWA, single-file, native www, embeddable widget) from one
   source with one build hash. Behaviour-preserving, proven by the unchanged
   test gate.
3. **Backend v1** — Supabase with real accounts, profiles, and replay-based
   score validation (Edge Functions import `src/core` verbatim).
4. **The ranked pivot** (user decision) — AI/solo games are never ranked.
   Ranked = online PvP only, Elo ladder (K=32, start 1000). Thin player pool
   is backfilled by server-side bots behind generated nicknames (same
   generator as signup defaults, e.g. `BoldRaven482`); bot games rate the
   human, bot accounts are flagged `is_bot` and never listed. Nickname
   moderation policy: rename-on-report.
5. **Server-authoritative PvP** — matchmaking queue (bot backfill after ~7s),
   per-move validation by log replay, service-only dice seeds, 65s stall
   forfeit, account deletion that forfeits an active match first. Anti-cheat
   verified live; the client's entire vocabulary is `{match_id, col}`.
   A found-and-fixed hole is documented in migration 0006: `profiles.rating`
   was self-PATCHable; now only `nickname` is client-writable.
6. **Online client** — lazy chunk (auth, ladder, account, queue, live match
   driver reusing the local board/animations). Realtime + log-rebuild
   resilience; concurrency invariants documented inline in
   `src/online/play.ts`.
7. **Design system** — every screen as a live HTML card built from the app's
   own CSS, synced to Claude Design at four device sizes.
8. **Online-first home** — the title screen implements the design's home
   (identity chip, dice-duel hero, PLAY ONLINE primary); local play moved
   behind a Practice overlay. Practice never touches ratings.
9. **Web deploy** — Cloudflare Pages via git integration (`npm run build` →
   `pwa/`, Node pinned by `.nvmrc`). Hosting decision: resolved.

### 5. The mode wheel (2026-08-17 evening, user feature request)

Ranked matches spin a wheel before starting: **CLASSIC** (50%), **ROW
SWITCH** (rows multiply instead of columns), **ROW MULTIPLY** (row matches
add on top), **COLUMN SHIELD** (full columns immune) — each addition ~16.7%.
Every mode carries an icon (registry field); non-classic matches show
`ONLINE · <icon> <name>`, and shielded full columns wear a popping 🛡 with a
golden glow (blocked hits flash it). Stall forfeit tightened to 30s
(user request; client claims at 35s).
Four equal segments, weighted spin; the pick is a server-side deterministic
draw from the match seed (`core/modes.ts pickMode`), stored in
`matches.modifier`, and every server consequence (replay, scoring, Elo, bot
search) runs under it. The client wheel (`src/online/wheel.ts`) is aimed
theater; boards, chips, totals and destroy animations follow `S.scoring`.
Practice stays pure classic. Adding a mode = one registry entry + rules/AI
branches + its gate cases.

**Rollout lesson (burned):** the mode-aware server was deployed while the
old client was still live — it dealt modded matches the client rendered as
classic ("the AI always wins even though I have more points"). Hotfixed by
pinning the deployed pvp-join to `modifier: 'classic'` until the wheel
client ships; re-enable `pickMode(seed).id` AFTER the client deploy.
Protocol-changing server work waits for its client, always.

### Mode wheel odds (production, since 2026-08-18)

Classic 50% (weight 6 of 12); the six additions — ROW SWITCH, ROW
MULTIPLY, COLUMN SHIELD, SINGLE STRIKE, BOUNTY, LIMITED — 1/12 (~8.3%)
each. The weights live in `core/modes.ts` and only `pvp-join` needs
redeploying when they change (it alone spins the wheel).

LIMITED (added 2026-08-18): the dice are finite — one shared bag holds
every face exactly `POOL_PER_FACE` (4) times, shuffled deterministically
from the seed (`dice.ts poolSequence`, `'#pool'` suffix, so classic
streams never shifted). `rebuild()` draws from the bag and ends the game
when the last die is placed, full boards or not; scoring stays classic.
The client's rail above the boards counts remaining faces from PUBLIC
data only (move log + visible next die — the seed stays secret).
Validated live by a forced-modifier match (SQL-created, future-dated
`last_move_at` so the lazy forfeit can't eat it while the probe boots):
badge, rail counts, per-tick DOM-vs-state equality, and a 24-move
bag-exhaustion finish through pvp-move v8's `s.over` guard.

### 6. Spells — the optional powers layer (2026-08-18, user feature request)

Offline games deal each seat a **rune** beside the die in play. Drag it onto
any column (or tap to arm, then tap a column, or press 1–3) and that column
swaps with the one facing it — dice, multipliers and all. **One cast per
player per game**, castable only in your own turn between the roll and the
placement: a cast is not a move, so your die still lands afterwards.

Structure, because more spells are coming:

- `core/spells.ts` — pure registry. One object per spell: id, uses, `legal()`,
  `apply(st, who, col)`. No DOM, no randomness. **Adding a spell is adding an
  object** (plus its icon path in `ui/spellicons.ts`); the rail, the gestures,
  the charge accounting and the CSS never learn its name.
- `flow/spells.ts` — the runtime: charges (`S.spellCharges`), the rail, both
  gestures, the cast animation. Every input path funnels through one `cast()`,
  so legality is asked exactly once and a spell can never half-happen.
- Charges are dealt in exactly one place (`resetSpells()` from `newGame`), so
  the layer is optional by construction: **ranked, the tutorial and the NONE
  pick all deal an empty hand**, the rail hides and every entry point no-ops.
  The empty hand is the ONE thing the runtime asks — there is no second on/off
  flag to keep in sync.
- The pick lives on the OFFLINE setup screen under the game mode, and it *is*
  the game-mode component: `boot.pickerRow()` builds both rows (hued icon
  strip + the line naming the current choice), differing only in their item
  list and where the value lives. Each slice wears the same rune
  `ui/spellicons` draws in-game, so picker and rail cannot disagree. NONE is
  the first slice and the default — spells are part of choosing what game this
  is, not a device preference. Ranked can never cast — the server validates by
  replaying a plain move log through `core/rules`.

Two rules the flow had to learn: a swap can fill **either** grid (placement
can only fill the mover's, which is why `place()` checks just that one), so
`cast()` asks both and ends the game if either is full; and `renderSide`
reuses a die element whose face matches, inline styles included — the flying
copies' `visibility:hidden` is cleared *after* the repaint, never before
(same trap as the `.dying` survivors in test13). Gates: `tests/spells.test.ts`
(pure rules) and `tests/test14.mjs` (both gestures, spent-charge accounting,
computed-pixel visibility, endgame-by-swap, and that OFF restores the old
table exactly). The CPU does not cast — v1 boundary, not an oversight.

## Standing rules (learned the hard way)

- **Never lower the game-finish loop budgets** in test6/test8/test10
  (900–1200 ticks). Three CI flakes proved 300–400 is not enough.
- **Never push a red gate** — Cloudflare deploys `main` immediately, without
  waiting for GitHub CI.
- **`core/` stays pure** — it runs in browser, Node (test gate) and Deno
  (Edge Functions) unmodified.
- **External dashboards are Johannes' domain** — Cloudflare, Supabase
  dashboard, registrars. The repo side prepares; he clicks. (Supabase via
  the connected MCP is the sanctioned exception.)
- **`supabase/migrations/` mirrors what's applied** — keep it that way.

## The ladder (LIVE — docs/LADDER.md is spec AND shipped design)

`docs/LADDER.md`: ladder points starting at **0** on a ×5 scale, a win always
paying more than a loss takes, seven groups whose widths grow ×1.35, a
**positional** apex (NEON = top 1%), seasons built now and shown later. Every
number in it was measured against 800–900 simulated players rather than
chosen. Two findings worth knowing even if the plan changes: **raising K does
not widen the rank range** (K 32→200 moved p10–p90 only 670→1049 while
fidelity fell 0.918→0.838 — scaling the display is what widens it, for free),
and **the logistic denominator must scale with the points** (400 instead of
2000 costs 8 points of fidelity).

### Bots play their rank (2026-08-20 evening, user report)

Player report: "the bots are much too strong in STONE — I'm losing more than
winning." Replaying all nine of his ranked matches from their seeds proved the
bots were NOT strong — they verifiably played the weakest configured shape
(depth-1 agreement 80%, falling with depth; ~20% blunders). What was real:

- **The floor was no floor.** The weakest shape still beat a random mover
  63.5% — measured — because the un-slipped half of a depth-1 greedy takes
  every kill; even 90% slip only reaches random-parity.
- **The percentile bands quantized on a 17-row season** (13 seeded bots, 4
  humans): the "genuinely simple" bottom band ended at ~99 points, a third of
  the way through STONE.
- **The rank badge lied**: difficulty was keyed to the HUMAN's percentile, so
  a 98-point and a 784-point bot played identically — and matchmaking's
  sparse-band widening (±2625) sat a STONE player across IVORY-labeled bots.

The fix is the **honest-opponent model** (LADDER.md §4, rewritten): each
group's bot shape lives in the `GROUPS` registry (`botShapeAt`), a new `oppW`
eval knob in `core/ai.ts` makes the STONE bot destroy-blind (the only way
below random-parity: it never AIMS a kill), and `pvp-join` caps bot pairing
and minting to the player's own group width (`botPairBand`). Bot ratings
drift through real settles, so labels stay honest by construction. All seven
shapes tuned by simulation (STONE 50% vs random, climbing to NEON ≈ 80% and
59% vs the offline Medium); `tests/botbench.test.ts` — seeded, deterministic
— gates the ordering.

Shipped as pvp-move v13 / pvp-join v16 / pvp-claim v10 (the last only to keep
its core copy identical). Verified live with a throwaway guest: paired with
the 98-point STONE bot (cap holds), which took only 1 of 4 available destroys
and lost 65–16 to a medium policy; scores, deltas and cleanup all exact.

**Migration 0024** rode along, found by that live probe: `profiles.rating`
still DEFAULTED to 1000 (the old Elo centre) for every signup since the
cutover — under the new model that would have handed every newcomer an
IVORY-strength first bot. Default is 0 now; stale mirrors re-mirrored from
`season_ratings`.

**The COLSHIELD follow-up (2026-08-21)** closed this pass's open chip: the
risk model's shield-skip — true as a fact — made the searcher WEAKER (44.5%
vs a mode-blind twin, 6,000 games), because closing a column deleted its k²
risk from the eval and the bot slammed columns shut on junk; the eval has no
term for the triples a closed column forfeits, and classic phantom fear was
that term's accidental proxy. The skip is cut (`riskOf` scores colshield
like classic; the search keeps true shield dynamics, measured neutral), and
botbench §4 refuses its return. Two artifacts from the same dig: botbench
now seeds mulberry32 (the old MINSTD LCG swung deterministic-pair duels ±7pp
between streams), and the deep groups sample 150-250 games (the apex's
ordered-ladder check had been riding an SE of ~6pp). Redeployed as pvp-move
v15.

**Verified live (2026-08-21 morning).** The evening's whole server surface,
byte-diffed and probed: deployed bundles fetched and diffed against the repo
(pvp-join v17 byte-identical to d87e700; pvp-move v15 = this fixed core plus
the away-turns `index.ts` — see the table's CAREFUL); function logs show zero
non-200s across the window; botbench green on exactly this core. Two
throwaway-guest probes each played a full bot match: v17 hands over names,
ratings AND avatars and the STONE pair-band cap holds; a too-early `auto`
gets its 425, a 13s-stalled own seat gets served with the bot answering
in-request, and the settle paid +80/−60 — the 0.75 loss asymmetry exactly.
Both guests deleted themselves; queue, profiles and season rows all empty
after.

## Open items

### 1. SMTP → real signups (next up, user-side)

Decided: **Resend**, sending from a subdomain of `ecommercewerke.de`
(the sender domain is independent of where the game lives; swappable after
the rename). Remaining steps: create the Resend account, verify
`mail.ecommercewerke.de` (3 DNS records), create an API key, enter it in
Supabase → SMTP Settings, raise the auth email rate limit, and set the Site
URL to `https://knucklebones-asg.pages.dev`. Then a live signup test
(`jor+kbtest@…`) proves the loop.

### 2. Name + app id (gates the store stage)

The word "knucklebones" is the ancient dice game — but this *ruleset* is the
minigame Massive Monster invented for Cult of the Lamb. Research findings
(2026-08-17):

- Devolver/Massive Monster sell an **official licensed physical dice game**
  under exactly this name (Level Up Dice) — they use the name as a brand in
  the dice-game category.
- Several standalone "Knucklebones" apps have lived on the stores for years
  (incl. one with ranked PvP), with no takedown history found. Tolerated so
  far, not endorsed.

Domain availability (registry RDAP/whois, checked 2026-08-17):

| Keeping the name | Renaming |
|---|---|
| ✅ knucklebones.gg | ✅ diebreaker .gg + .com |
| ✅ knuckle.games | ✅ knuckleduel .gg + .com |
| ✅ knucklebones.games / .game / .dev / .fun / .online | ✅ boneduel .gg + .com |
| ✅ neonknucklebones.com | ✅ rattlebones.gg (.com taken) |
| ✅ playknucklebones.gg, kbones.gg | ✅ neonbones.gg (.com taken) |
| ❌ .com/.net/.app/.io/.de taken | ✅ astragali.gg, talus.gg |

Note: RDAP "unregistered" ≠ cheap — registries flag some dictionary words as
premium; the registrar checkout shows the truth. Whatever the decision, run a
real trademark check (EUIPO/USPTO, classes 9/41) before store submission.
Decision: **open**. The app id placeholder in `src/config.ts` stays invalid
until decided.

### 3. Store stage (after the name)

Capacitor wrappers for iOS + Android, Sign in with Apple (required if any
other OAuth is offered), in-app account deletion (already implemented
server-side via `account-delete`), privacy policy for both stores.

### 5b. Identity, the dial, and the things the law wants (2026-08-19/20)

- **Guest accounts (identity rung 1).** A first tap on RANKED signs the player
  in anonymously — no email, no form. This cost NO schema: anonymous users
  take the `authenticated` role, so `handle_new_user()` and all five RLS
  policies already covered them (read before trusting, then verified live —
  a guest joined ranked and matched a bot). `online/session.ts` holds the
  ladder: an existing session wins; otherwise a guest is minted, *unless*
  `knucklebones.online.attached` says this device once had a real account,
  in which case signing out means they meant to sign back IN.
- **The mode dial replaced the pie wheel.** Six alternatives were drawn as
  design cards; B (orbit dial) won. It lives in `ui/modedial.ts` with its CSS
  in `main.css` — offline-reachable, because the offline game must never pull
  the online chunk to see it. It must not spoil itself: nodes flare as the
  comet crosses them, the winner is exactly as dark as the rest until found,
  the centre pulses in nobody's colour, and the name stays blank until the
  comet stops. Geometry is three tokens (`--dial`, `--r-in`, `--r-out`), which
  is what finally fixed the comet reading flat.
- **RANDOM is an offline choice too**, and CLASSIC's weight moved 50% → 40%
  (measured at 39.91% over 200,000 draws).
- **The first-run offer.** Before a newcomer's first real game — offline or
  ranked, never the tutorial itself — the game asks whether to play the
  tutorial. `S.played` is the flag, backfilled for anyone with a record. The
  tutorial ends on **Finish**, not Play again.
- **HOW TO PLAY is a hub**, not a link: tutorial, rules, game modes, spells,
  behind one door, with the tutorial highlighted only while nothing has been
  played. CPU is called **AI** everywhere.
- **Impressum and Privacy** ship as in-app sheets in the home footer. The
  company details are still `[BRACKETED]` — see Open items.
- **An absent opponent no longer stalls the match** (user-reported). The
  waiting client asks `pvp-move` with `auto:true`; the SERVER checks its own
  clock (`AUTO_MS` = 12s) and places a legal die *for the absent player*, so
  neither a wrong device clock nor a hostile client can force it early. The
  in-match line narrates it ("X is away — playing for them in N") instead of
  going silent for 25 seconds. Verified live with two throwaway guests:
  `not-stalled-yet` immediately, the auto-place after 13s, the turn flipping
  back, repeated over four rounds. Both guests deleted themselves afterwards.

### 5e. One name, forever (2026-08-20 night, user request)

The always-there Nickname field became a **one-time claim**. Signup still
mints a placeholder (`generate_nickname`); the profile now shows it as a
headline under the ring, with a cyan claim card — guestbox shape, ask-card
confirm — offering ONE rename. Migration 0026 makes the rule law at the row:
`named_at` is stamped by a `BEFORE UPDATE OF nickname` trigger and any later
change raises, so a curious REST call gets the same no the UI gives (verified
live with a rollback probe). Uniqueness was already law
(`profiles_nickname_lower_idx` → "That name is taken"). Once claimed the card
is GONE — not disabled — and the headline is all that remains of the name UI.
`session.rename()` became `claimName()`; test16 asserts every state the
player can see (fresh offer, empty-input-with-placeholder, spent claim, and
the claim walked end-to-end against a stateful mock).

The review pass on the diff caught and fixed: the shared ask-card could open
UNDER overlays injected after it (one z-index, DOM order paints — ask() now
re-appends itself every open, pixel-tested in test16); the sign-in panel
still promised "change it any time"; the privacy sheet called the nickname
merely "generated". A guest who claims a name is then offered the way up
("Keep NAME forever?" → the attach panel) through the same ask-card.
Migration 0027 pins `lock_nickname()`'s search_path and carries the
moderation runbook — cleaning an offensive claimed name is a documented
two-step in SQL, deliberately not an API path. Open question, decided "allow"
for now: guests can spend a claim, so abandoned devices hold names; a stale
reaper or attach-only claiming are the options if squatting ever hurts.

### 5c. The ladder states both sides (2026-08-20)

Player report: the leaderboard showed a W and no L. It printed `42W/103` —
wins over *games* — so a loss appeared nowhere on it, while the HUD and the
account card had always said W · L. Migration **0015** adds `losses` to the
`leaderboard` RPC, counted the way `myRecord()` counts it client-side: a
decided match this profile did not win. A draw (`winner is null`) is neither,
and a forfeit does name a winner, so it lands on the right side by itself.
`wins + losses + draws = games` is the invariant that keeps a row auditable.
(The return type changed, so the migration drops and recreates — which also
takes the grants and the PUBLIC revoke with it, both restated; the resulting
ACL is byte-identical to before.)

The three screens then went through **one** formatter, `ui/record.ts`: they
were saying the same fact in three phrasings, which is how one of them came to
say only half of it. The numbers carry `.n1`/`.n2` rather than leaning on bare
`<b>`/`<i>`, because the HUD tinted them with `.rec b` / `.rec i` — so the same
markup would have rendered *italic* on the ladder, where that rule does not
reach. test16 grew a ladder case (its harness takes the door as a slot now)
that reads the rendered row, since the original bug was invisible to anything
inspecting only the data.

### 5d. The board rework (2026-08-20)

Two things, same evening, same screen:

- **The live ladder printed `undefined` for every points value.** Migration
  0015→0018 renamed the RPC's column `rating` → `points`; the client interface
  and test16's route mock both still spoke the old shape, so the gate stayed
  green while production broke — the mock had drifted from the migration.
  Fixed, and test16 now reads the POINTS off the rendered row, so the client
  and the RPC can never silently disagree about a column name again.
- **The board itself was rebuilt** (design study 33a–33h, eight alternatives;
  Johannes picked L7's you-centred reading on L1's full scroll, with L5's
  face-off as the tap). What ships: one continuous list NEON→STONE with a
  labelled **horizon** wherever the group changes; every row carries the
  player's die (0022 added `avatar`+`peak` to `leaderboard()`, 0023 spread the
  bots across the avatar space); for a signed-in reader every row states the
  **gap to them** — magenta above, cyan below, never a payout — and their row
  is the big one the list opens centred on. **Tapping a player deals a
  face-off**: their column against yours, five facts mirrored (points, record,
  best streak via the new public `player_card()` RPC — 0021's `best_streak()`
  is now a delegate of it — peak, win rate), one-column when signed out.
  `boardGroup()` in `core/ladder.ts` decides what a row displays: only the
  RPC's apex flag can grant NEON, because the apex is a rank, not a threshold.
  Two lessons paid for on the way: the face-off first rendered at z-index 60
  **under** the board overlay (z 80) — rect present, pixels absent — so test16
  asks `elementFromPoint` now, not `getBoundingClientRect`; and the design
  build's collision guard silently skips ~every other CSS rule (regex consumes
  the boundary brace), which is how a study card wore the mode dial's `.dhead`
  glow undetected — fix chip filed.

### 6. The navigation batch (2026-08-20)

Four moves, each putting a control where its context makes sense:

- **The HUD's gear became a question.** It used to open Settings, which
  mid-match offers nothing you want — sound and dice faces are not what you
  reach for with a board on the line — and hid the exit at its bottom behind
  a two-tap arm. It now opens ONE ask-card: *Quit this game?* offline,
  *Forfeit this match?* when a rating is live. `leavingForfeits()` in
  `flow/leave.ts` is the single source of that distinction, so the copy can
  never claim the wrong stake.
- **Home's Account button became Settings**, opening that sheet from the one
  place where nothing is at stake.
- **The identity chip is the account door.** It already shows who you are and
  what you are rated; tapping it opens the rest.
- **The build tag moved to the foot of Settings** — the screen you open when
  something looks wrong should tell you which build is wrong.

`.firstcard` became `.askcard` (the quit modal already reused it, so the name
had stopped describing its rosters) and `.homefoot` became `.viewfoot` (home's
legal links, settings' build tag — one strip, two rosters).

Finished the next day on player report: the HUD glyph was still a **sliders
icon**, promising a Settings screen it no longer opened — it is a doorway with
an arrow leaving it now, `#btnSettings` became `#btnLeave`, and the glyph lives
in the new `ui/chromeicons.ts` so the three design cards that had copied it
render the app's own. In the ask-card, **the way back wears the colour**: the
gradient sits on *Keep playing* at the smaller size, while the destructive
answer is full width and quiet. Settings also lost its **How to play**
button — HOW TO PLAY is a hub off Home now, and the sheet had been a third
door to the same rules. What is left is two toggles and the build tag.

Hunting that down turned up a real defect: **`.btn.ghost` was defined only in
`online/online.css`**, the lazily-imported chunk — so the offline first-run
offer's "Skip, I know the rules" rendered as a solid button for every newcomer
on a PWA or native install, and the single-file build (which inlines
everything) hid it. The rule moved to `main.css`, and `tests/cssreach.test.ts`
now fails the gate on any offline markup that names a class only the online
stylesheet defines.

### 8. The loading die (2026-08-20 night, user pick from the LD1–LD8 studies)

Eight loading-animation studies shipped as design cards 34a–h (group "3c ·
Loading studies") plus 35-ios-launch; Johannes picked **LD1, the pip clock**
— the die face IS the spinner — as the ONE loader, inline and full-page.
`ui/loader.ts` (loaderDie/loaderWait) builds it on `makeDie`, the app's single
die factory; the animation lives in `main.css` because the biggest wait is
the online chunk itself still downloading, when online.css does not exist
(the `.btn.ghost` lesson). Wired everywhere the audit found a naked wait:

- **The three online doors** (`boot.ts` goOnline): `#ovLoad` goes up before
  the `import()` and `panel()` relieves it — one overlay covers the chunk
  download AND the `ensureIdentity` round-trip (the guest-minting dead air),
  and re-taps in flight are no-ops instead of queued double-opens.
- **Ladder** (showBoard): the two bouncing qdice replaced by the loading die.
- **Match history** (showHistory): the bare "Loading…" text row replaced,
  and the loader now covers BOTH fetch batches, not just the second.
- **Avatar picker** (showAvatar): the preview slot carries the first-open wait.

Deliberately untouched: **matchmaking** (its designed queue panel stays until
the LD8 duel-clash v2 — which needs a resolution beat when the opponent's
name lands, and must not fight the clock for attention), **the profile**
(cached-paint anti-flicker choreography is better than a spinner), **the
result screen** (optimistic paint), and **in-match waits** (the turn clock
carries them). The rolling die (LD6) stays in the drawer until a wait with a
direction exists (e.g. a determinate update/download).

### 7. Cards render the app, they no longer transcribe it (2026-08-20)

`design/build.mjs` imports `src/` directly (Node ≥22.18 strips the types) and
expands tokens from the app's own functions: `{{mico}}` / `{{mhue}}` from
`ui/modeicons.ts`, `{{dialnodes}}` from `ui/modedial.ts`, `{{library}}` and
`{{picker}}` / `{{pickinfo}}` from `ui/library.ts`.

Before this, the card sources held **122 hand-copied icon SVGs across 12
cards**; card 05's own comment said "the card carries its own copies […] keep
them in sync", and card 25 re-typed every mode's icon, hue, name, one-liner
and full rule — a fifth copy of `core/modes.ts`. Card 40's picker had already
drifted: it was still missing RANDOM days after the app offered it. Card 71
was the worst — the orbit dial won its study and shipped, and the card kept
a 77-line private re-implementation of a live screen.

Three seams opened in the app to allow it, each already single-purpose but
locked inside a DOM builder: `dialNodes()`, `libraryCards()`, and
`MODE_PICKS` / `SPELL_PICKS` / `pickerButtons()`. `boot.ts`'s `pickerRow` had
both rosters inline; it consumes the shared ones now, so the reference sheet
and the pick row agree on what a mode is called *by construction*.

### 5. The navigation pass (2026-08-18)

One model, app-wide (spec: the `00-navigation` design card): **pages** you
travel into from Home (Practice, Sign in, Ladder, Account) wear a `‹` in the
HUD's icon-button style top-left and always return Home; **sheets** floating
over live context (Settings, How to play, Install) wear a top-right `✕`
(reading sheets keep one bottom GOT IT; Settings lost its Done and the
retired Reset-record button). The bottom of every screen holds actions only,
exactly one primary. The shared `.shead` header lives in `src/styles/main.css`
and the design cards ride it by construction.

Online IA flattened: the ONLINE menu panel is gone — Home *is* the online
menu, deep links go straight to their panel, and sign-in continues to
wherever the tap was headed. Matchmaking got its design screen (bouncing
dice, honest clock, widening message) and **Cancel is the only exit — it
truly leaves the queue**, closing a real hazard where dismissing the overlay
kept the poll running and could yank the player into a match from Home.
Match results land on a proper Result screen (scores, Elo delta chip, fresh
ladder rank, Play again / Home) instead of text glued onto a menu. The Account
panel grew its identity card (die, nickname, member-since, rating, lifetime
record). *(The in-match exit described here — `≡` → `✕`, then a two-tap
forfeit arm inside the Settings sheet — was superseded on 2026-08-20 by the
quit ask-card; the Install sheet was retired the same day, the native clients
make it noise.)*

### 4. Done in the 2026-08-17 polish pass

- Minification ON in every build target (single file 826→285 KB, online
  chunk 735→220 KB). Fragment sanity needles reworked to survive it.
- Design cards 10/11/40 now ride the shared HOME CSS; DESIGN.md questions
  answered in place.
- PWA install experience: footer link + Chrome prompt + iOS explainer.
- **Leaving loses, vs bots too** (user-reported): pvp-join v3 forfeits an
  abandoned bot match lazily at next matchmaking contact — same 60s rule
  a human opponent enforces via pvp-claim. Verified live.
- **10s online turn clock** (user request): visible both sides, reuses the
  practice timer machinery (explicit-seconds mode); my expiry auto-places
  a random legal column, opponent expiry shows "waiting" (60s forfeit is
  the absence backstop). Beware the `secs` shadowing TDZ that bit here.
- **Optimistic move animation** (user-reported delay): the die animates in
  parallel with the pvp-move request; log slot claimed up front; server
  rejection falls back to full resync. e2e-pvp-ui.mjs updated for the
  online-first flow (sign-in deep-links straight into the queue).
