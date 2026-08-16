# Knucklebones — Neon Edition

A mobile-first Knucklebones dice duel — installable PWA, offline-capable, with
a self-play-tuned expectimax CPU, a scripted tutorial, and two local
two-player seatings (pass-the-phone and face-to-face).

## Layout

```
src/
├── config.ts        # game name, app id (TBD placeholder), BoardSpec, dice
├── core/            # rules.ts + ai.ts — PURE game logic, no DOM
├── state.ts         # the S state object + typed vocabulary
├── persist.ts       # stats + in-progress save (corrupt blobs rejected)
├── ui/              # dom, die, render, fx, input, layout, audio, identity, embed
├── flow/            # game (turn state machine), menu, timer, tutorial
├── boot.ts          # wiring; hooks.ts — the test-hook surface
└── main.ts / widget.ts   # entry points: page vs embeddable widget
public/              # manifest, icons, sw.js template — copied into builds
index.html           # page shell (static no-JS overlay lives here)
```

`core/` must keep running outside the browser — a server-side score validator
imports it verbatim. Nothing in `core/` may touch the DOM, timers or
`Math.random` (the AI's tie-break jitter is the one deliberate exception,
and it never affects replayed scores).

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
| `pwa/` | chunked, hashed assets | the hosted build — deploy this folder |
| `knucklebones-neon.html` | single file | standalone: open it anywhere, even from a USB stick |
| `native/www/` | single file + assets | Capacitor web assets |
| `widget.html` (+`harness.html`) | fragment | inline-embeddable widget + its test page |

The widget is a second entry point sharing every module — its differences are
`isEmbed()` branches and `widget-embed.css` overrides. There is no post-build
patching of code anywhere; the build asserts every transformation it makes.

## Deploy

Host `pwa/` anywhere static. Hard-won notes:

- **Netlify Drop creates a NEW site per drop.** To update an existing URL, log
  in and drag the folder onto that site's *Deploys* page.
- The page is served network-first by the service worker, so a deploy shows up
  after a single app relaunch. Verify with the build tag at the bottom of the
  title screen — it must match what `npm run build` printed.
- The service-worker cache key and precache list are generated per build;
  never edit `pwa/sw.js` by hand (edit `public/sw.js`, the template).

## Test

```bash
npm test            # builds, then runs all ten Playwright suites + the bench
```

Suites assert behaviour (state↔DOM reconciliation, input semantics, turn
indication, tutorial script adherence, PWA install/offline/update), not
pixels. Game-completion loops use deliberately generous budgets — random
destruction-heavy endgames run long, especially on CI.

## Things to know before touching certain code

- **`colScore`/`countOf` (core/rules.ts) are the AI's hot path** (millions of
  calls per move). Hard upgrades 4-ply → 5-ply search only if 4-ply finished
  within 18 ms — slowing scoring quietly weakens the CPU on mid phones.
  Benchmark with `node tests/bench3.mjs`; ignore the first (JIT-cold) run.
- **Player index is identity** (1 = cyan/P1, 0 = magenta/P2); which half of
  the screen a player occupies is `S.bottom`, resolved via `sideKey()`. Never
  assume P1 is at the bottom — pass mode swaps halves, face mode doesn't.
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
  its member names stable.

## Native (iOS / Android)

The Capacitor wrapper is not checked in (generated, heavy). Recreate with
`npm i @capacitor/core @capacitor/cli @capacitor/ios @capacitor/android`,
`npx cap add ios android`, then `npm run build && npx cap sync`. The app id
is deliberately an invalid placeholder in `src/config.ts` until the real one
is chosen. iOS requires a Mac with Xcode.

## Fair warning

Knucklebones is the dice minigame from *Cult of the Lamb* (Massive Monster /
Devolver Digital); this project borrows the name and ruleset. Fine for
personal use — get real legal advice and choose a new name before publishing
or monetising.
