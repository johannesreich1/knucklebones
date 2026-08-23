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
  matchmaking, and the ranked controller.
- `src/ui/` renders shared player-visible concepts and supplies small browser
  primitives.
- `src/core/` contains rules, replay, dice streams, modes, spells, ladder
  policy, and AI shared by browser, Node tests, and Deno Edge Functions.

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
what those actions mean. `src/core/` has no DOM or timers. Replay and scoring
may not depend on ambient randomness. Existing AI tie-breaking is a deliberate
non-replay exception and must stay injectable/testable.

## One shared view

Local and ranked play drive the same board. Board cells, score plates, mode
state, protections, spell effects, move motion, and result primitives each
have one implementation. A controller supplies a small spec or callbacks for
what genuinely differs; it does not paint its own sibling version.

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
  implementation in `src/online/play.ts`. Preserve the applied-log counter,
  animation gate, and teardown/generation checks when decomposing it.
- Persist only through `src/persist.ts`; corrupt or outdated blobs must fail
  closed rather than become an alternate state model.

## Size and context budget

A focused runtime module should normally stay below roughly 300 lines and
25–30 KB. Review anything above 350 lines or with several unrelated reasons to
change. Cohesive registries and state machines may be larger with an explicit
rationale; generated files, lockfiles, migrations, and archived studies are
not split to satisfy a counter.

The useful measures are change locality, one-way dependencies, and whether an
agent can load the owner without reading unrelated screens.
