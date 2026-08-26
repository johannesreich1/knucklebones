// Complete release gate. Local runs schedule long owners first across four
// workers; CI selects one of four coverage-checked manifests and keeps one
// worker per isolated runner. testupdate is always exclusive and final.
import { execFileSync, spawn } from 'node:child_process';
import { performance } from 'node:perf_hooks';
import { serveTree } from './serve.mjs';
import { acquireCheckoutLock } from './support/gate-lock.mjs';
import {
  createGatePlan,
  executeGatePlan,
  parseGateArgs,
  validateGateManifest,
} from './support/gate-manifest.mjs';

const SUITE_TIMEOUT_MS = 480_000;
let options;
let plan;
try {
  // Validate the complete union before accepting a selected shard. A healthy
  // shard may never conceal a missing or duplicate suite elsewhere.
  validateGateManifest();
  options = parseGateArgs(process.argv.slice(2));
  plan = createGatePlan(options.ciShard);
} catch (error) {
  console.error(error instanceof Error ? error.message : error);
  process.exit(2);
}

/* The gate is launched only after package engines/.nvmrc have selected and
   validated Node 24. Every child inherits that exact executable instead of
   resolving a bare `node` through PATH. */
function runNode(args) {
  return new Promise(resolve => {
    const started = performance.now();
    const child = spawn(process.execPath, args, { cwd: process.cwd() });
    let out = '';
    let settled = false;
    let timeout;
    const finish = (code, extra = '') => {
      if (settled) return;
      settled = true;
      clearTimeout(timeout);
      resolve({ code, out: out + extra, elapsedMs: performance.now() - started });
    };
    child.stdout.on('data', data => { out += data; });
    child.stderr.on('data', data => { out += data; });
    child.on('error', error => finish(1, `\n${error.stack ?? error}\n`));
    child.on('close', code => finish(code ?? 1));
    timeout = setTimeout(() => child.kill('SIGKILL'), SUITE_TIMEOUT_MS);
  });
}

// Each suite prints one JSON block (testupdate adds a reminder line), so the
// first opening brace through the last closing brace is its report.
function parseReport(out) {
  const first = out.indexOf('{');
  const last = out.lastIndexOf('}');
  if (first < 0 || last < first) return null;
  try { return JSON.parse(out.slice(first, last + 1)); } catch { return null; }
}

const seconds = elapsedMs => `${(elapsedMs / 1000).toFixed(1)}s`;
const clean = report => (report.problems || []).length === 0
  && (report.errs || []).length === 0;
let failed = 0;
function judge(name, result, verdict) {
  const report = parseReport(result.out);
  const bad = result.code !== 0 || !report || !verdict(report);
  console.log(`${bad ? 'FAIL' : 'ok  '} ${name} (${seconds(result.elapsedMs)})`);
  if (!bad) return;
  failed++;
  console.log(result.out.trim().split('\n').map(line => `  | ${line}`).join('\n'));
}

const announce = name => console.log(`start ${name}`);
// Keep three explicit child seams so the Node-runtime contract can prove that
// typed, ordinary, and benchmark suites all propagate process.execPath.
const node = spec => async () => {
  announce(spec.name);
  judge(spec.name, await runNode([...spec.args, spec.file]), clean);
};
const suite = spec => async () => {
  announce(spec.name);
  judge(spec.name, await runNode([spec.file, ...spec.args]), clean);
};
const benchmark = spec => async () => {
  announce(spec.name);
  judge(spec.name, await runNode([spec.file, ...spec.args]),
    report => report.sameResult === true);
};
const runners = { node, suite, benchmark };
const run = spec => runners[spec.runner](spec)();

const selected = [...plan.pooled, ...plan.final];
const label = options.ciShard ?? 'complete';
const gateStarted = performance.now();
console.log(`gate ${label}: ${selected.length} suites, ${options.jobs} worker(s)`);

/* One gate at a time per working tree: build output is shared. Independent CI
   checkouts/worktrees have their own lock, outputs, server and kernel ports. */
const release = await acquireCheckoutLock();
try {
  execFileSync(process.execPath, ['build.mjs'], { stdio: 'inherit' });

  let stop = () => {};
  if (selected.some(spec => spec.needsServer)) {
    const server = await serveTree('pwa');
    process.env.KB_URL = server.url;
    stop = server.stop;
  }
  try {
    await executeGatePlan(plan, run, options.jobs);
  } finally {
    stop();
    if (plan.final.length) {
      // testupdate mutated pwa/ under its private server; restore exact output.
      execFileSync(process.execPath, ['build.mjs'], { stdio: 'ignore' });
    }
  }
} finally {
  release();
}

const summary = `${selected.length} suites ${failed ? 'FAILED' : 'green'} in `
  + `${seconds(performance.now() - gateStarted)} (${label})`;
console.log(`\n${summary}`);
process.exit(failed ? 1 : 0);
