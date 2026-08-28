import { existsSync } from 'node:fs';

const typed = name => ({
  name,
  file: `tests/${name}.test.ts`,
  args: ['--experimental-strip-types'],
  runner: 'node',
});
/* A suite whose file is named after the subject it proves needs no path at all
   — `tests/<name>.mjs` IS the path, which is why the second argument may be the
   options object directly. Only a suite that lives somewhere else (a browser
   tree's `run.mjs`, a `.test.mjs`) still spells its file out. */
const file = (name, pathOrOptions, maybeOptions = {}) => {
  const named = typeof pathOrOptions === 'string';
  const path = named ? pathOrOptions : `tests/${name}.mjs`;
  const options = named ? maybeOptions : (pathOrOptions ?? {});
  return {
    name,
    file: path,
    args: options.args ?? [],
    runner: options.runner ?? 'suite',
    needsServer: options.needsServer ?? false,
    exclusiveFinal: options.exclusiveFinal ?? false,
  };
};

// Long default-gate owners lead the unsharded local queue so four workers can
// overlap them. CI uses the independently balanced assignments below and one
// worker per VM.
export const GATE_SUITES = Object.freeze([
  /* Temporarily manual-only (2026-08-26). This exhaustive geometry matrix
     takes several minutes but does not produce human-reviewed visual
     approval. Keep the focused runner available until a deliberate screenshot
     review workflow owns that acceptance step. The same runner's cheap
     `--smoke` mode stays in the gate below as `localization-smoke`, so the
     manual matrix cannot silently rot. */
  // file('localization-browser', 'tests/browser/localization/run.mjs'),
  file('online-ui-browser', 'tests/browser/online-ui/run.mjs', { needsServer: true }),
  file('online-localization-browser', 'tests/browser/online-localization/run.mjs'),
  file('rune-deal-reveal'),
  file('widget-isolation'),
  file('duo-pass-and-play'),
  file('hud-settings-browser', 'tests/browser/hud-settings/run.mjs'),
  file('responsive-browser', 'tests/browser/responsive/run.mjs'),
  file('hud-timer'),
  file('spells-presentation', 'tests/browser/spells/run.mjs', {
    args: ['--shard', 'presentation'],
  }),
  file('spells-defense', 'tests/browser/spells/run.mjs', {
    args: ['--shard', 'defense'],
  }),
  file('legal-browser', 'tests/browser/legal.mjs'),
  file('tutorial-persistence'),
  file('pwa-service-worker', { needsServer: true }),
  file('duo-face-seating'),
  file('spells-advanced', 'tests/browser/spells/run.mjs', {
    args: ['--shard', 'advanced'],
  }),
  file('result-screen'),
  file('practice-sheet-stability'),
  file('design-cards-render'),
  file('spells-interaction', 'tests/browser/spells/run.mjs', {
    args: ['--shard', 'interaction'],
  }),
  file('limited-bag-gauge'),
  typed('botbench'),
  file('random-mode-dial'),
  file('profile-back-navigation', { needsServer: true }),
  file('single-strike-visibility'),
  file('row-multiply-bracket'),
  file('first-run-offer'),
  // The rot guard for the manual-only localization matrix above: one locale,
  // one viewport, same runner and harness.
  file('localization-smoke', 'tests/browser/localization/run.mjs', {
    args: ['--smoke'],
  }),
  typed('architecture'),
  typed('preferences'),
  typed('rune-collection-cache'),
  typed('rune-collection-guard'),
  typed('local-options'),
  typed('trial-snapshot'),
  typed('i18n'),
  typed('i18n-catalog'),
  typed('i18n-length-report'),
  typed('legal'),
  typed('production-migrations'),
  typed('production-functions'),
  typed('production-test-data'),
  typed('dice'),
  typed('match'),
  typed('modes'),
  typed('ranked-outcomes'),
  typed('ranked-actions'),
  typed('spells'),
  typed('scoring-ward'),
  typed('spell-ai'),
  typed('scoring-ward-ai'),
  typed('rune-matchups'),
  typed('rune-matchup-analysis'),
  typed('rune-ward-sensitivity'),
  typed('rune-sunder-sensitivity'),
  typed('rune-bot-fairness'),
  typed('online-api'),
  typed('online-watchdog'),
  typed('play-sync'),
  typed('idempotent-command'),
  typed('gcauth'),
  typed('edge-handlers'),
  typed('edge-settlement'),
  typed('edge-operations'),
  typed('edge-auto-forfeit'),
  typed('cssgraph'),
  typed('cssreach'),
  typed('design-library'),
  typed('ladder'),
  typed('virtual-ruler'),
  typed('virtual-cache'),
  typed('scroll-settled'),
  typed('ladderbench'),
  typed('fnsync'),
  typed('iosship'),
  typed('androidship'),
  typed('apple-identity'),
  typed('apple-server'),
  typed('game-center-lifecycle'),
  typed('identity-gateway-origins'),
  typed('native-startup'),
  typed('live-safety'),
  typed('gate-lock'),
  typed('gate-manifest'),
  typed('typecheck-tests'),
  file('release-main', 'tests/release-main.test.mjs'),
  file('native-startup-browser', 'tests/browser/native-startup.mjs'),
  file('service-worker-routing', 'tests/service-worker.test.mjs'),
  file('col-score-bench', { runner: 'benchmark' }),
  // This changes pwa/index.html and pwa/sw.js. The executor never puts an
  // exclusive-final suite in the worker pool and runs it only after the pool.
  file('pwa-update', { needsServer: true, exclusiveFinal: true }),
]);

// These assignments are longest-processing-time bins from a sequential CI
// timing inventory. Each runner gets about six minutes of suite work while
// retaining JOBS=1 inside the runner to avoid browser contention flakes.
export const CI_SHARDS = Object.freeze({
  'ci-1': Object.freeze([
    // The full `localization-browser` matrix is intentionally manual-only;
    // `localization-smoke` is its in-gate rot guard. See GATE_SUITES.
    'localization-smoke', 'service-worker-routing', 'native-startup-browser',
    'rune-matchup-analysis', 'scoring-ward-ai', 'online-api', 'design-library',
    'cssreach', 'legal', 'spells', 'dice', 'release-main', 'gate-manifest',
    'random-mode-dial', 'rune-collection-cache', 'ranked-outcomes',
    'typecheck-tests', 'identity-gateway-origins', 'virtual-ruler',
    'virtual-cache', 'scroll-settled',
  ]),
  'ci-2': Object.freeze([
    'online-ui-browser', 'hud-settings-browser', 'spells-presentation',
    'pwa-service-worker',
    'spells-interaction', 'legal-browser', 'first-run-offer', 'live-safety',
    'rune-sunder-sensitivity', 'i18n', 'androidship', 'iosship', 'ladderbench',
    'edge-settlement', 'scoring-ward', 'match', 'rune-collection-guard',
    'ranked-actions', 'online-watchdog', 'idempotent-command', 'play-sync',
  ]),
  'ci-3': Object.freeze([
    'online-localization-browser', 'duo-pass-and-play', 'responsive-browser',
    'tutorial-persistence', 'spells-advanced',
    'design-cards-render', 'botbench', 'profile-back-navigation',
    'limited-bag-gauge', 'architecture', 'rune-ward-sensitivity',
    'preferences', 'i18n-catalog', 'edge-handlers', 'edge-operations',
    'edge-auto-forfeit',
    'cssgraph', 'fnsync', 'ladder', 'local-options', 'pwa-update',
  ]),
  'ci-4': Object.freeze([
    'rune-deal-reveal', 'widget-isolation', 'hud-timer', 'spells-defense',
    'duo-face-seating', 'practice-sheet-stability', 'result-screen',
    'single-strike-visibility', 'row-multiply-bracket', 'col-score-bench',
    'rune-matchups', 'gate-lock', 'gcauth',
    'apple-identity', 'i18n-length-report', 'spell-ai', 'modes',
    'production-migrations', 'native-startup', 'trial-snapshot',
    'production-functions', 'production-test-data', 'apple-server',
    'game-center-lifecycle', 'rune-bot-fairness',
  ]),
});

export const CI_SHARD_NAMES = Object.freeze(Object.keys(CI_SHARDS));
export const GATE_USAGE = 'Usage: tests/run-all.mjs [--jobs N] [--ci-shard ci-1|ci-2|ci-3|ci-4]';

function invocationSignature(suite) {
  return JSON.stringify([suite.file, ...(suite.args ?? [])]);
}

export function validateGateManifest(suites = GATE_SUITES, shards = CI_SHARDS) {
  const problems = [];
  const byName = new Map();
  const signatures = new Map();
  for (const suite of suites) {
    if (!suite?.name || !suite.file || !suite.runner) {
      problems.push(`invalid suite record ${JSON.stringify(suite)}`);
      continue;
    }
    if (!existsSync(suite.file)) problems.push(`suite "${suite.name}" references missing file "${suite.file}"`);
    if (!['node', 'suite', 'benchmark'].includes(suite.runner) || !Array.isArray(suite.args)) {
      problems.push(`suite "${suite.name}" has an invalid runner or argument list`);
    }
    if (byName.has(suite.name)) problems.push(`duplicate suite id "${suite.name}"`);
    byName.set(suite.name, suite);
    const signature = invocationSignature(suite);
    if (signatures.has(signature)) {
      problems.push(`duplicate invocation for "${signatures.get(signature)}" and "${suite.name}"`);
    }
    signatures.set(signature, suite.name);
  }

  const membership = new Map([...byName.keys()].map(name => [name, 0]));
  for (const [shard, names] of Object.entries(shards)) {
    if (!shard || !Array.isArray(names) || names.length === 0) {
      problems.push(`CI shard "${shard}" is empty or invalid`);
      continue;
    }
    for (const name of names) {
      if (!byName.has(name)) problems.push(`CI shard "${shard}" references unknown suite "${name}"`);
      else membership.set(name, (membership.get(name) ?? 0) + 1);
    }
  }
  for (const [name, count] of membership) {
    if (count !== 1) problems.push(`suite "${name}" belongs to ${count} CI shards; expected exactly one`);
  }

  const final = suites.filter(suite => suite.exclusiveFinal);
  if (final.length !== 1 || final[0]?.name !== 'pwa-update' || !final[0]?.needsServer) {
    problems.push('pwa-update must be the one server-backed exclusive-final suite');
  }
  if (problems.length) throw new Error(`Invalid gate manifest:\n- ${problems.join('\n- ')}`);
}

function positiveInteger(value, source) {
  if (!/^\d+$/.test(String(value)) || Number(value) < 1) {
    throw new Error(`${source} must be a positive integer\n${GATE_USAGE}`);
  }
  return Number(value);
}

export function parseGateArgs(argv, env = process.env) {
  let jobs;
  let ciShard;
  for (let i = 0; i < argv.length; i++) {
    const flag = argv[i];
    if (flag !== '--jobs' && flag !== '--ci-shard') {
      throw new Error(`Unknown gate option "${flag}"\n${GATE_USAGE}`);
    }
    const value = argv[++i];
    if (!value || value.startsWith('--')) throw new Error(`Missing value for ${flag}\n${GATE_USAGE}`);
    if (flag === '--jobs') {
      if (jobs !== undefined) throw new Error(`Repeated --jobs\n${GATE_USAGE}`);
      jobs = positiveInteger(value, '--jobs');
    } else {
      if (ciShard !== undefined) throw new Error(`Repeated --ci-shard\n${GATE_USAGE}`);
      if (!CI_SHARD_NAMES.includes(value)) throw new Error(`Unknown CI shard "${value}"\n${GATE_USAGE}`);
      ciShard = value;
    }
  }
  const selectedJobs = jobs ?? env.KB_JOBS ?? (env.CI ? 1 : 4);
  return {
    jobs: positiveInteger(selectedJobs, jobs === undefined ? 'KB_JOBS' : '--jobs'),
    ciShard,
  };
}

export function createGatePlan(ciShard, suites = GATE_SUITES, shards = CI_SHARDS) {
  validateGateManifest(suites, shards);
  if (ciShard && !Object.hasOwn(shards, ciShard)) {
    throw new Error(`Unknown CI shard "${ciShard}"\n${GATE_USAGE}`);
  }
  const byName = new Map(suites.map(suite => [suite.name, suite]));
  const selected = ciShard ? shards[ciShard].map(name => byName.get(name)) : [...suites];
  return {
    pooled: selected.filter(suite => !suite.exclusiveFinal),
    final: selected.filter(suite => suite.exclusiveFinal),
  };
}

/* `shouldStop` is optional so the existing direct test — a fake `run` at
   jobs = 2, asserting the exclusive-final suite runs alone and last — keeps its
   call shape. Omitted, this behaves exactly as before. Supplied, both loops
   stop claiming work as soon as the gate has its verdict; the caller is
   responsible for the suites already in flight. */
export async function executeGatePlan(plan, run, jobs, shouldStop = () => false) {
  const queue = [...plan.pooled];
  await Promise.all(Array.from({ length: Math.min(jobs, queue.length) }, async () => {
    while (queue.length && !shouldStop()) await run(queue.shift());
  }));
  for (const suite of plan.final) {
    if (shouldStop()) break;
    await run(suite);
  }
}
