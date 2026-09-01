# iOS App Store campaign

This directory owns the currently managed localized App Store Connect draft
for **Knucklebones Neon**. It contains localized listing copy and six portrait
screenshots for each campaign locale and required Apple device class:

| Store locale | Runtime language | iPhone 6.9-inch | iPad 13-inch | Total |
|---|---|---:|---:|---:|
| `en-GB` | English (`en`) | 6 | 6 | 12 |
| `pt-BR` | Brazilian Portuguese (`pt`) | 6 | 6 | 12 |
| `es-ES` | Spanish (`es`) | 6 | 6 | 12 |
| `de-DE` | German (`de`) | 6 | 6 | 12 |
| `fr-FR` | French (`fr`) | 6 | 6 | 12 |
| `it` | Italian (`it`) | 6 | 6 | 12 |
| `pl` | Polish (`pl`) | 6 | 6 | 12 |
| `tr` | Turkish (`tr`) | 6 | 6 | 12 |
| `id` | Indonesian (`id`) | 6 | 6 | 12 |
| `ja` | Japanese (`ja`) | 6 | 6 | 12 |
| `ko` | Korean (`ko`) | 6 | 6 | 12 |
| **Campaign** | **11 locales** | **66** | **66** | **132** |

The output matrix and App Store identifiers are declared in
`app-store-connect.json`; creative fixtures and localized overlay copy are in
`manifest.json`; App Store listing fields are in `metadata.json`. These are
the campaign's eleven AI-reviewed listing locales, matching the product runtime
registry (`en`, `pt`, `es`, `de`, `fr`, `it`, `pl`, `tr`, `id`, `ja`, `ko`).

Each app panel comes from the current production single-file runtime
(`knucklebones-neon.html`) and production renderers. The capture uses a real
440 × 956 iPhone viewport or 1032 × 1376 iPad viewport, including the declared
safe areas, and then exports Apple's accepted 1320 × 2868 or 2064 × 2752
portrait PNG. The board, ranked mode dial, WARD and SUNDER states, BOUNTY
effect, and ladder are not hand-painted imitations. Deterministic fixtures may
supply fictional users, ratings, board states, and ladder data; capture must
never contact the live backend.

Apple's current format reference is
[Screenshot specifications](https://developer.apple.com/help/app-store-connect/reference/app-information/screenshot-specifications/).

## Output layout

- `raw/{locale}/{target}/` contains 154 lossless runtime captures: six hero
  states plus BOUNTY's separate active state, across eleven managed locales and two
  devices.
- `exports/{locale}/{target}/` contains the 132 opaque final PNGs and one
  `checksums.txt` for each locale/device set. These are the upload assets.
- `contact-sheets/{locale}-{target}.jpg` contains twenty-two review aids. Contact
  sheets are never uploaded.
- `capture-provenance.json` records the runtime build, browser versions,
  viewports, raw paths, and capture count. It is written only after a complete
  capture succeeds.

## Regenerate and verify

Node 24 is mandatory. From the repository root, the canonical command is:

```sh
mise exec -- npm run appstore:screenshots:generate
```

It rebuilds the product runtime, starts the loopback-only capture server,
captures all 154 real-runtime source frames with Playwright, finalizes all 132
App Store PNGs, rebuilds twenty-two contact sheets and checksum files, and verifies
dimensions, opacity, provenance, locale coverage, metadata limits, and file
order. The individual stages remain available for diagnosis:

```sh
mise exec -- npm run appstore:screenshots:capture
mise exec -- npm run appstore:screenshots:finalize
mise exec -- npm run appstore:screenshots:verify
```

Do not edit a raw or exported image by hand. BOUNTY is the only composite: its
manifest-disclosed horizontal feather combines two chronological, authentic
runtime moments. The upper state shows exactly two production BOUNTY strike
coins; the later active state shows the matching `✦2`, an enlarged face-up
WARD card, a newly rolled `4`, the production targeting prompt, and a
four-second ranked countdown. The finalizer blends only the empty gap; it does
not paint product UI.

### Non-negotiable preview regeneration contract

Preview impact is part of the definition of done for every future agent:

1. A change to game UI, CSS, fonts, colors, responsive or safe-area layout,
   modes, runes, online identity, ladder, localized product copy, screenshot
   overlay copy, fixtures, capture code, finalization code, or campaign
   geometry must be checked for affected previews before handoff.
2. If one product state changes, regenerate that state in **all eleven managed locales
   and both device targets**: twenty-two final previews, their raw sources, all twenty-two
   affected checksum/contact-sheet entries, and capture provenance. A BOUNTY
   change also regenerates both chronological sources for all twenty-two targets.
3. If shared layout, typography, runtime framing, localization plumbing, or
   the capture/finalization pipeline changes, run the canonical full generation
   command and replace the complete 154-raw/132-export campaign.
4. Commit every affected generated file in the same change as its source.
   Passing source tests with a stale preview, checksum, contact sheet, or
   provenance file is a failing handoff, not deferred follow-up work.
5. Review all affected contact sheets and at least one full-resolution final
   per device after generation. Check clipping, seams, source-language leaks,
   stale states, the selected COLUMN SHIELD yellow, AI/ranked context, and the
   absence of the exit button.

This contract is also mirrored in `AGENTS.md` and `CLAUDE.md`, so an agent
changing a source design must regenerate the affected campaign outputs without
waiting for a separate screenshot request.

## Locked six-image story

The exact fixtures and rationale live in `DECISIONS.md`; the visible contract
is summarized here:

1. Ranked ROW MULTIPLY uses named opponents, exactly one `×2` row and one
   `×3` row, and exactly two dice in the `×2` row.
2. The real pre-match dial lands on COLUMN SHIELD; its selected label is the
   production yellow `#ffd166`, never white.
3. WARD shows a mint protective seal in an `AI · NORMAL` match.
4. SUNDER shows the contrasting wide offensive preview in an `AI · NORMAL`
   match.
5. Ranked BOUNTY shows exactly two destroyed dice, then the chronological
   active WARD card, die `4`, countdown `4`, and `✦2` state.
6. The production ranked ladder carries the localized
   win → climb → repeat claim; there is no separate victory screenshot.

Four frames use named online/ranked context, two use AI Normal, rune copy never
labels runes as offline-only, and no frame shows the exit button.

## Localized listing ownership

`metadata.json` deliberately owns only these fields for `en-GB`, `pt-BR`,
`es-ES`, `de-DE`, `fr-FR`, `it`, `pl`, `tr`, `id`, `ja`, and `ko`:

- App Info: `name`, `subtitle`
- iOS version: `promotionalText`, `keywords`, `description`

The copy describes ranked play and runes as separate features; it does not
claim that runes are already available in ranked games. The sync intentionally
does not own `supportUrl`, `privacyPolicyUrl`, `privacyChoicesUrl`,
`marketingUrl`, or `whatsNew`. Localized public legal/support pages, a
monitored public contact address, verified processor facts, and an external
privacy-choices route do not exist yet; inventing URLs would make the listing
less truthful. Version 1.0 also has no update notes.

## App Store Connect draft sync

Screenshots and listing copy are App Store metadata. A Cloudflare deployment,
Capacitor sync, Xcode build, archive, or binary upload cannot add them. This
repository therefore provides a separate owner-run App Store Connect API flow;
it is never triggered automatically by a push, app deploy, archive, or CI job.

The stable record is Apple app id `6804966098`, SKU
`knucklebones-ios-001`, bundle id `com.appavaria.knucklebones`, iOS version
`1.0`. Fastlane's target names are intentionally `APP_IPHONE_67` for iPhone
6.9-inch and `APP_IPAD_PRO_3GEN_129` for iPad 13-inch.

Install the pinned owner-local Ruby dependencies once:

```sh
mise exec -- npm run appstore:fastlane:install
```

Then use the three safety levels:

1. `mise exec -- npm run appstore:screenshots:check` is credential-free. It
   runs the focused repository contract and validates all 132 local exports,
   metadata, target mappings, and pure sync-planner cases.
2. Copy `.env.appstore.example` to ignored `.env.appstore`, fill the API-key
   fields and version, and run
   `mise exec -- npm run appstore:screenshots:plan`. The lane reads the exact
   editable app/version and the complete remote localization, metadata, and
   screenshot inventory. It prints the create/keep/update/upload/delete/order
   plan for all eleven managed locales and twenty-two locale/device sets plus a confirmation
   token bound to both desired files and that remote snapshot.
3. After reviewing the plan and machine-readable campaign approval, paste the
   token as `ASC_APP_STORE_SYNC_CONFIRM` and run
   `mise exec -- npm run appstore:screenshots:upload`. It re-reads under a
   local lock, creates only missing `en-GB`, `pt-BR`, `es-ES`, `de-DE`,
   `fr-FR`, `it`, `pl`, `tr`, `id`, `ja`, or `ko`
   localizations/target sets, patches only the five owned metadata fields, and
   synchronizes exactly six ordered images in each of the twenty-two managed sets.

Apple requires `name` in the create request for a new App Info localization.
The lane therefore creates a missing App Info locale with its already confirmed
localized `name` and `subtitle`, then re-reads App Store Connect before creating
the matching version locale. Apple can create that version localization as a
side effect; the lane adopts it when present and sends a version-localization
create request only when it is still absent. A race that returns a duplicate
conflict is re-read and adopted only for that same newly created locale.
Directly created values must match the confirmed request byte-for-byte. After
creation, the lane snapshots every newly visible unowned URL and `whatsNew`,
patches only the five owned fields to their confirmed values, and verifies the
complete state again before any screenshot work.

Planning refuses dirty or untracked campaign/uploader inputs. Mutation also
fails if the remote inventory changed after planning. Stale images are removed
only from their exact managed locale/device set, and unowned metadata plus
every other locale/device inventory must remain unchanged. Do not substitute
Fastlane's generic Deliver overwrite or metadata sync.

The machine-readable approval is deliberately split:
`draftSyncApproved: true` authorizes only this exact editable-draft mutation,
while `reviewSubmissionApproved: false` remains a hard release gate. The
manifest status must be exactly
`approved for draft App Store Connect synchronization`. The lane has no binary
upload or review-submission operation, and successful synchronization does not
make the app public.

Ranked runes are not shipped yet, so the BOUNTY image remains a future-state
preview: it may be staged in the draft, but the app must not be submitted until
ranked runes ship and every affected preview is regenerated from that shipping
implementation. Store-name clearance and localized legal/support URLs are
independent submission blockers as recorded in `docs/STATUS.md`.

For credentials, keep the one-time `.p8` download outside this repository and
point `ASC_KEY_PATH` at its absolute path. Set `ASC_KEY_ID`; set
`ASC_ISSUER_ID` for a team key and leave it empty for an individual key. No
Apple password belongs in this workflow. Apple's setup and localization
references are [App Store Connect API](https://developer.apple.com/help/app-store-connect/get-started/app-store-connect-api/),
[Localize app information](https://developer.apple.com/help/app-store-connect/manage-app-information/localize-app-information/),
and [Upload app previews and screenshots](https://developer.apple.com/help/app-store-connect/manage-app-information/upload-app-previews-and-screenshots/).
