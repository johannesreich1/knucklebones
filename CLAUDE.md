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
| Supabase, auth, RLS, migrations, RPCs, Realtime, or Edge Functions | `docs/architecture/backend.md`, `supabase/DESIGN.md`, `supabase/functions/README.md` (what each function is for), and the applicable Supabase skills |
| Build artifacts, PWA, service worker, widget packaging, native, or deploy | `docs/architecture/build.md` |
| Tests, CI, browser harnesses, live probes, or verification policy | `docs/architecture/testing.md` |
| Claude Design cards, study lifecycle, or DesignSync | `design/README.md`, then `README.md` → Design system |
| Game modes or their balance/odds | `docs/MODES.md` |
| Spells or their balance/interaction rules | `docs/SPELLS.md`; for the ranked/equipped-rune decisions behind them, `docs/RUNE_MULTIPLAYER_INVESTIGATION.md` |
| Ladder points, groups, bots, or matchmaking policy | `docs/LADDER.md` |
| Accounts, guest upgrade, nickname, or Game Center identity | `docs/IDENTITY.md` |
| Impressum, privacy, consent, or anything shipping to a store listing | `docs/LEGAL.md` |
| Historical August rationale or rejected alternatives | `docs/history/2026-08-sprint.md`, `docs/RUNE_CANDIDATE_STUDY.md` (exploratory runes, none shipped) |

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
- **A green gate ships, without being asked again.** When the work the owner
  asked for is done and the verification it warrants passes, carry it all the
  way out: stage and commit the reviewed files, release through the helper
  below, then put the payload on the device (the bullet after it). Do not stop
  at a green gate to ask whether to push — the request was the authorisation.
  Ask first only when the gate is red or was not run, when the change is not
  the one that was requested, or when Johannes said to hold.
- **Always release through the native-aware helper.** After explicitly staging
  and committing reviewed files in a clean worktree, use
  `LANG=en_US.UTF-8 mise exec -- node tools/release-main.mjs` instead of a raw
  push to `main`. The locale is not optional: the helper runs `native:verify`,
  whose `pod install` aborts on a non-UTF-8 terminal, and an agent shell
  usually has `LANG` unset — the release then stops before the gate, having
  proved nothing.
  It rebuilds and syncs both Capacitor platforms, verifies their exact payloads,
  runs the full gate, rejects tracked drift or a non-fast-forward update, and
  pushes the verified `HEAD`. It never stages or commits files; use a dedicated
  clean worktree when the shared checkout contains concurrent changes.
- **A release does not reach the installed app.** `native/www/` and
  `native/ios/App/App/public/` are gitignored build output, so pulling `main`
  leaves every checkout — and every device — on its last synced payload. The
  helper syncs only the tree it ran in. After each release, sync the checkout
  Johannes builds from and hand him the expected tag:
  `LANG=en_US.UTF-8 mise exec -- npm run native:sync:ios` (CocoaPods needs the
  UTF-8 locale), then `native:verify:ios`, then report the `data-build` value
  now in `native/ios/App/App/public/index.html` — **Settings** renders it, as the
  last line of the scrolling content, below the final card and above the pinned
  legal links (`#buildTag`, `src/markup.ts`, painted by `stampBuild()` in
  `src/ui/dom.ts`), so he can confirm the device actually took the build. Tell
  him to scroll Settings to the end; it is not on the title screen and no longer
  in the pinned footer. Say explicitly that Xcode needs Clean Build
  Folder first; it reuses a stale bundle otherwise.
  **Sync from the checkout that has `.env`.** A worktree has none, so a payload
  built there bakes an EMPTY identity-gateway URL and its `data-build` differs
  from the one the device should run — report the tag from the tree the sync
  actually ran in, never the release worktree's.
- **A worktree gate needs the main checkout's environment.** Copy `.env` into
  the worktree before `tools/release-main.mjs`: without it the built app bakes
  an empty identity-gateway URL and `online-ui-entry`'s `offline-entry` scenario
  is red on untouched `main` (a request the harness stub never matches). Run
  `npm ci` in `native/` for real — a symlinked `native/node_modules` makes
  `cap sync` rewrite `Podfile`, `Podfile.lock` and `capacitor.settings.gradle`
  with resolved absolute paths, which `native:verify` reports as drift. The root
  `node_modules` may stay a symlink. A worktree with `.env` builds the same
  `data-build` tag the device should run.
- **One gate per repository, and it queues.** `tests/run-all.mjs` takes a lock
  named after the shared `.git` directory, so every worktree of this clone
  waits its turn; a separate clone is unaffected. Worktrees CAN gate in
  parallel — kernel-assigned ports made that correct in August 2026 — but this
  machine cannot afford it: three at once reached load 284 and produced
  starvation failures indistinguishable from defects. Do not work around the
  wait; `KB_NO_LOCK=1` exists for a single deliberate run, not for a habit.
- **The lock protects the run; the icon manifest needs the whole TREE.**
  `native/profile-app-icons.manifest.json` records a sha256 for every CSS file
  in the graph, so it is only ever consistent with ONE working tree. Whoever
  gates must therefore be the only session holding uncommitted CSS:
  `tools/appicon.mjs` stamps whatever is dirty at that moment, including other
  sessions' files, and committing that puts a provenance hash for bytes that
  exist in nobody's checkout into `main` — green where it was stamped, red for
  everyone who pulls, and undiagnosable, because the manifest names a file
  whose committed content never produced that hash. On 2026-09-04 this cost two
  sessions a gate each, symmetrically: one run died on the other's uncommitted
  `home.css`, and the other would have died on the first's `paged-view.css`.
  Serialise by stashing to a named stash BY EXPLICIT PATH — a bare `git stash`
  sweeps the peer's files into your stash and is the same mistake wearing a
  third costume.
- **A worktree stamps the icon manifest WRONG unless you copy `native/assets/`.**
  It is gitignored, so a fresh worktree has none, and `tools/appicon.mjs` there
  writes `"missing": true` for icon-background, icon-foreground,
  icon-monochrome, icon-only and AppIcon-512@2x. That is green in the worktree
  and red in every checkout that has those files. `cp -R native/assets/.
  <worktree>/native/assets/` before stamping, then confirm the diff moves only
  your own source entry. This trap is worth naming beside the rule above,
  because the obvious remedy for that rule walks straight into it.
- **A gate can DIE SILENTLY under memory pressure, and no setting is known to
  prevent it.** The run stops mid-suite with no error, no failing assertion and
  no exit line — indistinguishable from the `pkill` incident below, which is
  why on 2026-09-04 one session lost five releases hunting a culprit who did
  not exist and another was asked whether it was killing peer processes. A
  failure mode that impersonates sabotage is the thing to recognise here; the
  tuning below is not a fix.
  MEASURE FIRST: `sysctl -n hw.memsize`, `vm_stat`, `sysctl vm.swapusage`. That
  day the box showed 1.77 GB available of **32 GB** with swap 87% full (7.1 of
  8.2 GB) — a simulator, an IDE, a browser, a container runtime and ~27 agent
  CLIs, none of them the gate's to reclaim. Note the shape: 32 GB with ~30
  committed points at something holding more than it should, where "small
  machine, full" invites buying headroom. One session summed `vm_stat` page
  classes, got ~15 GB, and repeated it three times before it was checked
  against `hw.memsize`; page classes miss compressed and purgeable.
  `KB_JOBS` (`gate-manifest.mjs`, `env.KB_JOBS ?? (env.CI ? 1 : 4)`) sets suite
  parallelism, and each online-ui shard launches its own Chromium workers — but
  THE EVIDENCE DOES NOT NAME A SAFE VALUE, so do not read one into it. Both
  deaths that were tuned to `KB_JOBS=1` died at `start online-ui-entry` with
  zero suites complete; the run that finished used `2` (1086s, against 692s at
  the default `4`, which had also completed earlier that morning). A guess that
  foreground rather than detached execution was the difference does not survive
  the other session's runs, which completed detached three times the same day.
  Treat it as an OPEN QUESTION, report what a run actually did, and do not let
  a hunch harden into a remedy here.
  What is not in doubt: **tee the output to a file**, never pipe it to `tail`.
  A piped run buffers until exit, so a death leaves zero bytes to diagnose and
  the failure has to be reconstructed from process tables.
- **Keep `src/core/` portable.** No DOM or timers. Replay/scoring are
  deterministic across browser, Node, and Deno; any AI/dice randomness stays
  explicit, injectable, and outside authoritative replay outcomes.
- **Assert what the player can see.** For layout, stacking, visibility, and
  animation, verify computed pixels/hit testing rather than DOM or state alone.
- **Measure tunable behaviour.** Difficulty, balance, layout budgets, and
  animation timing require evidence, not intuition.
- **Every bug fix ships with a test that fails without it.** Write the test
  first and watch it fail against the unfixed code — a regression test that was
  never seen red proves nothing. Pin the fact the player reported, at the level
  they reported it: a wrong colour is asserted as a computed colour, not as the
  state that was supposed to produce one. If a bug reached a player, the gate
  had a hole; the fix closes the hole as well as the bug. Say in the commit
  which test now fails without the change.
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
- **BadRandolf point moves use the guarded fast path.** When Johannes explicitly
  asks to set BadRandolf's current ladder points, immediately run
  `KB_ALLOW_PRODUCTION_PLAYER_POINTS=<points> mise exec -- npm run db:production:player-points -- <points> --apply`
  with his exact requested value. Do not add a separate docs/research pass,
  preview-only run, or test run; the helper's environment audit, blockers,
  locked transaction, compare-and-set, and post-apply verification are the
  required checks and must not be bypassed. Preserve peak and permanent-pool
  high water by default; use `--reset-high-water` only when Johannes explicitly
  asks for that reset.

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

**A focused run of a `.ts` suite does NOT typecheck it.** Suites launch through
`node --experimental-strip-types`, which *erases* type annotations without
checking them, so `npm test -- --suite <name>` can pass repeatedly on a file
that does not compile. The gate typechecks separately (`typecheck-tests`,
`tsconfig.tests.json`) and fails there instead — after most of the suites have
already run. When you add or edit a `.ts` test, run
`mise exec -- npm test -- --suite typecheck-tests` alongside the focused run;
it takes about a second and is the only thing that reads the types you wrote.
`docs/architecture/testing.md` carries the mechanism and the rest of the
harness's traps.

Run a focused owner test while iterating. Before handoff or deployment, decide
whether focused/specialized gates cover the affected surface decisively; use
the full gate when the scope or remaining risk warrants it, not automatically
for every localized change. Live tests are explicit, environment-driven, and
never part of the default gate.

**A green local gate is not a green pipeline.** The gate here runs on macOS;
hosted CI runs on `ubuntu-latest`, and the two disagree about anything the
operating system supplies — fonts above all, since the app ships none and its
stack asks for faces only Apple provides. Hosted CI can therefore be red for
days while every local run passes. Read `gh run list --branch main` before
claiming the pipeline is green, before wiring anything to CI, and before
reporting a release as verified.

**Let CI judge what only CI can judge.** The workflow runs on `pull_request`
as well as on pushes to `main`, so a change whose whole point is the hosted
environment — a CI config, a Linux rendering fix — belongs on a branch with a
PR first. That returns a real ubuntu-latest verdict without a release, a
native sync, or a deploy, and it costs about half the time of finding out
through `main`. Release once it is actually green. Everything else still ships
through `tools/release-main.mjs`: `main` deploys on push, so a normal change
still earns the full gate before it goes.

**Never answer a rendering failure by moving the number.** A geometry
assertion that fails only on the hosted runner is usually measuring the wrong
font, not a layout that grew. Widening a budget, or editing a declared card
height until CI agrees, bakes that runner's metrics into source and makes the
app wrong for the players it was already right for — this repo has done it
twice (`e0539dc`, `829ee7d` inflated eight design cards by 28-110px). Find
which face the stack actually bound before touching a measurement;
`tests/support/rendering-font.mjs` names a wrong-font host as the first
problem so the misdiagnosis is not available.
