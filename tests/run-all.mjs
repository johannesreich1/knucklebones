// Run every suite and exit non-zero if any reports a problem.
//
// The suites were written for a human reading `"problems": []` — they always
// exit 0. This runner is the machine-readable gate for CI: it builds, drives
// each suite, parses the JSON report, and fails on any problem or page error.
// Run from the repo root: node tests/run-all.mjs  (or: npm test)
//
// PARALLEL by default on a dev machine, SEQUENTIAL on CI: the suites are
// independent processes (own browser, own storage, own port where they need
// one — 8124-6 are per-suite, 8123's readers tolerate company), so locally
// they pool JOBS at a time and the wall clock is the longest chain, not the
// sum. CI's two-core runners are where parallel browser load buys flakes
// instead of time, so CI (env CI=true) keeps the one-at-a-time order this
// file always had. Override with --jobs N or KB_JOBS=N. The one suite that
// may never share is testupdate — it MUTATES pwa/ under the server every
// other served suite reads — so it always runs alone, last.
import { spawn, execSync } from 'child_process';
import net from 'net';

const FILE_SUITES = ['test4', 'test6', 'test8', 'test9', 'test10', 'test11', 'test12', 'test13', 'test14', 'test15', 'test17', 'test18', 'test19'];
const SERVED_SUITES = ['test7', 'test16']; // read pwa/ over serve.py, read-only — poolable
// testupdate also needs serve.py but MUTATES pwa/ — it always runs alone, last
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

function run(cmd, args) {
  return new Promise(resolve => {
    const p = spawn(cmd, args, { cwd: process.cwd() });
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

function waitForPort(port, tries = 50) {
  return new Promise((resolve, reject) => {
    const attempt = n => {
      const s = net.connect(port, '127.0.0.1');
      s.on('connect', () => { s.end(); resolve(); });
      s.on('error', () => n > 0 ? setTimeout(() => attempt(n - 1), 200) : reject(new Error('serve.py never came up')));
    };
    attempt(tries);
  });
}

execSync('node build.mjs', { stdio: 'inherit' }); // test6 needs harness.html, served suites need pwa/index.html

/* everything except testupdate shares ONE pool: the pure-Node gates, the
   file suites, bench3, and the two read-only served suites. serve.py goes up
   first so test7/test16 can land whenever a worker reaches them. bench3's
   pass criterion is an equivalence flag, not a timing threshold, so company
   cannot fail it. */
const server = spawn('python3', ['tests/serve.py'], { cwd: process.cwd(), stdio: 'ignore' });
try {
  await waitForPort(8123);
  const node = t => async () => judge(t, await run('node', ['--experimental-strip-types', `tests/${t}.test.ts`]), clean);
  const suite = t => async () => judge(t, await run('node', [`tests/${t}.mjs`]), clean);
  await pool([
    // pure-Node gates (no browser): seeded dice determinism + PvP match core
    ...['dice', 'match', 'modes', 'spells', 'gcauth', 'cssreach', 'ladder', 'ladderbench', 'botbench'].map(node),
    ...FILE_SUITES.map(suite),
    // bench3 is a benchmark, not a pass/fail suite — but its helper-vs-inline
    // scoring equivalence check is a real correctness assertion.
    async () => judge('bench3', await run('node', ['tests/bench3.mjs']), rep => rep.sameResult === true),
    ...SERVED_SUITES.map(suite),
  ]);
  // testupdate mutates pwa/ under the server — always alone, always last
  await suite('testupdate')();
} finally {
  server.kill();
}
execSync('node build.mjs', { stdio: 'ignore' }); // testupdate mutated pwa/ — restore it

console.log(failed ? `\n${failed} suite(s) FAILED` : '\nall suites green');
process.exit(failed ? 1 : 0);
