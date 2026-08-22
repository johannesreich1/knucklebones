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
import { fnFiles, allSlugs, FN_DIR } from '../tools/fnfiles.mjs';

const problems: string[] = [];
const errs: string[] = [];
const check = (ok: boolean, msg: string) => { if (!ok) problems.push(msg); };

const manifest: Record<string, string[]> = {};

for (const slug of allSlugs()) {
  const { files, missing } = fnFiles(slug);
  manifest[slug] = files.map((f) => f.name);

  for (const m of missing) {
    problems.push(`${slug} imports ${m.name} (from ${m.from}) and NO file provides it — `
      + `this function cannot be deployed; fix the import or restore the module in src/`);
  }

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

/* THE CHECK MUST BE ABLE TO FAIL. A broken import scanner would hand every
   function a one-file manifest and pass everything above vacuously, which is
   the same shape of green-on-nothing that let the prose list rot unnoticed. */
for (const slug of ['pvp-join', 'pvp-move', 'pvp-claim']) {
  check(manifest[slug]?.includes('core/rules.ts'),
    `${slug}'s manifest does not carry core/rules.ts — the import scanner is broken, `
    + `not the function (every PvP function replays the rules server-side)`);
  check(manifest[slug]?.includes('config.ts'),
    `${slug}'s manifest does not carry config.ts — core/rules.ts imports it, so the `
    + `transitive walk in tools/fnfiles.mjs is not walking`);
}

/* Why the stale deployed copies were harmless rather than lucky: no function
   imports the spell layer, so nothing the server replays can diverge with it.
   Reported, not asserted — the day a function DOES need spells.ts is a real
   change, and this line is where you will remember that the deployed copies
   start mattering the moment it happens. */
const spellsShipped = Object.entries(manifest)
  .filter(([, files]) => files.includes('core/spells.ts')).map(([slug]) => slug);

/* config.ts is uploaded to every PvP function and carries the public Supabase
   keys by design — but never a service-role key, which would then be readable
   by every client that ships the same file. */
check(!/service_role|SERVICE_ROLE_KEY\s*=/.test(readFileSync('src/config.ts', 'utf8')),
  'src/config.ts names a service-role key — it ships to every client');

/* ---- an Edge Function may not SHADOW its own imports ----
   These files are the least-checked code in the repo: they are outside
   tsconfig (Deno globals and jsr: specifiers make tsc refuse them) and no
   suite imports them, so a name collision is invisible until it throws in
   production. It happened: core/bot.ts's botMove() was imported into pvp-move
   while a local `let botMove` already held the reply payload, and the local
   shadowed the import for the whole handler — every bot reply would have
   called null. Live pvp-move was still on the previous version, which is the
   only reason nobody saw it.

   A real parser would be better; this is a deliberately dumb text check, and
   dumb is what makes it cheap enough to keep. It looks only for a top-level
   binding that reuses an imported name. */
for (const slug of Object.keys(manifest)) {
  const src = readFileSync(`supabase/functions/${slug}/index.ts`, 'utf8');
  const imported = new Set();
  for (const m of src.matchAll(/^import\s*\{([^}]*)\}\s*from\s*["'][^"']+["'];/gm)) {
    for (const part of m[1].split(',')) {
      const name = part.trim().replace(/^type\s+/, '').split(/\s+as\s+/).pop()?.trim();
      if (name) imported.add(name);
    }
  }
  for (const m of src.matchAll(/^\s*(?:const|let|var)\s+([A-Za-z_$][\w$]*)/gm)) {
    check(!imported.has(m[1]),
      `${slug}/index.ts declares \`${m[1]}\` while also importing that name — the local `
      + `shadows the import, and calling it will throw at runtime. Rename the local.`);
  }
}

console.log(JSON.stringify({ manifest, spellsShipped, problems, errs }, null, 2));
