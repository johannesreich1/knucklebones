import { existsSync } from 'node:fs';

const typed = name => ({
  name,
  file: `tests/${name}.test.ts`,
  args: ['--experimental-strip-types'],
  runner: 'node',
});
const file = (name, path = `tests/${name}.mjs`, options = {}) => ({
  name,
  file: path,
  args: options.args ?? [],
  runner: options.runner ?? 'suite',
  needsServer: options.needsServer ?? false,
  exclusiveFinal: options.exclusiveFinal ?? false,
});

// Long owners lead the unsharded local queue. Four workers can then overlap
// them instead of discovering a six-minute localization owner near the tail.
// CI uses the independently balanced assignments below and one worker per VM.
export const GATE_SUITES = Object.freeze([
  file('localization-browser', 'tests/browser/localization/run.mjs'),
  file('test16', 'tests/browser/online-ui/run.mjs', { needsServer: true }),
  file('online-localization-browser', 'tests/browser/online-localization/run.mjs'),
  file('test20'),
  file('test6'),
  file('test4'),
  file('test11', 'tests/browser/hud-settings/run.mjs'),
  file('test8', 'tests/browser/responsive/run.mjs'),
  file('test9'),
  file('spells-presentation', 'tests/browser/spells/run.mjs', {
    args: ['--shard', 'presentation'],
  }),
  file('spells-defense', 'tests/browser/spells/run.mjs', {
    args: ['--shard', 'defense'],
  }),
  file('legal-browser', 'tests/browser/legal.mjs'),
  file('test10'),
  file('test7', undefined, { needsServer: true }),
  file('test12'),
  file('spells-advanced', 'tests/browser/spells/run.mjs', {
    args: ['--shard', 'advanced'],
  }),
  file('test15'),
  file('test17'),
  file('test23'),
  file('spells-interaction', 'tests/browser/spells/run.mjs', {
    args: ['--shard', 'interaction'],
  }),
  file('test24'),
  typed('botbench'),
  file('test18'),
  file('test22', undefined, { needsServer: true }),
  file('test13'),
  file('test21'),
  file('test19'),
  typed('architecture'),
  typed('preferences'),
  typed('i18n'),
  typed('i18n-catalog'),
  typed('i18n-length-report'),
  typed('legal'),
  typed('production-migrations'),
  typed('dice'),
  typed('match'),
  typed('modes'),
  typed('spells'),
  typed('scoring-ward'),
  typed('spell-ai'),
  typed('scoring-ward-ai'),
  typed('rune-matchups'),
  typed('rune-matchup-analysis'),
  typed('rune-ward-sensitivity'),
  typed('rune-sunder-sensitivity'),
  typed('online-api'),
  typed('gcauth'),
  typed('edge-handlers'),
  typed('edge-settlement'),
  typed('cssgraph'),
  typed('cssreach'),
  typed('design-library'),
  typed('ladder'),
  typed('ladderbench'),
  typed('fnsync'),
  typed('iosship'),
  typed('androidship'),
  typed('apple-identity'),
  typed('native-startup'),
  typed('live-safety'),
  typed('gate-lock'),
  typed('gate-manifest'),
  file('release-main', 'tests/release-main.test.mjs'),
  file('native-startup-browser', 'tests/browser/native-startup.mjs'),
  file('service-worker-routing', 'tests/service-worker.test.mjs'),
  file('bench3', 'tests/bench3.mjs', { runner: 'benchmark' }),
  // This changes pwa/index.html and pwa/sw.js. The executor never puts an
  // exclusive-final suite in the worker pool and runs it only after the pool.
  file('testupdate', undefined, { needsServer: true, exclusiveFinal: true }),
]);

// These assignments are longest-processing-time bins from a sequential CI
// timing inventory. Each runner gets about six minutes of suite work while
// retaining JOBS=1 inside the runner to avoid browser contention flakes.
export const CI_SHARDS = Object.freeze({
  'ci-1': Object.freeze([
    'localization-browser', 'service-worker-routing', 'native-startup-browser',
    'rune-matchup-analysis', 'scoring-ward-ai', 'online-api', 'design-library',
    'cssreach', 'legal', 'spells', 'dice', 'release-main', 'gate-manifest',
    'test18',
  ]),
  'ci-2': Object.freeze([
    'test16', 'test11', 'spells-presentation', 'test7',
    'spells-interaction', 'legal-browser', 'test19', 'live-safety',
    'rune-sunder-sensitivity', 'i18n', 'androidship', 'iosship', 'ladderbench',
    'edge-settlement', 'scoring-ward', 'match',
  ]),
  'ci-3': Object.freeze([
    'online-localization-browser', 'test4', 'test8', 'test10', 'spells-advanced',
    'test23', 'botbench', 'test22', 'test24', 'architecture', 'rune-ward-sensitivity',
    'preferences', 'i18n-catalog', 'edge-handlers', 'cssgraph', 'fnsync',
    'ladder', 'testupdate',
  ]),
  'ci-4': Object.freeze([
    'test20', 'test6', 'test9', 'spells-defense', 'test12', 'test17', 'test15',
    'test13', 'test21', 'bench3', 'rune-matchups', 'gate-lock', 'gcauth',
    'apple-identity', 'i18n-length-report', 'spell-ai', 'modes',
    'production-migrations', 'native-startup',
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
  if (final.length !== 1 || final[0]?.name !== 'testupdate' || !final[0]?.needsServer) {
    problems.push('testupdate must be the one server-backed exclusive-final suite');
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

export async function executeGatePlan(plan, run, jobs) {
  const queue = [...plan.pooled];
  await Promise.all(Array.from({ length: Math.min(jobs, queue.length) }, async () => {
    while (queue.length) await run(queue.shift());
  }));
  for (const suite of plan.final) await run(suite);
}
