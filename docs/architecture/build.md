# Build and delivery architecture

Read this page for Vite, PWA, service worker, widget, native, deployment, or
application identity changes.

## Source and outputs

`build.mjs` type-checks and performs three Vite builds from `src/`, then
assembles four deliverables with one content-derived build tag:

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

The deterministic web build should be independently verifiable. Native sync
must be an explicit, fail-fast command or verification step; the presence of a
local native checkout must not make an otherwise green web build silently
swallow a failed sync.

Application name, bundle id, URL schemes, entitlements, and test expectations
must derive from one source where tooling permits, with a consistency gate for
unavoidable platform copies. The current name/app-id decision remains open;
do not normalize an intentional placeholder into a shippable identity without
the owner decision recorded in `docs/STATUS.md`.

## Node and CI

`.nvmrc` is the repository Node source of truth. Local builds, package engine
constraints, CI, design-card imports, and Supabase client tooling must remain
on a supported compatible version. CI should consume `.nvmrc` rather than copy
another version literal.

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
