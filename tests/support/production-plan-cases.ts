// The guarded lifecycle EVERY Edge Function rollout plan must satisfy, with
// nothing in it that knows which plan it is driving.
//
// The runner reads the slugs, the reviewed verify_jwt posture and the readback
// omissions out of the plan it is handed, so one fake drives any rollout, and
// assertPlanRolloutFlows below is the single implementation of "what a guarded
// plan promises". A plan's own contract — the database stages it accepts, the
// functions it is allowed to carry — lives with that plan's fixtures instead.
// (The older makeRunner in ./production-functions-cases.ts is this same fixture
// pinned to the Rune Trial plan; a change that owns both files can delete it
// and point its cases here.)
import assert from 'node:assert/strict';
import { existsSync, mkdirSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { uploadPayload } from '../../tools/fnfiles.mjs';
import {
  FUNCTION_CLI_VERSION,
  FUNCTION_ROLLOUT_PLANS,
  FUNCTION_VERIFY_JWT,
  assertExactDownloadedClosure,
  rolloutProductionFunctions,
  supabaseReadbackOmissionPaths,
} from '../../tools/functions/production-rollout.mjs';
import { CLI, ROOT, metadata, temp } from './production-functions-cases.ts';

type Plan = { optIn: string; selector: string; slugs: readonly string[] };
type UploadFile = { name: string; content: string };

/** The rollout's reviewed auth posture, read by slug rather than by literal. */
export const verifyJwt = FUNCTION_VERIFY_JWT as Record<string, boolean>;

export function planPayloads(plan: Plan) {
  return new Map<string, UploadFile[]>(plan.slugs.map(slug => [slug, uploadPayload(slug)]));
}

/** The verify_jwt posture supabase/config.toml actually commits to. */
export function configuredVerifyJwt(slugs: readonly string[]) {
  const config = readFileSync(path.join(ROOT, 'supabase', 'config.toml'), 'utf8');
  return Object.fromEntries(slugs.map((slug) => {
    const section = slug.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    const match = new RegExp(`\\[functions\\.${section}\\]\\s*\\nverify_jwt = (true|false)`).exec(config);
    assert.ok(match, `supabase/config.toml declares no verify_jwt for ${slug}`);
    return [slug, match[1] === 'true'];
  }));
}

/** Write a payload to disk the way a Supabase download would materialize it. */
function writeClosure(projectRoot: string, slug: string, payload: UploadFile[]) {
  const root = path.join(projectRoot, 'supabase', 'functions', slug);
  for (const file of payload) {
    const destination = path.join(root, ...file.name.split('/'));
    mkdirSync(path.dirname(destination), { recursive: true });
    writeFileSync(destination, file.content);
  }
  return root;
}

export function makePlanRunner(plan: Plan, { corruptSlug }: { corruptSlug?: string } = {}) {
  const payloads = planPayloads(plan);
  const events: string[] = [];
  const readbackRoots: string[] = [];
  let activeSlug = '';
  const runner = {
    capture(command: string, args: string[]) {
      if (command === 'git' && args.join(' ') === 'rev-parse --show-toplevel') return ROOT;
      if (command === 'git' && args.join(' ') === 'branch --show-current') return 'main';
      if (command === 'git' && args[0] === 'ls-files') return args.slice(args.indexOf('--') + 1).join('\n');
      if (command === 'git' && args[0] === 'status') return '';
      if (command === CLI && args.join(' ') === '--version') return FUNCTION_CLI_VERSION;
      if (command === CLI && args[0] === 'functions' && args[1] === 'list') {
        events.push(`list:${activeSlug}`);
        return JSON.stringify(plan.slugs.map(slug => metadata(slug, {
          verify_jwt: verifyJwt[slug],
        })));
      }
      return assert.fail(`unexpected capture: ${command} ${args.join(' ')}`);
    },
    run(command: string, args: string[]) {
      assert.equal(command, CLI);
      const slug = args[2];
      const workdir = args[args.indexOf('--workdir') + 1];
      if (args[1] === 'deploy') {
        activeSlug = slug;
        events.push(`deploy:${slug}`);
        assert.deepEqual(
          readdirSync(path.join(workdir, 'supabase', 'functions')).sort(),
          [...plan.slugs].sort(),
          'deploy project carried a function outside the selected plan',
        );
        const config = readFileSync(path.join(workdir, 'supabase', 'config.toml'), 'utf8');
        assert.deepEqual(
          [...config.matchAll(/^\[functions\.(.+)\]$/gm)].map(match => match[1]).sort(),
          [...plan.slugs].sort(),
          'the deploy project declared a function outside the selected plan',
        );
        assert.ok(
          config.includes(`[functions.${slug}]\nverify_jwt = ${verifyJwt[slug]}`),
          `deploy project did not pin the reviewed verify_jwt posture for ${slug}`,
        );
        assertExactDownloadedClosure(
          path.join(workdir, 'supabase', 'functions', slug), slug, payloads.get(slug),
        );
        return;
      }
      if (args[1] === 'download') {
        events.push(`download:${slug}`);
        readbackRoots.push(workdir);
        const payload = payloads.get(slug)!.map(file => ({ ...file }));
        if (slug === corruptSlug) {
          payload[0] = { ...payload[0], content: `${payload[0].content}\ncorrupt` };
        }
        const functionRoot = writeClosure(workdir, slug, payload);
        for (const name of supabaseReadbackOmissionPaths(slug)) {
          rmSync(path.join(functionRoot, ...name.split('/')), { force: true });
        }
        return;
      }
      return assert.fail(`unexpected run: ${command} ${args.join(' ')}`);
    },
  };
  return { events, payloads, readbackRoots, runner };
}
type ProductionRead = (query: string, parameters?: unknown[]) => Promise<unknown[]>;

/**
 * The guarded lifecycle a rollout plan must satisfy, driven entirely from the
 * plan it is given: another plan's opt-in cannot apply it, preview reports the
 * plan and the live versions without a production read, apply deploys in the
 * plan's own order and reads every closure back, and one corrupted readback
 * stops the rollout before the next function is touched.
 */
export async function assertPlanRolloutFlows(plan: Plan, options: {
  makeReadProduction: (events: string[]) => ProductionRead;
  prerequisiteEvents: string[];
  foreignOptIns: readonly string[];
  corruptSlug: string;
}) {
  const { makeReadProduction, prerequisiteEvents, foreignOptIns, corruptSlug } = options;
  const base = { selector: plan.selector, cli: CLI, nodeVersion: '24.8.0', log: () => {} };
  const discard = (value: string) => rmSync(value, { recursive: true, force: true });

  /* Every other plan's opt-in, exported at once: no combination of variables
     belonging to other rollouts may stand in for this plan's own. */
  const previous = foreignOptIns.map(name => [name, process.env[name]] as const);
  for (const name of foreignOptIns) process.env[name] = '1';
  try {
    await assert.rejects(
      () => rolloutProductionFunctions({
        ...base,
        apply: true,
        runner: makePlanRunner(plan).runner,
        createTemp: () => assert.fail(`${foreignOptIns.join('+')} materialized ${plan.selector}`),
        readProduction: async () => assert.fail(`${foreignOptIns.join('+')} reached a production read`),
      }),
      new RegExp(`${plan.optIn}=1`),
      `${plan.selector} accepted ${foreignOptIns.join('+')} instead of ${plan.optIn}`,
    );
  } finally {
    for (const [name, value] of previous) {
      if (value === undefined) delete process.env[name];
      else process.env[name] = value;
    }
  }

  const previewRoot = temp(`knucklebones-production-functions-${plan.selector}-preview-`);
  const preview = makePlanRunner(plan);
  assert.deepEqual(
    await rolloutProductionFunctions({
      ...base,
      apply: false,
      runner: preview.runner,
      createTemp: () => previewRoot,
      removeTemp: discard,
      readProduction: async () => assert.fail('preview performed a production read'),
    }),
    {
      applied: false,
      selector: plan.selector,
      slugs: plan.slugs,
      current: plan.slugs.map(slug => ({ slug, version: 7 })),
    },
  );
  assert.deepEqual(preview.events, ['list:'], 'preview did more than probe deployed versions');
  assert.equal(existsSync(previewRoot), false);

  const applyRoot = temp(`knucklebones-production-functions-${plan.selector}-apply-`);
  const applied = makePlanRunner(plan);
  const result = await rolloutProductionFunctions({
    ...base,
    apply: true,
    optIn: '1',
    runner: applied.runner,
    readProduction: makeReadProduction(applied.events),
    createTemp: () => { applied.events.push('create-temp'); return applyRoot; },
    removeTemp: discard,
  });
  assert.equal(result.applied, true);
  assert.deepEqual(result.deployed.map((row: { slug: string }) => row.slug), [...plan.slugs]);
  assert.deepEqual(applied.events, [
    ...prerequisiteEvents,
    'create-temp',
    ...plan.slugs.flatMap(slug => [`deploy:${slug}`, `list:${slug}`, `download:${slug}`]),
  ]);
  assert.equal(new Set(applied.readbackRoots).size, plan.slugs.length);
  assert.equal(existsSync(applyRoot), false);

  const corruptRoot = temp(`knucklebones-production-functions-${plan.selector}-corrupt-`);
  const corrupt = makePlanRunner(plan, { corruptSlug });
  await assert.rejects(
    () => rolloutProductionFunctions({
      ...base,
      apply: true,
      optIn: '1',
      runner: corrupt.runner,
      readProduction: makeReadProduction([]),
      createTemp: () => corruptRoot,
      removeTemp: discard,
    }),
    /downloaded bytes differ/,
  );
  assert.deepEqual(
    corrupt.events,
    plan.slugs.slice(0, plan.slugs.indexOf(corruptSlug) + 1)
      .flatMap(slug => [`deploy:${slug}`, `list:${slug}`, `download:${slug}`]),
    'a corrupted readback did not stop the rollout',
  );
  assert.equal(existsSync(corruptRoot), false);
  return result;
}

/**
 * Every plan is reachable by name from package.json and no other way. A plan
 * with no entry point invites a hand-written node invocation with a
 * hand-written selector; a script that bakes in `--apply` turns what reads like
 * a preview command into a deploy.
 */
export function assertPlanEntryPoints() {
  const scripts: Record<string, string> = JSON.parse(
    readFileSync(path.join(ROOT, 'package.json'), 'utf8'),
  ).scripts;
  const bySelector = new Map<string, string>();
  for (const [name, command] of Object.entries(scripts)) {
    if (!name.startsWith('functions:production:')) continue;
    const selector = /tools\/functions\/production-rollout\.mjs (\S+)$/.exec(command)?.[1];
    assert.ok(selector, `${name} does not invoke the rollout with an explicit selector`);
    assert.equal(command.includes('--apply'), false, `${name} bakes in --apply`);
    assert.equal(bySelector.has(selector), false, `two scripts run the ${selector} plan`);
    bySelector.set(selector, name);
  }
  assert.deepEqual(
    [...bySelector.keys()].sort(),
    Object.keys(FUNCTION_ROLLOUT_PLANS).sort(),
    'every rollout plan needs exactly one functions:production:* entry point, and no '
    + 'script may name a plan that does not exist',
  );
  return bySelector;
}

/**
 * No two plans share an environment opt-in, so an operator who exports one
 * variable can only ever deploy the one set that variable names.
 */
export function assertDistinctPlanOptIns() {
  const optIns = Object.values(FUNCTION_ROLLOUT_PLANS).map((plan: Plan) => plan.optIn);
  assert.equal(new Set(optIns).size, optIns.length, 'two rollout plans share one opt-in');
  return optIns;
}

/** The single plan that carries `slug`, by selector — there must be exactly one. */
export function plansCarrying(slug: string) {
  return Object.values(FUNCTION_ROLLOUT_PLANS)
    .filter((plan: Plan) => plan.slugs.includes(slug))
    .map((plan: Plan) => plan.selector);
}
