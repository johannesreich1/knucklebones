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

## Native wrapper

The Capacitor configuration, dependency locks, Game Center plugin, and iOS
Xcode project under `native/` are tracked source. `native/www/`, Pods, derived
data, and other generated payloads are ignored.

`npm run build` generates `native/www/` but never invokes Capacitor. This keeps
the deterministic web build independent of local CocoaPods/Xcode state.
`npm run native:sync` builds and then runs Capacitor explicitly; failures are
not swallowed. `npm run native:verify` performs that sync and additionally
requires the complete generated Xcode payload and configuration to match the
new build. The tracked `knucklebones-game-center` file dependency is the native
Game Center implementation; verification requires Capacitor and CocoaPods to
register it rather than accepting the presence of an unwired source directory.

`APP_ID` in `src/config.ts` is the canonical application identifier. Browser
identity imports it directly; `tests/iosship.test.ts` requires the unavoidable
Capacitor, Xcode, Info.plist, and Game Center verifier copies to agree. The
product-name decision remains open and may eventually require changing this id
through the same consistency contract.

## Node and CI

`.nvmrc` is the repository Node source of truth: Node 24. `package.json`
enforces the supported major and CI consumes `.nvmrc` rather than copying a
second version literal. `build.mjs` also runs TypeScript and Vite with its own
`process.execPath`, preventing a different `npx` installation from silently
using another Node runtime.

Cloudflare Pages builds `main` and deploys immediately. The repository gate is
therefore preventive: run `npm test` before pushing. Deployment instructions
or dashboard state are not encoded into generated public artifacts.

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
  that platform is in scope.
