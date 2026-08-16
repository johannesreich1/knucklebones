// Run every suite and exit non-zero if any reports a problem.
//
// The suites were written for a human reading `"problems": []` — they always
// exit 0. This runner is the machine-readable gate for CI: it builds, drives
// each suite, parses the JSON report, and fails on any problem or page error.
// Run from the repo root: node tests/run-all.mjs  (or: npm test)
import { spawn, execSync } from 'child_process';
import net from 'net';

const FILE_SUITES = ['test4', 'test6', 'test8', 'test9', 'test10', 'test11', 'test12'];
const SERVED_SUITES = ['test7', 'testupdate']; // need serve.py; testupdate mutates pwa/, so it runs last
const SUITE_TIMEOUT_MS = 360_000;   // must clear test6/test10's worst-case random endgames on slow CI

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

execSync('./build.sh', { stdio: 'inherit' }); // test6 needs harness.html, served suites need pwa/index.html

for (const t of FILE_SUITES) judge(t, await run('node', [`tests/${t}.mjs`]), clean);

// bench3 is a benchmark, not a pass/fail suite — but its helper-vs-inline
// scoring equivalence check is a real correctness assertion.
judge('bench3', await run('node', ['tests/bench3.mjs']), rep => rep.sameResult === true);

const server = spawn('python3', ['tests/serve.py'], { cwd: process.cwd(), stdio: 'ignore' });
try {
  await waitForPort(8123);
  for (const t of SERVED_SUITES) judge(t, await run('node', [`tests/${t}.mjs`]), clean);
} finally {
  server.kill();
}
execSync('./build.sh', { stdio: 'ignore' }); // testupdate mutated pwa/ — restore it

console.log(failed ? `\n${failed} suite(s) FAILED` : '\nall suites green');
process.exit(failed ? 1 : 0);
