# iOS App Store screenshots

This set is authored at **1320 × 2868 px**, one of Apple's accepted portrait
sizes for the 6.9-inch iPhone screenshot slot. Every app panel is staged from
the current production single-file runtime (`knucklebones-neon.html`) through
the repository's stable driver surfaces and source UI modules. The shared
board, ranked mode dial, WARD strike, SUNDER targeting, BOUNTY strike, and
ladder are application renderers rather than hand-painted imitations. The
network fixture used for the ladder is local and deterministic; capture must
never contact the live backend.

Apple's current size and format reference is the
[Screenshot specifications](https://developer.apple.com/help/app-store-connect/reference/app-information/screenshot-specifications/)
page in App Store Connect Help.

The exported PNGs live in `exports/iphone-6.9/`. `contact-sheet.jpg` is only a
review aid and is not an App Store upload asset.

## Re-export

1. Build the current runtime with Node 24:

   ```sh
   /opt/homebrew/bin/node build.mjs
   ```

2. Start the capture server from the repository root. It serves the built
   single-file runtime byte-for-byte and uses Vite only for the fixture's
   source-module imports:

   ```sh
   /opt/homebrew/bin/node marketing/app-store/ios/capture-server.mjs
   ```

3. Open the printed `http://localhost:8765/...` URL. At an exact 1320 × 2107
   viewport, capture each slide in two one-pass segments. The first uses
   `source.html?slide=N`; the second adds `&offset=2107`. Save the browser's
   JPEG segments under `raw/` with the manifest-derived stem and `-top.jpg`
   or `-bottom.jpg`. BOUNTY requires a second complete pair from
   `slide=5&variant=active`; save those as
   `05-ranked-bounty-active-top.jpg` and
   `05-ranked-bounty-active-bottom.jpg`. Set `KB_CAPTURE_PORT` only when the
   default port is busy.
4. Run `/opt/homebrew/bin/node marketing/app-store/ios/finalize.mjs`. It joins
   each pair without resampling, then builds BOUNTY as the disclosed
   chronological composite in `manifest.json`: the authentic double-strike
   source is opaque through row 1728, feathers only through the empty gap, and
   the authentic later active-turn source owns row 1750 downward. The script
   flattens every result to opaque RGB PNG, validates 1320 × 2868 output, and
   rebuilds the contact sheet plus SHA-256 lists for both the raw source pairs
   and final exports. Apple accepts PNG, JPEG, and JPG, but rejects alpha
   channels.

The text and ordering are defined once in `source.html` and summarized in
`manifest.json`. The choices, exact fixtures, rejected alternatives, and draft
conditions are recorded in `DECISIONS.md`. If a source/design change affects a
preview, regenerate every affected raw segment, final PNG, checksum, and the
contact sheet in the same change. The title is intentionally editable:
`docs/STATUS.md` records that store-name/trademark clearance is still
unresolved.

The BOUNTY preview is intentionally not represented as a single reachable
instant. Its two production moments are chronological: two real strike coins
above, followed by the later `✦2` targeting turn with WARD turned face-up and
enlarged, a new die `4`, the production `TAP YOUR OWN COLUMN` prompt, and a
4-second clock below. The campaign remains a draft until the ranked rune rail
ships. Neither source may be replaced by painted UI, and a change to the board,
bounty effect, rune rail, die stage, status, timer, score plate, or phone
geometry requires both BOUNTY pairs and the final composite to be regenerated.
