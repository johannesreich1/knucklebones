// Focused iteration for multi-scenario browser trees: one `--only`/`--shard`
// argument grammar and one shard-coverage validator, shared so every tree
// fails at startup — before a browser launches — the way the gate manifest
// does, instead of each runner growing a private near-copy of this parser.
//
// A scenario record is `{ id, run }`; `manual: true` marks a scenario that
// runs only under an explicit `--only`, never in the no-argument diagnosis
// run or a shard. `label` names the tree in every error (e.g. 'spell
// browser') and is capitalized where it starts a sentence.

const heading = (label) => label.charAt(0).toUpperCase() + label.slice(1);

export function validateScenarioShards(label, scenarios, shards = {}) {
  const memberships = new Map(scenarios
    .filter(({ manual }) => !manual)
    .map(({ id }) => [id, 0]));
  if (new Set(scenarios.map(({ id }) => id)).size !== scenarios.length) {
    throw new Error(`${heading(label)} scenario IDs must be unique`);
  }
  for (const [shard, ids] of Object.entries(shards)) {
    for (const id of ids) {
      if (!memberships.has(id)) {
        throw new Error(`${heading(label)} shard "${shard}" references unknown scenario "${id}"`);
      }
      memberships.set(id, memberships.get(id) + 1);
    }
  }
  if (Object.keys(shards).length === 0) return;
  for (const [id, count] of memberships) {
    if (count !== 1) {
      throw new Error(`${heading(label)} scenario "${id}" belongs to ${count} shards; expected exactly one`);
    }
  }
}

export function selectScenarios(label, scenarios, argv, shards) {
  if (argv.length === 0) return scenarios.filter(({ manual }) => !manual);
  if (argv.length !== 2 || !argv[1]) {
    throw new Error(shards
      ? 'Usage: run.mjs [--only <scenario-id> | --shard <name>]'
      : 'Usage: run.mjs [--only <scenario-id>]');
  }

  const [flag, value] = argv;
  if (flag === '--only') {
    const scenario = scenarios.find(({ id }) => id === value);
    if (!scenario) throw new Error(`Unknown ${label} scenario "${value}"`);
    return [scenario];
  }
  if (flag === '--shard' && shards) {
    const ids = shards[value];
    if (!ids) throw new Error(`Unknown ${label} shard "${value}"`);
    return ids.map((id) => scenarios.find((scenario) => scenario.id === id));
  }
  throw new Error(`Unknown ${label} argument "${flag}"`);
}
