# Working rules for this repo

Read `docs/STATUS.md` for where the project stands. This file is the short list
of principles that decide *how* changes get made here.

**Before touching either variety layer, read its design doc** — they record
the *thinking* (what a spell or mode is allowed to be, what was rejected and
why, what the numbers were), so you can extend them without re-deriving the
rules, or overrule them knowingly:

- `docs/SPELLS.md` — the spell layer: four design principles, the house rules
  a spell may not break, why COLUMN SWAP was retired, the measured roster, how
  to measure a new one, and the UI rules real play burned in.
- `docs/MODES.md` — the game modes: what a mode may change, ranked odds and
  who owns them, the heuristics that must be measured rather than reasoned,
  and how modes interact with spells.

## One thing, one implementation — extensible, never duplicated

**If two screens, flows or behaviours are the same thing wearing different
clothes, there is ONE implementation with slots for what genuinely differs.**
Never a second copy "because this context is a bit different".

DRY here does not mean "share some helpers". It means: the shared thing has a
single home, and the differences are *parameters of it* — a slot, a spec
object, a registry entry, a token. If a new context cannot be expressed by
filling in the existing thing, that is a signal the thing needs a better seam,
not a sibling.

Why it is worth the extra thought every time:

- A duplicate is finished once and maintained twice. Every later improvement
  has to be remembered in both places, and one of them will be missed. This
  repo has already paid that bill: the in-game view had two drivers that each
  wrote the board directly, and five player-visible differences accumulated in
  the gap — a multiplier that celebrated offline and stayed silent online, a
  game-over beat that settled on one side only.
- The second copy is where bugs hide, because the tests were written for the
  first.

In practice:

- **Registries over branches.** A new game mode is an object in
  `core/modes.ts`; a new spell is an object in `core/spells.ts`. The flow, the
  UI and the CSS never learn its name.
- **Components over screens.** The game-mode picker and the spell picker are
  one `pickerRow()` differing by their item list. The end screen serves local
  play and ranked alike, filled by a spec.
- **Tokens over numbers.** Three width tokens replaced seven ad-hoc
  max-widths (`design/screens/01-widths`).
- **One driver may not own a shared view.** `flow/game.ts` and
  `online/play.ts` drive the same board through the same render layer; neither
  paints privately.

When you catch yourself writing a near-copy: stop, name what actually differs,
and make that the parameter.

## The rest, in brief

- **Never push a red gate.** `npm test` must be green — Cloudflare deploys
  `main` immediately, without waiting for CI.
- **`core/` stays pure.** No DOM, no timers, no randomness: it runs in the
  browser, in Node (the test gate) and in Deno (Edge Functions) unmodified.
- **Assert what the player can SEE.** Computed pixels, not DOM contents — a
  mode once shipped broken while state and DOM agreed perfectly
  (`tests/test13.mjs`).
- **Measure, don't guess**, for anything tunable — difficulty, layout budgets,
  animation. Both AI difficulty passes in this repo were decided by simulated
  games, not by feel.
- **External dashboards belong to Johannes** (Cloudflare, Supabase dashboard,
  registrars). The repo side prepares and writes the steps; he clicks.
  Supabase via the connected MCP is the sanctioned exception.
