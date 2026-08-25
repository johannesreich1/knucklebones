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
   mise exec -- node build.mjs
   ```

2. Start the capture server from the repository root. It serves the built
   single-file runtime byte-for-byte and uses Vite only for the fixture's
   source-module imports:

   ```sh
   mise exec -- node marketing/app-store/ios/capture-server.mjs
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
4. Run `mise exec -- node marketing/app-store/ios/finalize.mjs`. It joins
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

## App Store Connect delivery

Screenshots are not part of the app binary and a Cloudflare or native build
deployment cannot add them. App Store Connect accepts them through its website
or authenticated API. This repository provides an owner-run API workflow; it
is intentionally not triggered by a push, web deploy, archive, or CI job.

The stable public listing identity is recorded once in
`app-store-connect.json`: **Knucklebones Neon**, Apple app id `6804966098`, SKU
`knucklebones-ios-001`, bundle id `com.appavaria.knucklebones`, and version
`1.0`. Fastlane's internal name for Apple's current 6.9-inch dimensions is
still `APP_IPHONE_67`; that identifier is intentional. Fastlane is pinned in
`Gemfile.lock`; install it locally with:

```sh
mise exec -- npm run appstore:fastlane:install
```

The workflow has three safety levels:

1. `mise exec -- npm run appstore:screenshots:check` is local and
   credential-free. It
   runs the focused delivery contract, then revalidates the exact manifest
   filenames, SHA-256 values, 1320 × 2868 size, opaque PNG encoding, unique MD5
   values, and Fastlane display type
   `APP_IPHONE_67`. `mise exec -- npm run appstore:screenshots:test` covers
   exact/no-op, reordering, duplicate, pending, stale, and full ten-slot planner
   cases.
2. Copy `.env.appstore.example` to ignored `.env.appstore`, fill the key fields,
   exact existing App Store locale, and version, then run
   `mise exec -- npm run appstore:screenshots:plan`. It only reads App Store
   Connect, verifies app id plus bundle id, refuses a missing/guessed locale or non-editable
   version, requires every marketing input/export plus the uploader, package
   commands, and locked dependencies to be tracked and clean, and prints the
   exact keep/upload/delete/reorder plan with a token bound to both local files
   and current remote inventory.
3. Only after a reviewed campaign-approval change, paste that token as
   `ASC_SCREENSHOT_UPLOAD_CONFIRM` and run
   `mise exec -- npm run appstore:screenshots:upload`. The lane re-reads
   everything under a local lock before mutation and synchronizes only the chosen locale's
   `APP_IPHONE_67` set. It uploads into free capacity first, deletes only stale
   members of that set, restores manifest order, and proves every unrelated
   locale/device set stayed byte-for-byte identical in the API inventory.

Do not use Fastlane's generic screenshot overwrite or beta sync here. The app
targets iPhone and iPad; those broad actions can clear or reorder screenshot
sets outside this six-image iPhone campaign. The targeted lane never creates an
app version or localization, never uploads a binary or general metadata, and
never submits for review.

For credentials, create an App Store Connect API key with screenshot-editing
access. Prefer an individual key owned by an app-limited user with the Marketing
role; a team key is broader and cannot be limited to only this app. The `.p8`
file is downloadable once: keep it outside this repository and point
`ASC_KEY_PATH` to its absolute path. Set `ASC_KEY_ID`; set `ASC_ISSUER_ID` for a
team key and leave it empty for an individual key. No Apple password belongs in
this workflow. Apple's current setup instructions are in
[App Store Connect API](https://developer.apple.com/help/app-store-connect/get-started/app-store-connect-api/);
the permitted screenshot roles and website alternative are in
[Upload app previews and screenshots](https://developer.apple.com/help/app-store-connect/manage-app-information/upload-app-previews-and-screenshots/).

The upload lane currently fails closed because `uploadApproved` is false and
the manifest is a draft. Resolve the ranked-rune dependency and store-name
clearance, regenerate every affected preview/export, then review a change that
sets the manifest status to `approved for App Store Connect upload` and flips
`uploadApproved` to true. This automation covers only the current English
iPhone 6.9-inch set. Because the app also supports iPad, a separate 13-inch iPad
screenshot set is still required before App Store submission.
