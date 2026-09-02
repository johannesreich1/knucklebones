# Frontend architecture

Read this page for application flow, dependency direction, or a TypeScript
module move. Product rules live in `docs/MODES.md`, `docs/SPELLS.md`, and
`docs/LADDER.md`; CSS ownership lives in `docs/architecture/styles.md`.

## Runtime shape

- `src/main.ts` boots the standalone/PWA application. `src/widget.ts` boots
  the embeddable form from the same source modules.
- `src/boot.ts` is composition and browser wiring. It should shrink as feature
  binders acquire clear homes; it must not become a second business layer.
- `src/state.ts` holds the current application/game state vocabulary.
- `src/flow/` owns local lifecycle and turn orchestration.
- `src/online/` is lazy-loaded and owns authentication, remote persistence,
  matchmaking, collection synchronization, Rune Trial selection, and the
  ranked controller. It is grouped by ownership, not by file count:

```text
online/
  api/        the Supabase client, the RPC wrappers, and the request-lifecycle
              seams that keep restartable calls honest (idempotent commands,
              run generations, the join/leave cancellation race)
  identity/   session, guest upgrade, one-tap providers, Game Center
  play/       the ranked match controller, its synchronizer, and its watchdog
  runes/      collection, reward acknowledgement, and the Rune Trial offer
  screens/    the ONLINE overlay shell and every panel it paints, plus the
              face-off sheet and the row formatters those panels share
  styles/     one stylesheet per screen, behind the online.css manifest
```

  `message-copy.ts` and `preferences.ts` stay at the folder root because they
  are the two modules no single cluster owns: localized online errors are read
  by screens and identity alike, and preference sync is a boot-level entry that
  bridges local persistence with the account row.

  The chunk boundary is the point of all this: the only edges into
  `src/online/` are the `import()` calls in `src/boot/*`. A static import from
  `core/`, `flow/`, `ui/`, `i18n/`, `legal/`, or a root module would merge the
  Supabase client into every local and widget load; `tests/architecture.test.ts`
  fails on one.
- `src/ui/` renders shared player-visible concepts and supplies small browser
  primitives.
- **The windowed list** (`src/ui/virtual-list.ts`, with `virtual-cache.ts`,
  `virtual-slot.ts`, `virtual-ruler.ts`, `scroll-settled.ts`) is the one
  implementation behind both list screens — the ladder and match history. The
  screen owns what a row MEANS (copy, formatting, groups, taps, the RPC
  adapter); the module owns pixels and indices (the mounted window, measured
  pads, the row cache, every `scrollTop` write). A consumer declares which
  directions its sequence can travel by which of `after`/`before`/`seek` it
  supplies: match history has only `after`, so it grows at the tail and cannot
  be jumped into, which is correct for a list whose thumb cannot be turned back
  into a query.
  Three rules the module depends on, none of them obvious:
  - **The source owns positions.** Pages carry the position of their first row.
    Inferring it from a cursor is how a tie block shears — `rank` is not an
    ordinal (see `backend.md`).
  - **No `scrollTop` write during a gesture.** iOS reads one as "cancel the
    fling". Trimming and restoring cost no write at all because the top pad
    moves only by measured extents; the rare correction waits for a moment with
    no momentum to lose, and is paired with the pad in one synchronous block.
  - **The cache holds data, never nodes.** A pool of detached elements would
    strand pre-`languagechange` copy, so crawling away and back in another
    language would hand the reader stale words.
- `src/core/` contains rules, replay, dice streams, modes, spells, ladder
  policy, and AI shared by browser, Node tests, and Deno Edge Functions.

**Vocabulary boundary.** Non-ranked play has one player-facing label,
**OFFLINE**; its code surface says `local` (`src/local-options.ts`,
`src/flow/local-start.ts`). The DOM/i18n layer still carries legacy
`practice` names (`#ovPractice`, `openPractice()`, the `practice` i18n
namespace) — fold those into `local` when that layer is next touched, and do
not add new `practice` identifiers meanwhile.

The ranked standings had the same problem and are now settled: one concept,
one word, **ladder**. The route is `'ladder'`, the panel is `#onLadder` with
`#onLadderList`, the stylesheet is `online/styles/ladder.css`, and the API
reads `ladderPage()`/`ladderPageBefore()` returning `LadderRow`. The words
`board` and `leaderboard` survive only where they are not ours to rename: the
deployed `leaderboard`/`leaderboard_before` SQL functions, the `#btnBoardHome`
element id, and the `.lb`/`.lrow` classes. Do not reintroduce either word for
anything new.

## Dependency direction

```text
entry points / composition
  -> local controller or online controller
  -> shared game UI + core

shared UI -> core types and rules
core -> core/config only
```

UI modules must not import a concrete local or online controller. Input code
receives narrow typed actions such as `place` and `cast`; controllers decide
what those actions mean. `src/core/` has no DOM or timers. Replay, scoring,
dice bags, and AI search may not depend on ambient randomness; every random
stream is supplied explicitly.

## One shared view

Local and ranked play drive the same board. Board cells, score plates, mode
state, protections, spell effects, move motion, and result primitives each
have one implementation. A controller supplies a small spec or callbacks for
what genuinely differs; it does not paint its own sibling version.

Rune Trial follows the same rule. `src/ui/trial-select.ts` owns the shared
three-card selector; local CPU, face-to-face pass-and-pick, and online private
selection provide timing, secrecy, AI/server submission, and reveal callbacks.
The shared board then receives the revealed per-seat hands. Trial is carried as
an explicit format backed by Classic, never inferred by adding a fake entry to
the mechanical mode registry.

The Trial's whole pre-game is ONE reveal. `ui/reveal.ts` accepts a `trial` act
alongside its beats: a beat that does not exist until the one before it has
been read. The dial lands on RUNE RITUAL, the selector opens over the overlay
that is still showing it, and the two answers turn over on that same stage
under a single countdown — with the wait for a remote opponent written into
the reveal's own note line rather than sending the player back to the queue
panel. A second overlay for the runes is the shape this replaced; a caller that
reveals a mode, closes, and then reveals the choices has rebuilt it.

When extracting code from a large module:

1. Name one responsibility and its inputs/outputs.
2. Move it without copying behaviour or introducing a parallel state source.
3. Keep a temporary re-export only while callers migrate.
4. Type the new boundary; never carry `@ts-nocheck` into a new file.
5. Delete the compatibility facade once all callers and tests use the owner.

Prefer plain functions, typed records, and narrow ports. The application does
not need a framework store, event bus, or dependency-injection container.

## State and concurrency

- Game-root CSS state classes are a rendering contract and should have one
  owner rather than being toggled opportunistically across flow modules.
- `S.gen` invalidates stale local asynchronous work. New delayed work must
  capture and re-check the relevant generation.
- Online synchronization has additional ordering rules documented beside the
  implementation in `src/online/play/play.ts`. Preserve the applied-log counter,
  animation gate, and teardown/generation checks when decomposing it.
- Protocol-v1 standard matches continue to synchronize their placement log only
  when both immutable rune seats are empty. Protocol v2 synchronizes the ordered
  aim/cast/place action log and `action_version` for Rune Trial and equipped-rune
  standard matches; either standard seat may still be null, and casts retain
  the turn, so placement count is not a valid v2 clock. Both clients must
  advertise the format-specific capability before matchmaking may choose Trial
  or snapshot equipped standard runes.
- `matches.p1_rune` and `matches.p2_rune` are the sole gameplay authority.
  Reaching SILVER once permanently activates that participant's fixed or RANDOM
  equipped seat in ordinary ranked; a never-SILVER participant or empty seat
  gets no rune. RANDOM resolves from the match seed to one owned rune before
  the immutable row reaches the client. Standard matchmaking still validates
  every non-null assignment, but it never paints the paired rune-reveal screen.
  That screen belongs exclusively to Rune Trial, which ignores equipment and
  resolves its own private pair; rejoin remains silent.
- Persist only through `src/persist.ts`; corrupt or outdated blobs must fail
  closed rather than become an alternate state model.
- CPU and local-two-player setup preferences are separate persisted records.
  The start boundary revalidates both the selected format and rune against the
  active collection instead of trusting an older picker state. Trial may
  override a duel's resolved rune deal without overwriting either preference;
  restart preserves the resolved offer/choices and a new duel replaces them.
- The profile equipment seat opens an action sheet, not an inventory copy. Its
  waiting/live state follows the permanent historical-SILVER unlock, not the
  participant's current group after demotion. Its normal state offers EQUIP
  RUNE and RANDOM without listing the collection.
  EQUIP RUNE dismisses the sheet and enters one transient page-owned selection
  state in which only the collected rune tiles are actionable and visibly
  marked as choices; selecting one persists it and restores ordinary profile
  navigation. The sheet owns mode actions, the existing collection grid owns
  rune identity, and neither paints a second rune list.
- `src/rune-collection-cache.ts` is the eager, Supabase-free collection seam.
  It stores the last server-confirmed rune ids, permanent ranked-pool tier, and
  semantic equipment selection (`none`, `fixed`, or `random`) with their account
  id. RANDOM also retains its server-owned concrete fallback, but UI consumers
  read the semantic selection rather than presenting that fallback as fixed.
  That cache paints offline/profile choices; it never overrides a ranked match
  row's immutable rune assignments.
  Offline setup treats a missing snapshot as an empty collection, and sign-out
  or account change clears/swaps the active snapshot before another account can
  read it. Durable unseen/reward state remains server-owned.
- `src/profile-avatar.ts` is the pure avatar vocabulary shared by eager Home,
  the lazy profile picker, icon generation, and native reconciliation. It
  derives 42 face/hue values from `HUE_IDS`; `die:5:cy` maps to the primary
  launcher and the other 41 map to canonical `die-<face>-<hue>` ids. Do not
  grow another avatar or launcher registry in a screen.
- `src/profile-cache.ts` scopes cached profile presentation to the Supabase
  account id. Its small eager record paints Home without importing Supabase
  and deliberately keeps the last confirmed rank; Home never fetches standing.
  A separate versioned snapshot is valid only when every Profile-visible fact
  is present, so Profile paints a complete local view immediately and refreshes
  standing behind the 16 px die in the rank value. Missing/incomplete snapshots
  retain the shared full-view loader. An unscoped legacy entry may paint Home
  once, but it cannot drive a launcher change or merge into a newly
  authenticated account. A profile response re-checks the active session
  before publishing; sign-out and a detected account replacement clear both
  records and request the primary icon before the next account's row may
  repaint either surface.
- `src/native/app-icon.ts` is the web-safe coordinator over the injected
  `Capacitor.Plugins.AppIcon` capability. Its Settings choice is rendered only
  when that bridge exists in an installed iOS or Android app. It is off by
  default and persisted per installation, outside the account preferences and
  Supabase; web/PWA/widget builds neither show the control nor vary their fixed
  primary icon. Native mutations are serialized by revision: a request already
  inside the OS may finish, but every superseded request is ignored and the
  newest confirmed avatar or reset establishes the final icon. Picker previews
  and failed profile writes never enter that queue. Successful profile saves
  and owner-scoped reads request the confirmed avatar only while the choice is
  enabled. Explicit Off, sign-out, and account replacement restore primary;
  while disabled, boot requests primary once per startup, including to repair
  installs exposed to the short-lived automatic behaviour. Unsupported
  bridges, rejected changes, and state mismatches remain cosmetic results and
  never roll back server or cache state.
- The result's reward card is a door, not a leaflet: it names the new rune in
  two lines and opens the SHARED library entry (`ui/library.ts openEntry`) that
  the in-game badge and the profile collection open. It covers the result
  rather than leaving it, and the tap is explicit proof of presentation, so it
  acknowledges the durable unseen row.
- Ranked settlement preloads its owner-only progression event during the final
  board hold. `result-screen.ts` paints the ordinary result first and then
  gives `group-transition-screen.ts` the foreground whenever the pure
  `group-transition-model.ts` finds an actual crossing. The API derives both
  display groups from the event's historical points/apex flags; presentation
  derives permanent feature slides from the ranked outcome registry. Transport
  timeout/error remains an explicit retryable state; only a successful zero-row
  response means absent. Each ranked result also drains the owner's oldest
  unseen rows, so a failed read or acknowledgement is recovered later. Continue
  is the sole acknowledgement path for a displayed crossing, while same-group
  rows are consumed silently. Cached profile state never fabricates or consumes
  a transition.

## Size and context budget

A focused runtime module should normally stay below roughly 300 lines and
25–30 KB. Review anything above 350 lines or with several unrelated reasons to
change. Cohesive registries and state machines may be larger with an explicit
rationale; generated files, lockfiles, migrations, and archived studies are
not split to satisfy a counter.

The useful measures are change locality, one-way dependencies, and whether an
agent can load the owner without reading unrelated screens.
