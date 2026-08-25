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
which suppresses in-app legal navigation and emits no legal files. A `ready`
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
`knucklebones-game-center` file dependency is the native Game Center
implementation; iOS verification requires Capacitor and CocoaPods to register
it rather than accepting an unwired source directory.

`mise exec -- npm run native:assets:android` renders Android-only custom icon/splash inputs
from the shared vector generators, runs Capacitor Assets 3.0.5, and writes the
tracked legacy, round, adaptive, monochrome, light, dark, portrait, and
landscape resources without replacing the custom iOS appearance catalog.

`APP_ID`, `NATIVE_APP_NAME`, `NATIVE_STORE_NAME`, `APPLE_SERVICE_ID`, and the
Supabase-derived Apple callback in `src/config.ts` are the public sources of
truth. Native files that cannot import TypeScript are consistency-gated copies.
The installed iOS and Android label is **Knucklebones**, while their App Store
and Play listing name is **Knucklebones Neon**. The application id remains
`com.appavaria.knucklebones`; PWA metadata, URLs, and storage keys remain
unchanged.

`native/package.json` and its lock pin Capacitor core/CLI/iOS/Android 8.5.0,
Splash Screen 8.0.2, Capawesome Apple Sign-In 0.1.3, and Capacitor Assets 3.0.5.
Native dependency upgrades change compiler input and require both platform
contracts; they are not floating maintenance updates.

iOS deploys to 15 and uses Capacitor 8.5's UIScene lifecycle. The branded
launch screen stays up through synchronous Home composition; the global
Splash Screen bridge hides it on the next task with a 200 ms fade, while the
native five-second auto-hide remains a crash/error watchdog. The web and widget
entries do not import a native plugin.

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

Cloudflare Pages builds `main` and deploys immediately. Repository verification
is therefore preventive: choose focused/specialized gates for a well-contained,
low-risk change and `mise exec -- npm test` when the change is cross-cutting,
high-risk, or lacks decisive focused coverage. Deployment instructions or
dashboard state are not encoded into generated public artifacts.

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
- no live-reload URL, cleartext, backup/transfer path, committed signing
  secret, or debug release signing can enter a shipping artifact.
