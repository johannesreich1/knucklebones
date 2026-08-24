# iOS App Store screenshots

This set is authored at **1320 × 2868 px**, one of Apple's accepted portrait
sizes for the 6.9-inch iPhone screenshot slot. Every app panel is staged from
the current production single-file runtime (`knucklebones-neon.html`) through
the repository's stable driver surfaces and source UI modules. The shared
board, ranked mode dial, SUNDER targeting, BOUNTY strike, ranked result, and
ladder are application renderers rather than hand-painted imitations. Network
fixtures used for the ranked result and ladder are local and deterministic;
capture must never contact the live backend.

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
   or `-bottom.jpg`. Set `KB_CAPTURE_PORT` only when the default port is busy.
4. Run `/opt/homebrew/bin/node marketing/app-store/ios/finalize.mjs`. It joins
   the segments without resampling, flattens them to opaque RGB PNG, validates
   1320 × 2868 output, and rebuilds the contact sheet. Apple accepts PNG,
   JPEG, and JPG, but rejects alpha channels.

The text and ordering are defined once in `source.html` and summarized in
`manifest.json`. The choices, exact fixtures, rejected alternatives, and draft
conditions are recorded in `DECISIONS.md`. If a source/design change affects a
preview, regenerate every affected raw segment, final PNG, checksum, and the
contact sheet in the same change. The title is intentionally editable:
`docs/STATUS.md` records that store-name/trademark clearance is still
unresolved.
