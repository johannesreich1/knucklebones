import { existsSync, readFileSync } from 'node:fs';
import { filesUnder, recomputeArtifactTag, sameBytes, tagIn } from './ios-artifacts.ts';

type Check = (ok: boolean, message: string) => void;

const WWW = 'native/www';
const SYNCED = 'native/ios/App/App/public';   // what cap sync copied into Xcode
const STANDALONE = 'knucklebones-neon.html';
const PWA_INDEX = 'pwa/index.html';
const PWA_SW = 'pwa/sw.js';
const WIDGET = 'widget.html';
const HARNESS = 'harness.html';

/* The provenance of the shipped web payload, as one unbroken chain: every
   built artifact carries one non-dev tag, that tag is recomputable from the
   shipped bytes alone, native/www is a clean mirror of dist/main rather than
   an accumulating folder, and cap sync copied exactly that into Xcode. */
export function verifyIosPayloadContract(
  check: Check,
  { requireSynced }: { requireSynced: boolean },
): void {
  /* run-all builds before it gates, so native/www is always present here. Guard
     anyway: absent, every assertion below would pass by iterating nothing. */
  const built = existsSync(`${WWW}/index.html`);
  check(built, `${WWW}/index.html does not exist — run \`mise exec -- node build.mjs\` before this gate`);

  if (built) {
    const nativeIndex = readFileSync(`${WWW}/index.html`, 'utf8');
    const artifactTags = {
      standalone: tagIn(STANDALONE),
      pwa: tagIn(PWA_INDEX),
      native: tagIn(`${WWW}/index.html`),
      widget: tagIn(WIDGET),
      harness: tagIn(HARNESS),
    };
    const tags = Object.values(artifactTags);
    check(tags.every((tag) => tag !== null && /^[a-f0-9]{8}$/.test(tag)),
      `every built artifact must carry a non-dev content tag: ${JSON.stringify(artifactTags)}`);
    check(new Set(tags).size === 1,
      `built artifacts disagree on release identity: ${JSON.stringify(artifactTags)}`);
    const tag = artifactTags.native;

    /* Native/www is a generated mirror, not an accumulating deployment folder.
       Compare the complete file set with the clean Vite source before checking
       bytes, so a deleted public note cannot survive forever in the app binary. */
    const expectedFiles = filesUnder('dist/main');
    const nativeFiles = filesUnder(WWW);
    const missingNative = expectedFiles.filter((file) => !nativeFiles.includes(file));
    const extraNative = nativeFiles.filter((file) => !expectedFiles.includes(file));
    check(expectedFiles.includes('index.html') && expectedFiles.includes('sw.js')
      && expectedFiles.includes('manifest.webmanifest'),
    'dist/main is incomplete — the native payload comparison would be vacuous');
    check(missingNative.length === 0 && extraNative.length === 0,
      `${WWW} differs from clean dist/main; missing=${missingNative.join(',') || 'none'}; `
      + `stale=${extraNative.join(',') || 'none'}`);

    /* Agreement alone is a false green: a hard-coded tag would agree everywhere.
       Independently reconstruct build.mjs's pre-stamp deliverables from the
       shipped bytes, then hash their logical names, lengths, and content. This
       also makes any omitted icon/manifest/widget/native byte fail the verifier. */
    if (tag) {
      const expectedTag = recomputeArtifactTag({
        tag,
        nativeDir: WWW,
        standalone: STANDALONE,
        pwaDir: 'pwa',
        widget: WIDGET,
        harness: HARNESS,
      });
      check(tag === expectedTag,
        `built artifacts carry tag ${tag}, but their independently recomputed content tag is ${expectedTag}`);
    }
    for (const file of expectedFiles) {
      const source = `dist/main/${file}`;
      const shipped = `${WWW}/${file}`;
      if (!existsSync(shipped)) continue;
      if (file === 'index.html') {
        const normalized = tag
          ? readFileSync(shipped, 'utf8').replace(`data-build="${tag}"`, 'data-build="dev"')
          : readFileSync(shipped, 'utf8');
        check(normalized === readFileSync(source, 'utf8'),
          `${shipped} is not the stamped dist/main single-file page`);
      } else if (file === 'sw.js') {
        const normalized = tag
          ? readFileSync(shipped, 'utf8').replace(`'kb-${tag}'`, "'kb-dev'")
          : readFileSync(shipped, 'utf8');
        check(normalized === readFileSync(source, 'utf8'),
          `${shipped} is not the version-stamped dist/main service worker`);
      } else {
        check(sameBytes(source, shipped), `${shipped} differs byte-for-byte from ${source}`);
      }
    }

    /* the single-file build inlines everything. The chunked PWA bundle does not,
       so a stray `rsync dist/pwa/ → native/www/` shows up as chunk references and
       an assets/ directory. That mistake shipped repeatedly on 2026-08-21. */
    check(!/<script[^>]+src="\.?\/?assets\//.test(nativeIndex) && !existsSync(`${WWW}/assets`),
      `${WWW} holds the CHUNKED pwa layout, not the single-file build — someone `
      + `rsynced dist/pwa/ over it. Re-run \`mise exec -- node build.mjs\`, which copies dist/main.`);

    /* the service worker inside the payload must be versioned like every other
       deliverable. Left at 'kb-dev' the bytes never change between builds, so iOS
       never installs a new worker and the cache-first icons and manifest from
       first launch outlive every app update. */
    if (existsSync(`${WWW}/sw.js`)) {
      const nativeSw = readFileSync(`${WWW}/sw.js`, 'utf8');
      check(!/const VERSION = 'kb-dev';/.test(nativeSw),
        `${WWW}/sw.js still carries the dev cache key 'kb-dev' — a dev service worker `
        + `inside the shipped iOS bundle. build.mjs stamps it with the build hash.`);
      if (tag) {
        check(nativeSw.includes(`'kb-${tag}'`),
          `${WWW}/sw.js cache key does not match the payload's build tag ${tag} — `
          + `the worker and the page it caches come from different builds`);
      }
    }

    const pwaSw = existsSync(PWA_SW) ? readFileSync(PWA_SW, 'utf8') : '';
    check(!!tag && pwaSw.includes(`'kb-${tag}'`),
      `${PWA_SW} cache key does not match the shared artifact tag ${tag}`);

    /* cap sync copies the payload into the Xcode project; compare every source
       byte. Capacitor itself adds exactly the two Cordova compatibility shims. */
    const syncedIndexExists = existsSync(`${SYNCED}/index.html`);
    if (requireSynced) {
      check(syncedIndexExists,
        `${SYNCED}/index.html is absent — explicit native verification requires a successful cap sync`);
    }
    if (requireSynced && syncedIndexExists) {
      const syncedFiles = filesUnder(SYNCED);
      const allowedGenerated = new Set(['cordova.js', 'cordova_plugins.js']);
      const missingSynced = nativeFiles.filter((file) => !syncedFiles.includes(file));
      const extraSynced = syncedFiles.filter((file) => !nativeFiles.includes(file));
      check(missingSynced.length === 0,
        `${SYNCED} omits native payload files: ${missingSynced.join(',')}`);
      check(extraSynced.every((file) => allowedGenerated.has(file)),
        `${SYNCED} contains stale/non-Capacitor files: ${extraSynced.join(',')}`);
      for (const file of nativeFiles) {
        check(sameBytes(`${WWW}/${file}`, `${SYNCED}/${file}`),
          `${SYNCED}/${file} differs from the payload cap sync was asked to copy`);
      }
    }
  }
}
