# CSS architecture

Read this page before changing CSS, responsive behaviour, game-root state, or
the widget. Player-visible CSS changes must be verified in computed pixels and
in every state whose later override can win.

## Entry points and ownership

- `src/styles/main.css` is the canonical eager entry. It contains or imports
  foundations, shared components, local screens, and everything the shared
  local/ranked game view needs.
- `src/online/online.css` is lazy. It may style only online-owned panels; it may
  not redefine a generic class used by an eager screen.
- `src/styles/page.css` belongs to the standalone host page.
- `src/styles/widget-embed.css` adapts the shared app for an embed and must be
  applied after shared styles.

The manifests are split into small files grouped by ownership, not arbitrary
line-count slices:

```text
styles/
  foundations/   tokens, reset, backdrop
  shell/          HUD, overlays, paged views
  components/     controls, sheets, pickers, identity, loader
  game/           board, dice, stage, effects, guards, modes, spells, layout
  screens/        home, reveal, tutorial, handoff, result, learn
online/styles/    base, ladder, faceoff, matchmaking, account, result, profile,
                  avatar, history
```

One screen owns one stylesheet. The ladder was the counter-example — a
`ladder.css` and a `leaderboard.css` whose relative cascade was decided by the
`@import` order in `online.css` and therefore visible from neither file — and
they are now one file in that same order.

`main.css` and `online.css` remain the public manifests so runtime imports,
the design builder, and CSS reachability checks share one dependency graph.
Imports must be local, acyclic, resolved once, and consumed in source order.

## Cascade contract

The game view has intentional override chains. Preserve this effective order:

1. tokens and reset;
2. shared shell and controls;
3. base board, die, stage, and score geometry;
4. mode, protection, and spell states;
5. seating/orientation and viewport adaptations;
6. reduced-motion accessibility rules;
7. online panel styles when the lazy chunk is open;
8. widget adaptations for the embed entry.

Specific dependencies within that order include legal-target rings before
protection and casting states, base score geometry before face-to-face seating,
and all feature animation declarations before reduced-motion overrides.

During a mechanical split, move contiguous rules without renaming selectors,
reformatting declarations, cleanup, or adding cascade layers. Establish exact
visual parity first; semantic cleanup is a separate change.

## Selector rules

- Shared component classes may be generic only when their owner is genuinely
  shared. A lazy screen uses a screen root plus a semantic class; names such as
  `.hrow` are too broad for dynamically loaded CSS.
- JavaScript-toggled state classes form a documented contract. One frontend
  module owns each state and the related rules stay together.
- Every referenced animation name must have a keyframe definition in the same
  eager/lazy closure.
- Remove a selector only after searching production markup, dynamic builders,
  tests, and retained design cards. Archive or update studies before deleting
  the rules they still demonstrate.
- Do not use `!important` to repair ownership. Fix manifest order, specificity,
  or the selector boundary.

Shared interactive controls expose at least a 44 × 44 px effective hit region,
including compact back buttons, link-style actions, and visually small colour
swatches. A pseudo-element may expand the hit region when growing the artwork
would damage a dense layout, but hit testing must prove that the expanded area
belongs to the control and does not overlap a sibling target. Decorative
result bloom may be clipped at the viewport edge; translated text may not be.
Use text ranges and container scroll geometry together so a hidden horizontal
scroller or an ellipsis cannot masquerade as a passing layout.

The shared compact-label floor is `--font-label-min` (10 px). `.lbl` consumers,
including Settings control labels, and the Profile rune heading/count may not
compute below it across their localization viewport matrices. This is scoped,
not a blanket minimum for dense game metadata: smaller secondary metadata
remains component-specific and needs a larger primary label for context.

## Localized and legal copy

Responsive rules stay locale-neutral. Do not add language-tag selectors,
per-locale offsets, silent clipping/ellipsis, or global font shrinking to make
one translation pass. Prefer natural concise wording or a typed compact-copy
slot; when the component itself is too rigid, change its shared wrapping or
layout contract and remeasure every locale. Longer prose is valid when it wraps
and its final action remains reachable.

In-app legal documents use `src/styles/components/legal.css` inside the shared
paged-view shell: the header remains available, `.pbody` is the one page
scroller, prose and long links wrap, and navigation targets remain at least
44 px. Static legal pages use the generator's self-contained CSS because they
must work without application JavaScript, but both renderers consume the same
typed document content.

## Widget boundary

The embed must behave like a component, not a second page. Shared tokens,
resets, and components must be scoped beneath the stable application root.
Sheets, asks, and other portals append beneath that root rather than
`document.body`; root-scoped queries prevent collisions with host markup.

Verification includes host-page sentinel styles, every fixed/absolute overlay
remaining under the root, and opening/closing all lazy panels. Merely checking
elements that already happen to be descendants cannot prove isolation.

## Verification matrix

At minimum compare every registered locale at 320 × 568, 390 × 844,
568 × 320, and 667 × 375, plus widget widths 320, 390, and 520, pass and face seating,
all mode layouts, protection and casting states, tutorial/reveal/result,
online ladder/account/history/result, widget, numeral dice, chosen duel hues,
colour-blind mode, and reduced motion. Use same-machine before/after captures
for mechanical moves, then keep durable behavioural assertions rather than
cross-platform screenshot hashes.
