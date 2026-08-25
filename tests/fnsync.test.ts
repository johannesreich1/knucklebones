// AN EDGE FUNCTION MUST BE DEPLOYABLE FROM THE REPO AS IT STANDS.
//
// The PvP functions import `./core/*.ts` — src/core, uploaded verbatim beside
// index.ts, so client and server run ONE rules implementation. Nothing in the
// repo copies those files: the upload is the copy. Which means two silent
// failure modes, both of which have already happened here:
//
//   1. The file set was written down in prose (supabase/functions/README.md)
//      and rotted. By 2026-08-22 it still named `elo.ts`, deleted long before,
//      and omitted `ladder.ts` and `modes.ts` — which every PvP function
//      imports. Deploy from that list and the function fails on its first
//      request, in production, with a module-not-found.
//   2. A shared file gets copied INTO supabase/functions/<slug>/core/ "just to
//      make the deploy easier". From then on the server runs a fork of the
//      rules that no test covers and no diff shows.
//
// This gate is static on purpose. What it can decide by reading the files is
// whether the repo's own manifest is coherent — every import resolves, nothing
// shadows the shared tree. What it CANNOT see is the live function: deployed
// code lives in Supabase, not in git, and only reading it back proves what is
// running there. That half is a deploy-time step (README), not a test — and
// forgetting it is exactly how pvp-join v18 came to run a rules engine that
// predates the spell layer while STATUS claimed the copies were current.
import { existsSync, readdirSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { deployContent, fnFiles, allSlugs, FN_DIR, uploadPayload } from '../tools/fnfiles.mjs';

const problems: string[] = [];
const errs: string[] = [];
const check = (ok: boolean, msg: string) => { if (!ok) problems.push(msg); };

const manifest: Record<string, string[]> = {};
const closures = new Map<string, ReturnType<typeof fnFiles>>();

for (const slug of allSlugs()) {
  const closure = fnFiles(slug);
  closures.set(slug, closure);
  const { files, missing } = closure;
  manifest[slug] = files.map((f) => f.name);

  for (const m of missing) {
    problems.push(m.from
      ? `${slug} imports ${m.name} (from ${m.from}) and NO file provides it — `
        + `this function cannot be deployed; fix the import or restore the module in src/`
      : `${slug} has no ${m.name} — every deployed function needs an isolated, pinned Deno config`);
  }

  check(new Set(files.map((file) => file.name)).size === files.length,
    `${slug}'s deploy closure contains a path more than once`);
  check(files.every((file) => !file.name.startsWith(`..${path.sep}`)),
    `${slug}'s MCP deploy closure contains a parent-directory path`);
  check(new Set(files.map((file) => file.source)).size === files.length,
    `${slug}'s deploy closure uploads one source file under multiple paths`);
  const payload = uploadPayload(slug);
  check(payload.length === files.length && payload.every((entry, index) =>
    entry.name === files[index].name && entry.content === deployContent(files[index])),
  `${slug}'s JSON upload payload differs from the checked deploy closure`);

  /* never hand-edit copies: a file inside the function directory that also
     exists in src/ wins the resolution above, so the fork would be invisible
     from here on. The upload is the only copy there may be. */
  const own = path.join(FN_DIR, slug);
  const localFiles: string[] = [];
  const walk = (dir: string) => {
    for (const e of readdirSync(dir, { withFileTypes: true })) {
      const p = path.join(dir, e.name);
      if (e.isDirectory()) walk(p);
      else if (e.name.endsWith('.ts')) localFiles.push(path.relative(own, p));
    }
  };
  walk(own);
  for (const f of localFiles) {
    check(!existsSync(path.join('src', f)),
      `${slug}/${f} shadows src/${f} — a hand-made copy of a shared module. `
      + `Delete it: the deploy uploads src/ directly (tools/fnfiles.mjs)`);
  }
}

/* Shared infrastructure is source-owned once. Relative imports from index,
   handler and operation may all reach it, but the deploy closure must dedupe
   that graph to one copy of each source file. */
for (const [slug, closure] of closures) {
  const shared = closure.files.filter((file) =>
    file.source.startsWith(path.join(FN_DIR, '_shared') + path.sep));
  check(shared.some((file) => file.source === path.join(FN_DIR, '_shared/http.ts')),
    `${slug}'s deploy closure omits the shared HTTP/auth infrastructure`);
  for (const source of new Set(shared.map((file) => file.source))) {
    check(shared.filter((file) => file.source === source).length === 1,
      `${slug} deploys ${source} more than once`);
  }
}

const PINNED_IMPORTS = {
  '@supabase/functions-js/edge-runtime.d.ts': 'jsr:@supabase/functions-js@2.112.3/edge-runtime.d.ts',
  '@supabase/supabase-js': 'npm:@supabase/supabase-js@2.112.3',
};
for (const slug of allSlugs()) {
  const configPath = path.join(FN_DIR, slug, 'deno.json');
  if (!existsSync(configPath)) continue;
  const config = JSON.parse(readFileSync(configPath, 'utf8'));
  check(JSON.stringify(config.imports) === JSON.stringify(PINNED_IMPORTS),
    `${slug}/deno.json must pin the approved JSR and npm dependencies exactly`);
  check(config.compilerOptions?.strict === true,
    `${slug}/deno.json must keep strict type checking enabled`);
  check(manifest[slug]?.includes('deno.json'),
    `${slug}'s deploy closure omits its deno.json`);
}

for (const slug of [
  'account-delete', 'pvp-join', 'pvp-move', 'pvp-claim',
  'pvp-rune-select', 'pvp-action',
]) {
  check(manifest[slug]?.includes('handler.ts') && manifest[slug]?.includes('operation.ts'),
    `${slug} must deploy its testable handler and separate operation`);
  const index = readFileSync(path.join(FN_DIR, slug, 'index.ts'), 'utf8');
  check(!/\.from\(|\.rpc\(|request\.json\(|req\.json\(/.test(index),
    `${slug}/index.ts contains request or database logic instead of a thin Deno.serve adapter`);
}

/* THE CHECK MUST BE ABLE TO FAIL. A broken import scanner would hand every
   function a one-file manifest and pass everything above vacuously, which is
   the same shape of green-on-nothing that let the prose list rot unnoticed. */
for (const slug of ['pvp-join', 'pvp-move', 'pvp-claim', 'pvp-action']) {
  check(manifest[slug]?.includes('core/rules.ts'),
    `${slug}'s manifest does not carry core/rules.ts — the import scanner is broken, `
    + `not the function (every PvP function replays the rules server-side)`);
  check(manifest[slug]?.includes('config.ts'),
    `${slug}'s manifest does not carry config.ts — core/rules.ts imports it, so the `
    + `transitive walk in tools/fnfiles.mjs is not walking`);
}

/* Rune Trial is the first ranked protocol that ships the spell layer. Keep it
   visible in the report because those shared sources now participate in the
   authoritative replay closure and must deploy with pvp-action/join/claim. */
const spellsShipped = Object.entries(manifest)
  .filter(([, files]) => files.includes('core/spells.ts')).map(([slug]) => slug);

/* config.ts is uploaded to every PvP function and carries the public Supabase
   keys by design — but never a service-role key, which would then be readable
   by every client that ships the same file. */
check(!/service_role|SERVICE_ROLE_KEY\s*=/.test(readFileSync('src/config.ts', 'utf8')),
  'src/config.ts names a service-role key — it ships to every client');

/* ---- an Edge Function may not SHADOW its own imports ----
   Node exercises the runtime-free handlers and CI runs Deno check, but this
   cheap static guard catches a class of binding failure before either runtime
   starts. It happened: core/bot.ts's botMove() was imported into pvp-move
   while a local `let botMove` already held the reply payload, and the local
   shadowed the import for the whole handler — every bot reply would have
   called null. Live pvp-move was still on the previous version, which is the
   only reason nobody saw it.

   A real parser would be better; this is a deliberately dumb text check, and
   dumb is what makes it cheap enough to keep. It looks only for a top-level
   binding that reuses an imported name. */
for (const slug of Object.keys(manifest)) {
  const localModules = closures.get(slug)?.files
    .filter((file) => file.source.startsWith(path.join(FN_DIR, slug) + path.sep)
      && file.source.endsWith('.ts')) ?? [];
  for (const module of localModules) {
    const src = readFileSync(module.source, 'utf8');
    const imported = new Set<string>();
    for (const m of src.matchAll(/^import\s*\{([^}]*)\}\s*from\s*["'][^"']+["'];/gm)) {
      for (const part of m[1].split(',')) {
        const name = part.trim().replace(/^type\s+/, '').split(/\s+as\s+/).pop()?.trim();
        if (name) imported.add(name);
      }
    }
    for (const m of src.matchAll(/^\s*(?:const|let|var)\s+([A-Za-z_$][\w$]*)/gm)) {
      check(!imported.has(m[1]),
        `${slug}/${module.name} declares \`${m[1]}\` while also importing that name — the local `
        + `shadows the import, and calling it will throw at runtime. Rename the local.`);
    }
  }
}

console.log(JSON.stringify({ manifest, spellsShipped, problems, errs }, null, 2));
