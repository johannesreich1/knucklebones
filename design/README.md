# Design card library

Source cards have an explicit lifecycle:

- `screens/product/` contains current product screens and the selected studies
  that the product implements.
- `screens/studies/open/` contains alternatives for decisions that are still
  open. These are proposals, not shipped behavior.
- `screens/studies/archive/` contains deliberately retained, unshipped ideas
  for a future context that does not exist yet. Archive cards are not active
  proposals.

`node design/build.mjs` discovers cards recursively beneath those three roots,
then writes the same flat `design/dist/<basename>` output used by DesignSync.
Basenames are therefore globally unique and remain the durable card identity.
The build sorts by basename, rejects cards outside the three classifications,
and prunes stale generated cards.
