# Project Status

*Last updated: 2026-08-17. This is the "where do we stand" document — the
README explains how the project works; this file records what exists, what
was decided, and what's still open.*

## Production state, right now

| Piece | State |
|---|---|
| **Web** | **LIVE** at https://knucklebones-asg.pages.dev — Cloudflare Pages, auto-deploys every push to `main` |
| **Backend** | Supabase project `euzjcejbkxvqfrttgaxu` (EU) — schema through migration 0008, RLS + column-grant hardened |
| **Edge Functions** | `pvp-join` v2, `pvp-move` v3, `pvp-claim` v2, `account-delete` v1 — all ACTIVE, nothing dead deployed |
| **CI** | GitHub Actions: build + full test gate on every push — green through current `main` |
| **Design system** | 37 cards (all screens × 4 device sizes) in the Claude Design project "Knucklebones", generated from the app's real CSS |
| **Signups** | **Not yet open to the public** — SMTP not configured (see Open items) |

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
