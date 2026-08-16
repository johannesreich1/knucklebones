# Knucklebones — Neon Edition

A mobile-first Knucklebones dice duel as one self-contained HTML file — installable
PWA, offline-capable, with a self-play-tuned expectimax CPU, a scripted tutorial,
and two local two-player seatings (pass-the-phone and face-to-face).

## The one rule of this repo

**`knucklebones.html` is the only file you edit.** Everything shipped is generated
from it by the build:

```bash
./build.sh
```

That produces `pwa/index.html` (the hosted build, with a service-worker cache key
and a visible build tag derived from the source's md5), `knucklebones-neon.html`
(standalone copy), `native/www/index.html` (Capacitor web assets, if `native/`
exists), and `widget.html` + `harness.html` (an embeddable fragment and its test
page, via `port.py`). The build refuses to run if the source doesn't parse and
verifies every copy afterwards. Don't edit generated files — that's how copies
drift.

## Develop

No toolchain needed for the game itself: open `knucklebones.html` in a browser,
edit, reload. Debug hooks live on `window.__kb` (game state, scoring, the AI
search, and most internals).

## Deploy

Host the `pwa/` folder anywhere static (Netlify, GitHub Pages, …) after running
`./build.sh`. Two hard-won notes:

- **Netlify Drop creates a NEW site per drop.** To update an existing URL, log in
  and drag the folder onto that site's *Deploys* page.
- The page is served network-first by the service worker, so a deploy shows up
  after a single app relaunch. Verify with the build tag at the bottom of the
  title screen — it must match what `./build.sh` printed.

## Test

```bash
npm install                      # playwright (browsers: npx playwright install chromium)
node tests/test4.mjs             # duo + CPU full games, per-frame invariants
node tests/test8.mjs             # landscape, resume, slide-off cancel, a11y
node tests/test9.mjs             # tutorial pill geometry, turn clock
node tests/test10.mjs            # the scripted tutorial, end to end
node tests/test11.mjs            # score popups, settings panel
node tests/test12.mjs            # face-to-face seating, both seatings
node tests/bench3.mjs            # scoring correctness + AI search timing

python3 tests/serve.py &         # then, against the served ./pwa:
node tests/test7.mjs             # PWA install criteria + offline play
node tests/testupdate.mjs        # one-relaunch deploy pickup (mutates pwa/; re-run ./build.sh after)
```

All suites assert behaviour (state↔DOM reconciliation, input semantics, turn
indication, script adherence), not pixel snapshots. Run them from the repo root.
They should print `"problems": []` and `"errs": []`.

## Things to know before touching certain code

- **`colScore`/`countOf` are the AI's hot path** (millions of calls per move).
  Hard difficulty upgrades from 4-ply to 5-ply search only if 4-ply finished
  within 18 ms — slowing scoring quietly weakens the CPU on mid phones.
  Benchmark with `tests/bench3.mjs`; ignore the first (JIT-cold) run.
- **Player index is identity** (1 = cyan/P1, 0 = magenta/P2); which half of the
  screen a player occupies is `S.bottom`, resolved via `sideKey()`. Never assume
  P1 is at the bottom — pass mode swaps halves, face mode doesn't.
- **Face-to-face rotates only orientation-sensitive content** (plate, chips,
  numerals, popups, centre stage). Dice pips are 180°-symmetric, so dice never
  rotate — keep it that way or every placement animation needs rework.
- **Strategy previews are tutorial-only** by deliberate design; normal play gets
  the dashed legal-column affordance and *earned* score popups only.
- `port.py` patches by exact string match and **aborts if a pattern stops
  matching** — that's a feature. If it fails after your edit, update the pattern;
  don't loosen the check (a silent no-op once shipped a broken widget).

## Native (iOS / Android)

The Capacitor wrapper is not checked in (generated, heavy). Recreate it with
`npm i @capacitor/core @capacitor/cli @capacitor/ios @capacitor/android`,
`npx cap add ios android`, then `./build.sh && npx cap sync`. App id used so far:
`de.ecommercewerke.knucklebones`. iOS requires a Mac with Xcode.

## Fair warning

Knucklebones is the dice minigame from *Cult of the Lamb* (Massive Monster /
Devolver Digital); this project borrows the name and ruleset. Fine for personal
use — get real legal advice and consider renaming before publishing or
monetising.
