// Machine-enforcement for the repo rule that new TypeScript is typed:
// tests/ and tools/ execute through `node --experimental-strip-types`, which
// erases annotations without checking them, so this suite runs the dedicated
// tsconfig.tests.json project through the pinned compiler and fails on any
// diagnostic. src/ stays owned by the root tsconfig gate inside build.mjs.
// Run: mise exec -- node --experimental-strip-types tests/typecheck-tests.test.ts
import { spawnSync } from 'node:child_process';

const problems: string[] = [];
const errs: string[] = [];

const result = spawnSync(process.execPath, [
  'node_modules/typescript/bin/tsc', '-p', 'tsconfig.tests.json',
], { encoding: 'utf8', timeout: 300_000 });

if (result.error) {
  errs.push(String(result.error));
} else if (result.status !== 0) {
  const output = `${result.stdout ?? ''}${result.stderr ?? ''}`.trim();
  if (output) problems.push(...output.split('\n').filter(Boolean));
  else problems.push(`tsc exited ${result.status} without diagnostics`);
}

console.log(JSON.stringify({ project: 'tsconfig.tests.json', problems, errs }, null, 2));
process.exitCode = problems.length || errs.length ? 1 : 0;
