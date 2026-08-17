# Knucklebones — Neon Edition

A mobile-first Knucklebones dice duel. Installable, offline-capable PWA with a
self-play-tuned expectimax CPU, a scripted tutorial, two local two-player
seatings (pass-the-phone and face-to-face) — and **ranked online PvP** on a
server-authoritative backend with an Elo ladder.

**Live:** https://knucklebones-asg.pages.dev · current state and open
decisions: [docs/STATUS.md](docs/STATUS.md)

## Layout

```
src/
├── config.ts        # game name, app id (TBD placeholder), BoardSpec, dice,
│                    # Supabase URL + publishable key (public by design)
├── core/            # PURE shared logic — no DOM, runs in browser/Node/Deno
│   ├── rules.ts     #   board ops + scoring
│   ├── ai.ts        #   expectimax CPU (doubles as the server's bot)
│   ├── dice.ts      #   seeded PRNG, bit-identical across runtimes
│   ├── match.ts     #   rebuild any board from a move log
│   └── elo.ts       #   rating math (K=32, start 1000)
├── state.ts         # the S state object + typed vocabulary
├── persist.ts       # stats + in-progress save (corrupt blobs rejected)
├── ui/              # dom, die, render, fx, input, layout, audio, identity, embed
├── flow/            # game (turn state machine), menu, timer, tutorial
├── online/          # lazy chunk: session (API), ui (auth/ladder/account/queue),
│                    # play (online match driver reusing the local board + animations)
├── boot.ts          # wiring; hooks.ts — the test-hook surface (window.__kb)
└── main.ts / widget.ts   # entry points: page vs embeddable widget
supabase/            # migrations (mirrors of what's applied) + Edge Functions + DESIGN.md
design/              # every screen as a live card, built from the app's real CSS,
                     # synced to the Claude Design project (see design/build.mjs)
public/              # manifest, icons, sw.js template — copied into builds
index.html           # page shell (static no-JS overlay lives here)
```

`core/` must keep running outside the browser — the Edge Functions import it
**verbatim** to replay and validate every online move server-side. Nothing in
`core/` may touch the DOM, timers or `Math.random` (the AI's tie-break jitter
is the one deliberate exception, and it never affects replayed scores).

## Online play, in one paragraph

Ranked = online PvP only; practice never touches ratings. The server is the
single authority: clients submit only `{match_id, col}`, the dice seed lives
in a service-only table, and `pvp-move` rebuilds the board from the
die-carrying move log on every request — a hacked client can lose stylishly
but cannot cheat. When matchmaking finds no human within ~7s, a server-side
bot (same `core/ai.ts`, disguised behind a generated nickname) takes the
seat; bot games rate the human, bot accounts never appear on the leaderboard.
Stalls forfeit after 65s via `pvp-claim`. The whole online client is one
lazy-loaded chunk — the offline game's boot path never depends on it.

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
npm test            # builds, then runs the full gate (tests/run-all.mjs)
```

The gate runs the pure-core determinism/replay checks under plain Node, all
Playwright behaviour suites, and the AI benchmark, and fails on any problem
in any suite. Suites assert behaviour (state↔DOM reconciliation, input
semantics, turn indication, tutorial script adherence, PWA
install/offline/update), not pixels.

**Game-completion loops use budgets of 900–1200 ticks on purpose.** Random,
destruction-heavy endgames run long and CI runners are slow — 300–400-tick
budgets have flaked on CI three separate times (test6, test8, test10). Never
"optimize" these down.

## Design system

`design/screens/*.html` holds every screen as a hand-written card body;
`node design/build.mjs` inlines the app's **real** CSS, expands
`{{die:V:p1|p2|gold:size}}` placeholders into genuine die markup, emits each
card at four device sizes (small phone / standard / pro-max / tablet) and
writes the `_ds_manifest.json` that the Claude Design pane reads. The pane
renders only what the manifest lists — always let the builder regenerate it.

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
  see the note atop `src/styles/main.css` before adding a new board shape,
  and re-tune AI depth budgets (`bench3`) for any new spec.
- **`window.__kb`** (src/hooks.ts) is the test suites' driving surface — keep
  its member names stable. Suites reach the relocated local-play controls via
  `__kb.openPractice()` / `__kb.goHome()`.

## Native (iOS / Android)

The Capacitor wrapper is not checked in (generated, heavy). Recreate with
`npm i @capacitor/core @capacitor/cli @capacitor/ios @capacitor/android`,
`npx cap add ios android`, then `npm run build && npx cap sync`. The app id
is deliberately an invalid placeholder in `src/config.ts` until the real one
is chosen. iOS requires a Mac with Xcode.

## Fair warning

Knucklebones is the dice minigame from *Cult of the Lamb* (Massive Monster /
Devolver Digital); this project borrows the name and ruleset. The rename
decision — with market research and available domains — is tracked in
[docs/STATUS.md](docs/STATUS.md). Get real legal advice before store
submission or monetisation.
