# Design card library

Source cards have an explicit lifecycle:

- `screens/product/` contains current product screens and the selected studies
  that the product implements.
- `screens/studies/open/` contains alternatives for decisions that are still
  open. These are proposals, not shipped behavior.
- `screens/studies/archive/` contains deliberately retained, unshipped ideas
  for a future context that does not exist yet. Archive cards are not active
  proposals.

When a decision ships, preserve its comparison board and basename, visibly
mark the chosen option and shipped date, and move the source from
`screens/studies/open/` to `screens/product/`. This keeps both the implemented
answer and the alternatives that informed it available in future Claude Design
work. Move separate ideas that are no longer active proposals to
`screens/studies/archive/` when they still carry useful design context.

`mise exec -- node design/build.mjs` discovers cards recursively beneath those three roots,
then writes the same flat `design/dist/<basename>` output used by DesignSync.
Basenames are therefore globally unique and remain the durable card identity.
The build sorts by basename, rejects cards outside the three classifications,
and prunes stale generated cards. Rebuild before every DesignSync run so a
promoted study retains its remote identity and the manifest stays authoritative.

The preview chrome requests `text-rendering: geometricPrecision`. With the
bundled face correctly loaded, Linux Chromium's default small-text positioning
still wrapped notes and labels onto extra lines and clipped fixed frames. The
existing `design-cards-render` geometry check reproduces this; precise positioning
keeps the cards within their declared frames on both Linux and macOS. Diagnose
the bound face and text layout before changing a card's dimensions.
