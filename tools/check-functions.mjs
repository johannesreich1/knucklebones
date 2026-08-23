// Type-check the EXACT source closure that tools/fnfiles.mjs would deploy.
// The repository deliberately does not keep copies of src/core inside each
// function, so checking index.ts in place cannot resolve its synthetic
// `./core` imports. Materialize the upload in a private temp root, check it,
// then discard that root.
import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { allSlugs, fnFiles, uploadPayload } from './fnfiles.mjs';

const deno = process.env.DENO_BIN || 'deno';
const version = spawnSync(deno, ['--version'], { encoding: 'utf8' });
if (version.error?.code === 'ENOENT') {
  console.error('Deno is not installed; CI pins Deno 2.1.14 and runs this check.');
  process.exit(127);
}
if (version.status !== 0) {
  process.stderr.write(version.stderr || version.stdout);
  process.exit(version.status ?? 1);
}
process.stdout.write(version.stdout.split('\n')[0] + '\n');

let failed = false;
for (const slug of allSlugs()) {
  const closure = fnFiles(slug);
  if (closure.missing.length) {
    console.error(`${slug}: incomplete deploy closure`, closure.missing);
    failed = true;
    continue;
  }
  const root = mkdtempSync(path.join(os.tmpdir(), `knucklebones-${slug}-`));
  const functionDir = path.join(root, slug);
  mkdirSync(functionDir, { recursive: true });
  try {
    for (const file of uploadPayload(slug)) {
      const destination = path.resolve(functionDir, file.name);
      if (destination !== root && !destination.startsWith(root + path.sep)) {
        throw new Error(`${slug}: deploy path escapes its temporary root: ${file.name}`);
      }
      mkdirSync(path.dirname(destination), { recursive: true });
      writeFileSync(destination, file.content);
    }
    const result = spawnSync(deno, [
      'check', '--config', path.join(functionDir, 'deno.json'), path.join(functionDir, 'index.ts'),
    ], { stdio: 'inherit' });
    if (result.status !== 0) failed = true;
    else console.log(`ok  ${slug}`);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
}

process.exit(failed ? 1 : 0);
