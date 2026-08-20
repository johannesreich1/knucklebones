# Project Status

*Last updated: 2026-08-20. This is the "where do we stand" document — the
README explains how the project works; this file records what exists, what
was decided, and what's still open.*

## Production state, right now

| Piece | State |
|---|---|
| **Web** | **LIVE** at https://knucklebones-asg.pages.dev — Cloudflare Pages, auto-deploys every push to `main` |
| **Backend** | Supabase project `euzjcejbkxvqfrttgaxu` (EU) — schema through migration 0013, RLS + column-grant hardened. 0014 (Game Center ids) is written but NOT applied — it waits for a device |
| **Edge Functions** | `pvp-join` v13, `pvp-move` v10, `pvp-claim` v7, `account-delete` v1 — all ACTIVE, nothing dead deployed. `gc-auth` is written but undeployed (same reason) |
| **CI** | GitHub Actions: build + full test gate (23 suites) on every push — green through current `main` |
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
answer is full width and quiet.

Hunting that down turned up a real defect: **`.btn.ghost` was defined only in
`online/online.css`**, the lazily-imported chunk — so the offline first-run
offer's "Skip, I know the rules" rendered as a solid button for every newcomer
on a PWA or native install, and the single-file build (which inlines
everything) hid it. The rule moved to `main.css`, and `tests/cssreach.test.ts`
now fails the gate on any offline markup that names a class only the online
stylesheet defines.

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
