// Run every suite and exit non-zero if any reports a problem.
//
// The suites were written for a human reading `"problems": []` — they always
// exit 0. This runner is the machine-readable gate for CI: it builds, drives
// each suite, parses the JSON report, and fails on any problem or page error.
// Run from the repo root: mise exec -- node tests/run-all.mjs
// (or: mise exec -- npm test)
//
// PARALLEL by default on a dev machine, SEQUENTIAL on CI: the suites are
// independent processes (own browser, own storage, own server on a port the
// kernel picks — tests/serve.mjs), so locally they pool JOBS at a time and the
// wall clock is the longest chain, not the sum. CI's two-core runners are
// where parallel browser load buys flakes instead of time, so CI (env CI=true)
// keeps the one-at-a-time order this file always had. Override with --jobs N
// or KB_JOBS=N. The one suite that may never share is testupdate — it MUTATES
// pwa/ under the server every other served suite reads — so it always runs
// alone, last.
//
// PARALLEL ACROSS SESSIONS, TOO — with one rule: ONE GATE AT A TIME PER
// WORKING TREE. Every port is now per-run, so gates in different worktrees
// cannot reach each other's servers. Gates in the SAME checkout still share
// the build output, which no port can isolate — they queue on the lock below.
import { execFileSync, spawn } from 'node:child_process';
import { serveTree } from './serve.mjs';
import { acquireCheckoutLock } from './support/gate-lock.mjs';

const FILE_SUITES = [
  'test4', 'test6',
  { name: 'release-main', file: 'tests/release-main.test.mjs' },
  { name: 'native-startup-browser', file: 'tests/browser/native-startup.mjs' },
  { name: 'localization-browser', file: 'tests/browser/localization/run.mjs' },
  { name: 'test8', file: 'tests/browser/responsive/run.mjs' },
  'test9', 'test10',
  { name: 'test11', file: 'tests/browser/hud-settings/run.mjs' },
  'test12', 'test13',
  { name: 'spells-browser', file: 'tests/browser/spells/run.mjs' },
  'test15', 'test17', 'test18', 'test19', 'test20', 'test21', 'test23', 'test24',
];
const SERVED_SUITES = [
  'test7',
  { name: 'test16', file: 'tests/browser/online-ui/run.mjs' },
  'test22',
]; // read pwa/ over the shared server, read-only — poolable
// testupdate reads that same server but MUTATES pwa/ — it always runs alone, last
const SUITE_TIMEOUT_MS = 360_000;   // must clear test6/test10's worst-case random endgames on slow CI
const argJobs = process.argv.indexOf('--jobs');
const JOBS = Math.max(1, +(argJobs > 0 ? process.argv[argJobs + 1]
  : process.env.KB_JOBS ?? (process.env.CI ? 1 : 4)) || 1);

/* the pool: N workers drain one queue. JOBS=1 is exactly the old sequential
   runner — same code path, same order — so CI runs what it always ran. */
async function pool(tasks) {
  const q = [...tasks];
  await Promise.all(Array.from({ length: Math.min(JOBS, q.length) },
    async () => { while (q.length) await q.shift()(); }));
}

/* The gate is launched only after package engines/.nvmrc have selected and
   validated Node 24. This is deliberately the only child-process seam: every
   child inherits that exact executable instead of resolving a bare `node`
   through PATH and silently finding another installation. */
function runNode(args) {
  return new Promise(resolve => {
    const p = spawn(process.execPath, args, { cwd: process.cwd() });
    let out = '';
    p.stdout.on('data', d => out += d);
    p.stderr.on('data', d => out += d);
    const t = setTimeout(() => { p.kill('SIGKILL'); }, SUITE_TIMEOUT_MS);
    p.on('close', code => { clearTimeout(t); resolve({ code, out }); });
  });
}

// Each suite prints exactly one JSON.stringify(...) block (testupdate adds a
// trailing reminder line), so first "{" to last "}" is the report.
function parseReport(out) {
  const a = out.indexOf('{'), b = out.lastIndexOf('}');
  if (a < 0 || b < a) return null;
  try { return JSON.parse(out.slice(a, b + 1)); } catch { return null; }
}

let failed = 0;
function judge(name, { code, out }, verdict) {
  const rep = parseReport(out);
  const bad = code !== 0 || !rep || !verdict(rep);
  console.log(`${bad ? 'FAIL' : 'ok  '} ${name}`);
  if (bad) { failed++; console.log(out.trim().split('\n').map(l => '  | ' + l).join('\n')); }
}
const clean = rep => (rep.problems || []).length === 0 && (rep.errs || []).length === 0;

/* THE CHECKOUT LOCK — one gate at a time per working tree.
   Ports stopped being shared the day tests/serve.mjs started binding port 0,
   so two gates in two worktrees never touch. Two gates in the SAME checkout
   still do, and no port can help: the shared thing IS the build output.
   build.mjs rewrites pwa/ and dist/ at the start and again at the end, and
   testupdate deliberately rewrites pwa/index.html and pwa/sw.js mid-run to
   fake a deploy. A peer gating the same tree would read those mutations as
   its own build — red on a change it never made, or green on a tree it never
   built. There is nothing to isolate here, so gates queue instead.
   Worktrees remain the recommendation: a shared checkout gates everyone's
   uncommitted work at once, so a red suite cannot tell you WHOSE change it
   was. The lock only promises that the answer is about one tree state.
   Escape hatch for someone who knows their peer is idle: KB_NO_LOCK=1. */
const release = await acquireCheckoutLock();
execFileSync(process.execPath, ['build.mjs'], { stdio: 'inherit' }); // test6 needs harness.html, served suites need pwa/index.html

/* everything except testupdate shares ONE pool: the pure-Node gates, the
   file suites, bench3, and the two read-only served suites. pwa/ is served
   once, in-process, before the pool starts, so test7/test16 can land whenever
   a worker reaches them; the address travels to them in KB_URL. bench3's pass
   criterion is an equivalence flag, not a timing threshold, so company cannot
   fail it. */
const { url, stop } = await serveTree('pwa');
process.env.KB_URL = url;   // spawned suites inherit this — servedBase() reads it
try {
  const node = t => async () => judge(t,
    await runNode(['--experimental-strip-types', `tests/${t}.test.ts`]), clean);
  const suite = entry => async () => {
    const spec = typeof entry === 'string'
      ? { name: entry, file: `tests/${entry}.mjs` } : entry;
    judge(spec.name, await runNode([spec.file]), clean);
  };
  await pool([
    // pure-Node gates (no browser): seeded dice determinism + PvP match core
    ...['architecture', 'preferences', 'i18n', 'i18n-catalog', 'production-migrations', 'dice', 'match', 'modes', 'spells', 'scoring-ward', 'spell-ai', 'scoring-ward-ai', 'rune-matchups', 'rune-matchup-analysis', 'rune-ward-sensitivity', 'rune-sunder-sensitivity', 'online-api', 'gcauth', 'edge-handlers', 'edge-settlement', 'cssgraph', 'cssreach', 'design-library', 'ladder', 'ladderbench', 'botbench', 'fnsync', 'iosship', 'androidship', 'apple-identity', 'native-startup', 'live-safety', 'gate-lock'].map(node),
    ...FILE_SUITES.map(suite),
    // bench3 is a benchmark, not a pass/fail suite — but its helper-vs-inline
    // scoring equivalence check is a real correctness assertion.
    async () => judge('bench3', await runNode(['tests/bench3.mjs']), rep => rep.sameResult === true),
    ...SERVED_SUITES.map(suite),
  ]);
  // testupdate mutates pwa/ under the server — always alone, always last
  await suite('testupdate')();
} finally {
  stop();
}
execFileSync(process.execPath, ['build.mjs'], { stdio: 'ignore' }); // testupdate mutated pwa/ — restore it

console.log(failed ? `\n${failed} suite(s) FAILED` : '\nall suites green');
release();
process.exit(failed ? 1 : 0);
