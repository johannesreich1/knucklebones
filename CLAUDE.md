# Working rules for this repo

**Keep `AGENTS.md` and `CLAUDE.md` synchronized. Whenever either file changes,
update the other in the same change.**

Knucklebones is a mobile-first TypeScript dice duel delivered as a PWA,
standalone page, widget, and Capacitor app. Local and ranked play share pure
game rules and the same player-visible game view; ranked persistence and
validation run on Supabase.

## Load only the context the task needs

Do not read every project document up front. Use this routing table before
touching an area:

| Task | Read first |
|---|---|
| Current release state, roadmap, or an unresolved owner decision | `docs/STATUS.md` |
| Frontend flow, state, module boundaries, or shared game rendering | `docs/architecture/frontend.md` |
| CSS, responsive layout, game-state overrides, or widget isolation | `docs/architecture/styles.md` |
| Locale detection, translated copy, language settings, or translation layout budgets | `docs/architecture/localization.md` |
| Supabase, auth, RLS, migrations, RPCs, Realtime, or Edge Functions | `docs/architecture/backend.md`, `supabase/DESIGN.md`, and the applicable Supabase skills |
| Build artifacts, PWA, service worker, widget packaging, native, or deploy | `docs/architecture/build.md` |
| Tests, CI, browser harnesses, live probes, or verification policy | `docs/architecture/testing.md` |
| Claude Design cards, study lifecycle, or DesignSync | `design/README.md`, then `README.md` → Design system |
| Game modes or their balance/odds | `docs/MODES.md` |
| Spells or their balance/interaction rules | `docs/SPELLS.md` |
| Ladder points, groups, bots, or matchmaking policy | `docs/LADDER.md` |
| Accounts, guest upgrade, nickname, or Game Center identity | `docs/IDENTITY.md` |
| Historical August rationale or rejected alternatives | `docs/history/2026-08-sprint.md` |

For a routine localized change, inspect its owners and tests; `STATUS.md` is
not mandatory unless the task depends on current/open external state.

## One thing, one implementation

If two screens, flows, or behaviours are the same concept with different
presentation, there is one implementation with explicit slots for what really
differs. A second near-copy is a design failure, not a shortcut.

- Registries own variants: modes in `src/core/modes.ts`, spells in
  `src/core/spells.ts`. Flow, UI, and CSS consume registry data rather than
  learning every name.
- Shared components accept specs/slots. Local and online controllers drive the
  shared board and result primitives; neither paints a private copy.
- Repeated design values become tokens. Repeated behaviour gets a narrow typed
  seam, not an event bus or framework.
- Before copying, name the actual difference and make it a parameter. Keep
  KISS: do not abstract unrelated one-line coincidences.

## Universal engineering rules

- **Never push a known red gate.** Cloudflare deploys `main` immediately.
  Choose verification in proportion to the change: focused owner and
  specialized gates are sufficient for a well-contained, low-risk change;
  run `mise exec -- npm test` when a change is cross-cutting, high-risk, lacks
  decisive focused coverage, or touches shared build/test infrastructure. Report the
  exact verification performed and say explicitly when the full gate was not
  run.
- **Do not wait for hosted GitHub checks by default.** Once the required local
  verification and release flow are complete, hand off immediately. Inspect
  GitHub Actions only when requested or when a concrete failure or uncertainty
  makes the hosted result useful.
- **Always release through the native-aware helper.** After explicitly staging
  and committing reviewed files in a clean worktree, use
  `mise exec -- node tools/release-main.mjs` instead of a raw push to `main`.
  It rebuilds and syncs both Capacitor platforms, verifies their exact payloads,
  runs the full gate, rejects tracked drift or a non-fast-forward update, and
  pushes the verified `HEAD`. It never stages or commits files; use a dedicated
  clean worktree when the shared checkout contains concurrent changes.
- **One gate per working tree.** `tests/run-all.mjs` holds `.gate.lock` because
  the build output is shared. Separate worktrees may gate concurrently on
  kernel-assigned ports.
- **Keep `src/core/` portable.** No DOM or timers. Replay/scoring are
  deterministic across browser, Node, and Deno; any AI/dice randomness stays
  explicit, injectable, and outside authoritative replay outcomes.
- **Assert what the player can see.** For layout, stacking, visibility, and
  animation, verify computed pixels/hit testing rather than DOM or state alone.
- **Measure tunable behaviour.** Difficulty, balance, layout budgets, and
  animation timing require evidence, not intuition.
- **Do not spread unchecked code.** New/extracted TypeScript is typed and may
  not inherit `@ts-nocheck`. Prefer focused modules; split by responsibility,
  not an arbitrary line counter.
- **Preserve user changes.** The working tree may contain concurrent work;
  inspect it first and do not overwrite unrelated edits.
- **Regenerate affected previews with design changes.** When a source or design
  change alters a generated design card, marketing screenshot, or preview,
  rebuild every affected preview/export in the same change. A stale generated
  preview is a failing handoff, not follow-up work.
- **External dashboards belong to Johannes** (Cloudflare, Supabase dashboard,
  registrars). Prepare repository changes and steps; he clicks. A connected
  Supabase tool is the sanctioned exception when the requested scope permits.

## Verification entry points

Node 24 is required. `mise.toml` activates the `.nvmrc` pin for local shells;
agents and other local non-interactive automation must launch every Node-, npm-,
npx-, Vite-, Capacitor-, or JavaScript-backed command through `mise exec --`.
Hosted CI/deploy may invoke them directly only after selecting `.nvmrc` in that
job or build environment. Do not hard-code a machine-specific Node path. For
example, the full gate is `mise exec -- npm test`; the validated
`process.execPath` then propagates to every child build and test.

```text
mise exec -- npm run dev       local Vite server
mise exec -- npm run build     all web/widget/native-web artifacts
mise exec -- npm test          full release gate
```

Run a focused owner test while iterating. Before handoff or deployment, decide
whether focused/specialized gates cover the affected surface decisively; use
the full gate when the scope or remaining risk warrants it, not automatically
for every localized change. Live tests are explicit, environment-driven, and
never part of the default gate.
