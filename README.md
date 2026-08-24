# Knucklebones — Neon Edition

A mobile-first Knucklebones dice duel. Installable, offline-capable PWA with a
self-play-tuned expectimax CPU, a scripted tutorial, two local two-player
seatings (pass-the-phone and face-to-face) — and **ranked online PvP** on a
server-authoritative backend with a seasonal points ladder.

**Live:** https://knucklebones-asg.pages.dev · current state and open
decisions: [docs/STATUS.md](docs/STATUS.md)

## Layout

```
src/
├── config.ts        # game name, canonical app id, BoardSpec, dice,
│                    # Supabase URL + publishable key (public by design)
├── core/            # PURE shared logic — no DOM, runs in browser/Node/Deno
│   ├── rules.ts     #   board ops + scoring
│   ├── ai.ts        #   expectimax CPU (doubles as the server's bot)
│   ├── dice.ts      #   seeded PRNG, bit-identical across runtimes
│   ├── match.ts     #   rebuild any board from a move log
│   └── ladder.ts    #   ladder points, groups, deltas, bot rank policy
├── state.ts         # the S state object + typed vocabulary
├── persist.ts       # stats + in-progress save (corrupt blobs rejected)
├── ui/              # shared game view/motion, DOM, input, layout, audio, embed
├── flow/            # game (turn state machine), menu, timer, tutorial
├── online/          # lazy auth/ladder/match APIs and ranked screen controllers
├── boot.ts + boot/  # typed composition and focused browser bindings
├── hooks.ts         # the stable test-hook surface (window.__kb)
└── main.ts / widget.ts   # entry points: page vs embeddable widget
supabase/            # immutable migration ledger + Edge Functions + design history
design/              # every screen as a live card, built from the app's real CSS,
                     # synced to the Claude Design project (see design/build.mjs)
public/              # manifest, icons, sw.js template — copied into builds
index.html           # page shell (static no-JS overlay lives here)
```

`core/` must keep running outside the browser — the Edge Functions import it
**verbatim** to replay and validate every online move server-side. Nothing in
`core/` may touch the DOM or timers. Authoritative replay/scoring use explicit
seeded inputs; local dice and AI randomness must stay outside those outcomes.

## Online play, in one paragraph (and a dial)

Every ranked match reveals its mode before play. The roster, rules, and
production weights live in [`src/core/modes.ts`](src/core/modes.ts); do not
copy their current values into documentation. The dial is aimed theater: the
mode is a deterministic server-side draw from the match seed, stored on the
match, and enforced end-to-end in replay validation, scoring, ladder changes,
and bot search. Practice is always classic.

Ranked = online PvP only; practice never touches ratings. The server is the
single authority: clients submit only `{match_id, col}`, the dice seed lives
in a service-only table, and `pvp-move` rebuilds the board from the
die-carrying move log on every request — a hacked client can lose stylishly
but cannot cheat. When matchmaking needs to backfill the pool, a server-side
bot (same `core/ai.ts`, disguised behind a generated nickname) takes the
seat; bot games rate the human, bot accounts never appear on the leaderboard.
Absent-human auto-play and forfeits are enforced against server time by the
Edge Functions; their constants, not prose, are authoritative. The whole
online client is lazy-loaded, so the offline boot path never depends on it.

## Develop

```bash
npm install
npx vite            # dev server with hot reload
```

## Build

```bash
npm run build       # = node build.mjs
```

Produces, with one content-derived build hash stamped into everything:

| artifact | shape | purpose |
|---|---|---|
| `pwa/` | chunked, hashed assets | the hosted build — this is what production serves |
| `knucklebones-neon.html` | single file | standalone: open it anywhere, even from a USB stick |
| `native/www/` | single file + assets | Capacitor web assets |
| `widget.html` (+`harness.html`) | fragment | inline-embeddable widget + its test page |

The widget is a second entry point sharing every module — its differences are
`isEmbed()` branches and `widget-embed.css` overrides. There is no post-build
patching of code anywhere; the build asserts every transformation it makes.

## Deploy

Production is **Cloudflare Pages**, git-integrated: every push to `main`
builds (`npm run build`, output dir `pwa`, Node pinned by `.nvmrc`) and
deploys automatically.

- **Cloudflare does not wait for GitHub CI** — never push a red gate to
  `main`. Run `npm test` first, always.
- The page is served network-first by the service worker, so a deploy shows
  up after a single app relaunch. Verify with the build tag on the home
  screen — it must match what `npm run build` printed.
- The service-worker cache key and precache list are generated per build;
  never edit `pwa/sw.js` by hand (edit `public/sw.js`, the template).
- `wrangler.jsonc` exists for Cloudflare's Workers-style git flow; classic
  Pages ignores it (harmless build-log warning). `pwa/` also still hosts fine
  on any static host.

## Test

```bash
npm test                                # full application gate
npm run db:start                        # fresh database-only Supabase stack
npm run test:db                         # pgTAP database contracts
```

The gate runs pure-core determinism/replay checks under plain Node, Playwright
behaviour suites, architecture contracts, design checks, and the AI benchmark,
and fails on any problem. Player-visible suites deliberately assert computed
pixels, hit testing, and animation where DOM/state agreement cannot prove what
the player sees.

CI separately starts a fresh local Supabase stack, applies the immutable
migration ledger, runs every pgTAP contract, and lints the resulting schema.

**Game-completion loops use budgets of 900–1200 ticks on purpose.** Random,
destruction-heavy endgames run long and CI runners are slow — 300–400-tick
budgets have flaked on CI three separate times (test6, test8, test10). Never
"optimize" these down.

**Two sessions can gate at the same time.** Every server the gate needs binds
a port the *kernel* picks (`tests/serve.mjs` — `serveTree()` / `servedBase()`),
so gates in different worktrees cannot reach each other's builds. The fixed
ports this replaced (8123 for `pwa/`, 8124-6 per suite) failed the bad way:
the second checkout's server lost the bind and died, and its suites were then
served the *first* checkout's `pwa/` — green or red, the answer was about the
wrong tree.

Inside ONE working tree the gate takes `.gate.lock` and a second run queues
behind it ("another gate holds this checkout — waiting for it"), because what
is shared there is the build output: `build.mjs` rewrites `pwa/` and `dist/`,
and `testupdate` rewrites `pwa/index.html` and `pwa/sw.js` mid-run. A stale
lock from a killed gate is detected by pid and taken; `KB_NO_LOCK=1` skips it.
Worktrees stay the recommendation anyway — a shared checkout gates everyone's
uncommitted work at once, so a red suite cannot tell you whose change it was.

What is still *not* isolated is the machine. Three concurrent gates flaked a
drag-timing spell suite that passed alone and passed in a parallel worktree
at the same commit; use `KB_JOBS=2` when peers are gating.

Any suite also runs on its own — `node tests/test7.mjs` starts whatever server
it needs and takes it down with the process. Nothing to launch in another
terminal first. `npm run serve` still exists for a human who wants a stable
URL to click (`node tests/serve.mjs [port]`, default 8123).

## Design system

`design/screens/` classifies hand-written card bodies as `product/`,
`studies/open/`, or `studies/archive/`; unclassified top-level cards fail the
build. `node design/build.mjs` discovers those directories recursively, inlines
the app's **real** CSS, expands the `{{…}}`
tokens into genuine markup — dice, mode and rune icons, the loading die, the
reveal's versus line, whole rosters — by importing `src/` itself, emits each
card at four device sizes (small phone / standard / pro-max / tablet) and
writes the `_ds_manifest.json` that the Claude Design pane reads. The pane
renders only what the manifest lists — always let the builder regenerate it.
The token table lives at the top of `design/build.mjs`; a card that hand-draws
something a token can render is a second implementation, and it will drift.

`design/dist/` is generated and gitignored. The builder PRUNES it: a card
deleted from the classified source tree loses its four built files and its four
manifest entries on the next build, so the manifest is always a statement
about what the repo holds right now.

### Syncing to Claude Design

The cards live in the Claude Design project **Knucklebones**. Syncing needs
the `DesignSync` tool, which needs a claude.ai design authorization — so it
runs from a session with an interactive terminal (`/design-login`), never from
a cloud session, which has none.

1. `node design/build.mjs` — never sync a stale `design/dist/`.
2. `DesignSync list_projects` → the project's id; `list_files` → what is up
   there now.
3. **Deletes are computed, not remembered**: every remote `screens/*.html`
   the fresh `design/dist/` no longer contains. A retired study card has four
   remote files (one per device size), and nothing else knows they are gone.
4. `finalize_plan` with `localDir` = `design/dist`, `writes` =
   `["screens/**", "_ds_manifest.json"]`, and those deletes.
5. `write_files` using `localPath` (never inline `data` — the bundle is large),
   then `delete_files`; both take at most 256 paths per call.

## Things to know before touching certain code

- **`colScore`/`countOf` (core/rules.ts) are the AI's hot path** (millions of
  calls per move). Hard upgrades 4-ply → 5-ply search only if 4-ply finished
  within 18 ms — slowing scoring quietly weakens the CPU on mid phones.
  Benchmark with `node tests/bench3.mjs`; ignore the first (JIT-cold) run.
- **Player index is identity** (1 = cyan/P1, 0 = magenta/P2); which half of
  the screen a player occupies is `S.bottom`, resolved via `sideKey()`. Never
  assume P1 is at the bottom — pass mode swaps halves, face mode doesn't.
- **Online concurrency is subtle.** `src/online/play.ts` documents its
  invariants inline (the `animating` gate goes up *before* the move request,
  the applied-counter is claimed *before* animating, deferred match rows
  drain in exactly one place). They were each earned through a live race —
  read the comments before restructuring.
- **Face-to-face rotates only orientation-sensitive content**; dice pips are
  180°-symmetric, so dice never rotate — keep it that way or every placement
  animation needs rework.
- **Strategy previews are tutorial-only** by design; normal play gets the
  dashed legal-column affordance and earned score popups only.
- **Board dimensions come from `BoardSpec`** (`src/config.ts`) everywhere in
  JS. The CSS `repeat(3,…)` literals are the one remaining 3×3 assumption —
  see the note atop `src/styles/foundations/tokens.css` before adding a new board shape,
  and re-tune AI depth budgets (`bench3`) for any new spec.
- **`window.__kb`** (src/hooks.ts) is the test suites' driving surface — keep
  its member names stable. Suites reach the relocated local-play controls via
  `__kb.openPractice()` / `__kb.goHome()`. The lazy online chunk cannot be
  reached from there (hooks.ts must never import it), so it publishes its own
  two on load: `__kbOnline()` introspects the live match (`online/play.ts`) and
  `__kbResult(report)` deals the Result screen without one
  (`online/result-screen.ts`).

## Native (iOS / Android)

The tracked Capacitor 8.5 shell under `native/` ships on both platforms as
**Knucklebones Neon**, while the package/bundle id remains
`com.appavaria.knucklebones`. That shell rename does not change the in-game
name, PWA metadata, URLs, or browser storage keys. Generated web payloads,
`node_modules`, Pods, Gradle output, local SDK paths, and signing secrets stay
ignored; native projects, resource catalogs, lockfiles, and Gradle wrappers are
source.

Use Node 24 on both platforms. iOS also needs a Mac with Xcode and CocoaPods.
Android local work needs Android Studio Otter or newer, JDK 21, and Android SDK
36. Install both lockfiles before the platform commands:

```bash
npm ci
npm --prefix native ci
npm run native:assets:android # regenerate tracked Android icon/splash resources
npm run native:sync:ios       # build web bytes, then cap sync ios
npm run native:open:ios
npm run native:verify:ios     # sync plus the iOS shipping contract
npm run native:sync:android
npm run native:open:android
npm run native:verify:android # sync plus the Android shipping contract
npm run native:verify         # both platforms
```

For a Play upload, copy `native/android/keystore.properties.example` to the
ignored `native/android/keystore.properties`, point it at Johannes's
owner-held upload keystore (preferably outside the checkout), and run
`npm run native:bundle:android`. The command fails when the properties or key
are absent and never substitutes the debug key. CI deliberately builds only an
unsigned, verification-only AAB; Johannes enrolls in Play App Signing with a
distinct upload key and manually uploads the locally signed bundle. No Play API
credentials or automatic publishing belong in CI. See
[the build architecture](docs/architecture/build.md) and
[identity owner steps](docs/IDENTITY.md).

## Installing the PWA

The hosted build requires HTTPS for its service worker. On iPhone, open the
live URL in Safari and choose **Add to Home Screen**. On Android, use Chrome's
**Install app** action; supported desktop Chromium browsers show an install
button in the address bar. The generated service worker and manifest come from
the build pipeline—never edit files in `pwa/` by hand.

Local preferences and in-progress local games use browser storage. Ranked
identity, profiles, match logs, and ladder records use Supabase; clearing local
site data is therefore not equivalent to deleting an online account.

## Architecture references

| Area | Guide |
|---|---|
| Frontend and shared game view | [docs/architecture/frontend.md](docs/architecture/frontend.md) |
| CSS cascade and widget isolation | [docs/architecture/styles.md](docs/architecture/styles.md) |
| Supabase and Edge Functions | [docs/architecture/backend.md](docs/architecture/backend.md) |
| Builds, PWA, widget, and native | [docs/architecture/build.md](docs/architecture/build.md) |
| Tests and release gate | [docs/architecture/testing.md](docs/architecture/testing.md) |

## Fair warning

Knucklebones is the dice minigame from *Cult of the Lamb* (Massive Monster /
Devolver Digital); this project borrows the name and ruleset. The native store
shell now says **Knucklebones Neon**, but existing legal/trademark clearance for
that listing name is still unresolved. This technical rename does not settle
it; get real legal advice before store submission or monetisation.
