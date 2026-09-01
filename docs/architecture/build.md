# Build and delivery architecture

Read this page for Vite, PWA, service worker, widget, native, deployment, or
application identity changes.

## Source and outputs

`build.mjs` type-checks and performs three Vite builds from `src/`, then
assembles four deliverables with one content-derived build tag. The tag hashes
the fixed-placeholder bytes of every assembled output, including public PWA
assets and the widget-only bundle, before stamping any output; no artifact can
refer to its own final hash while that hash is being derived:

| Output | Purpose |
|---|---|
| `pwa/` | Hosted, chunked PWA with generated precache metadata |
| `knucklebones-neon.html` | Self-contained standalone page |
| `widget.html` and `harness.html` | Embeddable fragment and host harness |
| `native/www/` | Generated Capacitor web assets |

`dist/`, `pwa/`, `native/www/`, generated service workers, and design output
are build products. Edit sources and templates, then rebuild; never patch an
output by hand.

The three runtime entries are:

- `src/main.ts` plus `vite.config.mjs` for the single-file application;
- `src/main.ts` plus `vite.pwa.config.mjs` for the chunked hosted PWA;
- `src/widget.ts` plus `vite.widget.config.mjs` for the widget.

## Public assets and service worker

`public/` contains assets intentionally copied into standalone and PWA builds.
It must not contain maintainer notes, live credentials, deployment recipes, or
claims about application privacy. Repository documentation belongs in `docs/`
or the root README.

`public/sw.js` is the template. `build.mjs` supplies the version/cache key and
the PWA precache list from actual output. A build assertion must fail when an
expected substitution or artifact is missing.

Public legal pages are generated from `src/legal/`, never maintained as a
second prose copy under `public/`. The checked-in publication state is `draft`,
which emits no legal files or Home door; Settings/auth deliberately expose the
same document with pending-fact placeholders. A `ready`
build validates every required fact and review flag, then writes the 24
locale/page routes into `dist/pwa/` before the hosted file snapshot, build hash,
and worker precache list are calculated. A missing fact, locale chrome label,
page introduction, or structured body block makes the build fail; it cannot
produce an empty or partially populated policy.

The worker treats only the root and the generator-supplied legal routes as
cacheable pages. It normalizes `/` and `/index.html` to one app-shell key and
keeps every legal route under its own trailing-slash key. Unknown navigations
go to the network without a Home fallback, and failed assets never fall back to
HTML. This prevents a legal visit from poisoning offline Home and prevents a
missing JavaScript file from being answered with the app shell.
The fact/review blockers and ordered database, client, legal-publication, and
store-metadata release steps live in `docs/LEGAL.md`.

## Native wrapper

The Capacitor configuration, pinned dependency lock, Game Center plugin, iOS
Xcode project, Android Gradle project, and both platforms' generated resource
catalogs under `native/` are tracked compiler input. `native/www/`,
`node_modules`, Pods, Gradle output, derived data, local SDK paths, keystores,
and `keystore.properties` are ignored.

`mise exec -- npm run build` generates `native/www/` but never invokes Capacitor. This keeps
the deterministic web build independent of local CocoaPods/Xcode state.
The root scripts make the native mutation explicit:

| Scope | Sync | Open | Verify |
|---|---|---|---|
| both | `mise exec -- npm run native:sync` | — | `mise exec -- npm run native:verify` |
| iOS | `mise exec -- npm run native:sync:ios` | `mise exec -- npm run native:open:ios` | `mise exec -- npm run native:verify:ios` |
| Android | `mise exec -- npm run native:sync:android` | `mise exec -- npm run native:open:android` | `mise exec -- npm run native:verify:android` |

Every sync first rebuilds `native/www/`; failures are not swallowed. Verify
then checks the platform's tracked manifests, plugins, assets, versions,
security settings, and the exact web bytes copied by Capacitor. The tracked
`knucklebones-game-center` and `knucklebones-app-icon` file dependencies are
the native Game Center and profile-launcher implementations; verification
requires Capacitor and the platform build to register them rather than
accepting unwired source directories.

`mise exec -- npm run native:assets:android` renders Android-only custom icon/splash inputs
from the shared vector generators, runs Capacitor Assets 3.0.5, and writes the
tracked legacy, round, adaptive, monochrome, light, dark, portrait, and
landscape resources without replacing the custom iOS appearance catalog.

`APP_ID`, `NATIVE_APP_NAME`, `NATIVE_STORE_NAME`, and the
Supabase-derived Apple callback in `src/config.ts` are the public sources of
truth. Native files that cannot import TypeScript are consistency-gated copies.
The installed iOS and Android label is **Knucklebones**, while their App Store
and Play listing name is **Knucklebones Neon**. The application id remains
`com.appavaria.knucklebones`; PWA metadata, URLs, and storage keys remain
unchanged.

`native/package.json` and its lock pin Capacitor core/CLI/iOS/Android 8.5.0,
Share 8.0.1, Splash Screen 8.0.2, Capawesome Apple Sign-In 0.1.3, and Capacitor
Assets 3.0.5. Result sharing reads Capacitor's injected global Share bridge so
the standalone, PWA, and widget entries do not import a native plugin.
Native dependency upgrades change compiler input and require both platform
contracts; they are not floating maintenance updates.

iOS deploys to 15 and uses Capacitor 8.5's UIScene lifecycle. The branded
launch screen stays up through synchronous Home composition; the global
Splash Screen bridge hides it on the next task with a 200 ms fade, while the
native five-second auto-hide remains a crash/error watchdog. The web and widget
entries do not import a native plugin. `tools/splash.mjs` draws the larger fixed
cyan-five mark directly on the full 2732px canvas and supplies a full-canvas
radial cyan falloff over `#05060e`; it must not enlarge a smaller icon raster or
CSS shadow, because either path truncates the glow into a visible square. The
same source feeds every tracked Android portrait/landscape and normal/night
splash rendition.

### Profile-driven launcher icons

`src/profile-avatar.ts` owns the canonical profile/avatar vocabulary: six die
faces crossed with the seven `HUE_IDS` entries, for 42 values. `die:5:cy` is
the installed app's primary cyan-five icon. Every other value maps mechanically
from `die:<face>:<hue>` to the native id `die-<face>-<hue>`; native bridges
accept no arbitrary catalog, component, or resource name.

The icon set is generated compiler input, not 41 hand-maintained designs.
`mise exec -- node tools/appicon.mjs` renders the fixed web icons plus iOS from
the shared die markup and CSS. `mise exec -- npm run native:assets:android`
renders Android and runs the Android finalizer. Both refresh the tracked
`native/profile-app-icons.manifest.json`; after the Android finalizer it is the
complete deterministic record of:

- its schema version and generator/source components;
- the primary avatar and launcher id;
- all 42 avatar-to-iOS-catalog and avatar-to-Android-alias/resource mappings;
- SHA-256 hashes for every generated profile-icon asset.

The manifest contains no timestamp, so the same sources produce the same bytes
and provenance. Verification derives the registry from source, checks complete
coverage and mappings, and rejects a stale generated file or hash. Do not edit
an alternate catalog, alias, or density resource by hand.

On iOS, `AppIcon.appiconset` is the primary and the other 41 values each have
an alternate app-icon catalog. Debug and Release list the exact alternates in
`ASSETCATALOG_COMPILER_ALTERNATE_APPICON_NAMES`; Xcode then generates
`CFBundlePrimaryIcon` and `CFBundleAlternateIcons`, so those keys do not belong
as a second manual registry in source `Info.plist`. Every catalog has an
authored opaque Any/Light rendition on the requested charcoal gradient, a
transparent Dark rendition with a compact halo for Apple's system background,
and a grayscale Tinted rendition whose pips are transparent cutouts. iOS
derives Clear from that authored monochrome source; the final Clear and Tinted
pixels remain system-owned and therefore require device visual acceptance
rather than a checked-in color claim.
The Capacitor bridge compares `UIApplication.alternateIconName` before calling
`setAlternateIconName`, keeping launch reconciliation silent when the correct
icon is already selected. A real change uses the system API and therefore shows
iOS's system confirmation alert. An OS error leaves the old launcher selected.

On Android, 42 exported launcher `activity-alias` entries target the same
`MainActivity`. Each alias carries its canonical `knucklebones.profileIcon`
metadata and one generated icon resource; exactly one alias is enabled. Android
13+ applies the complete component-state change atomically. On API 24–32 the
bridge enables the requested alias before disabling the old one, preferring a
temporary duplicate over making the installed app unreachable. The selected
PackageManager state is synchronous and verifiable, but launcher rendering is
owned by the installed launcher: pixels can refresh after a cache delay, and
some OEM launchers may replace or remove an existing manually placed Home item
instead of repainting it in place. The app must not claim that launcher pixels
have refreshed. Aliases omit a separate `roundIcon`: adaptive masking supplies
the round path on API 26+, while the legacy alias bitmap is round-safe. Android
themed icons preserve the selected face and cut-out pip silhouette, but the OS
owns their monochrome tint, so the profile hue is deliberately absent there.

The catalogs and aliases make the capability available; they do not activate
it automatically. The installed iOS/Android Settings control is off by default
and records its choice only for that installation, never in Supabase. Enabling
it applies the current confirmed profile die, and later confirmed profile reads
or saves reconcile only while it remains enabled. Explicit Off, sign-out, or an
account replacement restores primary. While disabled, startup performs one
idempotent primary reconciliation so new installs keep the default and installs
that saw the briefly released automatic behaviour are repaired. Bridge or
launcher failures remain cosmetic and never block startup or profile state.

Only the native launcher is profile-driven. The primary public/PWA/standalone
and widget art, plus iOS/Android splash and in-app loading art, remain the fixed
cyan neon five. Web/PWA/widget Settings do not render the native icon choice.
Startup never waits for icon reconciliation, and an icon error cannot become an
account, profile, or navigation failure.

The release shell is portrait-only on iOS and Android. The universal iOS target
explicitly requests the temporary full-screen compatibility mode so its
portrait-only declaration remains App Store-valid until the post-release
resizable/landscape pass; a pointer-independent in-app landscape fallback also
covers windowed native scenes. Android declares
the application as a game so its portrait request remains in the documented
Android 16 large-screen game exception. The hosted manifest requests portrait,
and the main app shows a localized rotate-device gate in landscape whenever
the mobile device exposes any coarse pointer — both an ordinary browser and an
installed PWA, including a touch tablet with a connected mouse. Desktop
tabs/PWAs (including touch-enabled desktops) and the separately booted widget
remain usable. The dormant landscape game layout remains source-only until a
separate post-release review deliberately re-enables it.

### iOS signing and owner release

The owner confirmed the paid team plus Sign in with Apple and Game Center on
App ID `com.appavaria.knucklebones` on 2026-08-25. `App/App.entitlements` is
therefore configured through `CODE_SIGN_ENTITLEMENTS` in both App target build
configurations and exposed as the target's entitlements file; the matching
Xcode `SystemCapabilities` entries keep Signing & Capabilities authoritative.
Automatic signing remains assigned to team `4RKFC79X48`. The iOS shell contract
checks those settings and the exact entitlement payload.

Portal state and repository wiring do not prove that a generated profile or
signed product contains those capabilities. Before release, use Xcode to
refresh signing, build on a physical device, archive Release, and inspect the
signed app entitlements. Apple attach/restore and Game Center identity also
remain device acceptance, while the Services ID, Supabase switches, deletion
revocation, and held Game Center backend rollout remain separate checklist
items in `docs/IDENTITY.md`.

### App Store localized draft delivery

The App Store Connect record is fixed in
`marketing/app-store/ios/app-store-connect.json`: Apple app id `6804966098`,
SKU `knucklebones-ios-001`, bundle id `com.appavaria.knucklebones`, and initial
version `1.0`. Fastlane 2.238.0 is pinned by `Gemfile.lock`. This owner-local
workflow is deliberately separate from Cloudflare deployment and from binary
upload. It owns five listing fields and six screenshots for each combination
of `en-GB`, `de-DE`, and `fr-FR` with iPhone 6.9-inch and iPad 13-inch: 36
final images across six managed screenshot sets.

| Command | Effect |
|---|---|
| `mise exec -- npm run appstore:fastlane:install` | Install the locked Ruby dependencies into ignored `vendor/bundle/` |
| `mise exec -- npm run appstore:screenshots:generate` | Rebuild the runtime, capture 42 real-runtime source frames, finalize 36 exports, and verify the complete locale/device matrix |
| `mise exec -- npm run appstore:screenshots:verify` | Read-only locale coverage, PNG, dimensions, alpha, provenance, metadata-limit, and SHA-256 validation |
| `mise exec -- npm run appstore:screenshots:contract` | Focused listing identity, export, dependency-pin, and mutation-guard contract |
| `mise exec -- npm run appstore:screenshots:test` | Pure planner safety cases, including duplicates and the ten-item capacity boundary |
| `mise exec -- npm run appstore:screenshots:check` | Repeat local validation through pinned Fastlane and prove both Apple display-type mappings |
| `mise exec -- npm run appstore:screenshots:plan` | Authenticate read-only and print exact localization, owned-metadata, and six-set changes plus an inventory-bound confirmation token |
| `mise exec -- npm run appstore:screenshots:upload` | After exact draft-sync approval, create missing managed localizations, patch only owned fields, and synchronize all six screenshot sets |

The lane never uses generic Deliver overwrite/sync. It creates no app or app
version, uploads no binary, and never submits for review. It owns only
`name`, `subtitle`, `promotionalText`, `keywords`, and `description`; support,
privacy, privacy-choices, and marketing URLs plus update notes remain untouched.
It preserves every other locale and device set, uploads before deleting where
capacity permits, and requires an exact plan token before any mutation. The
`.p8` key stays outside the repository; `.env.appstore` is ignored.

The machine-readable permissions deliberately separate editable-draft staging
from release: `draftSyncApproved: true` plus manifest status
`approved for draft App Store Connect synchronization` authorizes only the
reviewed draft mutation, while `reviewSubmissionApproved: false` remains a
hard gate. Ranked runes must ship and every affected preview must be
regenerated from that shipping implementation before review submission.
Store-name clearance and truthful localized public legal/support URLs remain
separate submission blockers. The detailed capture, regeneration, credential,
plan, metadata-ownership, and approval procedure lives in
`marketing/app-store/ios/README.md`.

Generated marketing images are compiler-like outputs for this workflow. If a
product/design/localization change affects one screenshot state, regenerate
that state for all three managed campaign locales and both devices in the same change; shared
layout, typography, framing, or pipeline changes require the complete 42-raw /
36-final matrix. Updated raw frames, exports, checksums, provenance, and contact
sheets must ship beside the source change. A stale preview is a failed handoff.

Android uses `com.appavaria.knucklebones` for both namespace and application
id, minSdk 24, compile/target SDK 36, AGP 8.13.0, Gradle 8.14.3, and Java 21.
Its initial release metadata is versionCode 1 and versionName `1.0`. The two
SDK settings have deliberately different jobs: minSdk 24 is the install floor
(Android 7.0), while targetSdk 36 opts into current platform behavior and does
not exclude API 24–35 devices. API 24 is also Capacitor 8's supported Android
floor. API 36 is the Google Play submission target required for new apps and
updates from August 31, 2026. There is no maxSdk restriction. Framework
attributes introduced after API 24 belong in version-qualified resources so a
lint fix may never silently raise the install floor. Cleartext traffic and
backups/device transfer are disabled, and the manifest requests only Internet
access.

### Android signing and owner release

This owner/store rehearsal is explicitly deferred as of 2026-08-24. The
configuration remains release-gated below; an unsigned CI bundle is not a
substitute for completing it before the first store submission.

`mise exec -- npm run native:bundle:android` syncs Android, then invokes the guarded release
builder. It requires ignored `native/android/keystore.properties` with all four
values from `keystore.properties.example`, builds `bundleRelease`, and verifies
the resulting AAB signature. Missing or incomplete secrets are fatal; the
release task never falls back to debug signing.

Johannes keeps the upload keystore outside Git and uses a distinct upload key
with Play App Signing. In Play Console he creates the listing under the
unchanged package id `com.appavaria.knucklebones`, sets its listing name to
**Knucklebones Neon**, enrolls in Play App Signing, and manually uploads
`native/android/app/build/outputs/bundle/release/app-release.aab`. CI receives
no Play credentials and never publishes. Store-name legal/trademark clearance
remains unresolved; a technically valid bundle is not approval to submit it.

## Node and CI

`.nvmrc` is the repository Node source of truth: Node 24. `mise.toml` enables
that idiomatic pin and owns the managed zsh activation, so entering the
checkout selects the same runtime for `node`, `npm`, `npx`, Vite, Capacitor,
and JavaScript shebangs. Run non-interactive or agent commands through
`mise exec --`; machine-specific Node paths are not a supported entry point.
`package.json` enforces the supported major through both `engines` and npm's
source-worktree `devEngines` check, while CI and Cloudflare consume `.nvmrc`
instead of copying a second version literal.

Runnable local recipes, agent launch configurations, and tool help text use
`mise exec --` at their outer boundary. Bare `node`, `npm`, Vite, and Capacitor
names inside package scripts are deliberate children of that selected runtime;
GitHub Actions and Cloudflare may also invoke them directly only after their
environment has selected `.nvmrc`.

Hash-pinned historical evidence sources keep their frozen bytes, including any
embedded legacy command examples: changing those strings would invalidate the
recorded provenance without rerunning the study. Their current regeneration
recipes live in the surrounding evidence documentation and use `mise exec --`.

This is intentionally a host toolchain rather than a Node Docker image. The
integrated iOS path continues from the web build into host CocoaPods and Xcode;
a Linux container would split that workflow without supplying Apple's native
toolchain. Database isolation remains Docker-owned because it has no such
host-native handoff.

`build.mjs` runs TypeScript and Vite with its own `process.execPath`, preventing
a child `npx` installation from silently using another Node runtime. The
release runner applies the same rule to both builds and every test/benchmark
child, so entering the gate through `mise exec --` cannot fall back to a
different bare `node` found on `PATH`.

Cloudflare's dashboard git integration builds `main` and deploys immediately,
without waiting for CI. The `deploy` job in `.github/workflows/ci.yml` exists to
end that: on a push to `main` it waits for the manifest preflight and all four
shards, rebuilds `pwa/` with this repository's own `npm run build` under
`.nvmrc` Node, and publishes that exact output with a pinned
`wrangler pages deploy`. The live site is a classic Pages project, so it is
`pages deploy` and not `wrangler deploy`; `wrangler.jsonc` is inert for this
command and must not be turned into the deploy source.

That job is deliberately not live yet. Its condition also requires the
`DEPLOY_VIA_ACTIONS` repository variable to equal `true`, so it is skipped until
Johannes adds the Cloudflare credentials, sets the variable, and disconnects the
dashboard build — the ordered owner action in `docs/STATUS.md`. Pull requests
never reach it, so PR cost is unchanged, and unsetting the variable reverts to
the dashboard path without a code change.

Until that variable is set, repository verification is the only thing keeping an
unverified commit off the live site, so it stays preventive: choose
focused/specialized gates for a well-contained, low-risk change and
`mise exec -- npm test` when the change is cross-cutting, high-risk, or lacks
decisive focused coverage. Deployment instructions or dashboard state are not
encoded into generated public artifacts.

The separate `android` CI job consumes both npm lockfiles under Node 24, uses
Temurin Java 21 and Android SDK/build-tools 36, syncs Android, runs the native
contract, Gradle unit/lint/debug tasks, and builds an unsigned release AAB. A
second artifact-level contract verifies package, version, target/security
metadata, and that the release is not debug-signed before CI uploads it for
seven days as `knucklebones-neon-unsigned-aab`. That artifact is labelled and
intended for verification only; it cannot replace Johannes's locally signed
Play upload.

## Build verification

A build change must prove:

- type checking and all three Vite builds succeed;
- every artifact carries the same build tag;
- the generated service worker lists the real hosted assets and a new cache
  key when source changes;
- the standalone page operates without a server;
- the hosted PWA loads, updates, and works offline under its tested contract;
- the widget fragment mounts once and stays isolated from its host;
- native web assets are current, and native sync/verification succeeds when
  that platform is in scope;
- branded native resources, names, ids, versions, SDKs, plugins, pods, and
  lifecycle manifests agree with the canonical source;
- the profile-icon provenance manifest covers all 42 avatars, the primary plus
  41 alternates agree with both native registries, and every generated hash
  matches the asset that ships;
- no live-reload URL, cleartext, backup/transfer path, committed signing
  secret, or debug release signing can enter a shipping artifact.
