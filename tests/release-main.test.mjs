import assert from 'node:assert/strict';
import { createCommandRunner, releaseMain, requireNode24 } from '../tools/release-main.mjs';

const HEAD = '0123456789abcdef0123456789abcdef01234567';
const commandKey = (command, args) => [command, ...args].join(' ');

function scenario({
  statuses = ['', '', ''],
  heads = [HEAD, HEAD, HEAD, HEAD],
  ancestry = 0,
} = {}) {
  const events = [];
  const worktreeStatuses = [...statuses];
  const headValues = [...heads];
  const runner = {
    capture(command, args) {
      events.push(['capture', command, ...args]);
      const key = commandKey(command, args);
      if (key === 'git rev-parse --show-toplevel') return '/repo';
      if (key === 'git status --porcelain=v1 --untracked-files=all') {
        assert.notEqual(worktreeStatuses.length, 0, 'unexpected worktree status check');
        return worktreeStatuses.shift();
      }
      if (key === 'git rev-parse --verify HEAD') {
        assert.notEqual(headValues.length, 0, 'unexpected HEAD check');
        return headValues.shift();
      }
      assert.fail(`unexpected capture: ${key}`);
    },
    run(command, args) {
      events.push(['run', command, ...args]);
    },
    status(command, args, acceptedStatuses) {
      events.push(['status', command, ...args]);
      assert.deepEqual(acceptedStatuses, [0, 1]);
      return ancestry;
    },
  };
  return { events, runner };
}

requireNode24('24.9.0');
assert.throws(
  () => requireNode24('23.11.1'),
  /Node 24 is required/,
  'release helper accepted an unsupported Node runtime',
);

{
  const { events, runner } = scenario();
  const result = releaseMain({
    runner,
    expectedRoot: '/repo',
    nodeVersion: '24.9.0',
    npm: 'npm',
    log: () => {},
  });
  assert.deepEqual(result, { head: HEAD, remote: 'origin', branch: 'refs/heads/main' });
  assert.deepEqual(events, [
    ['capture', 'git', 'rev-parse', '--show-toplevel'],
    ['capture', 'git', 'status', '--porcelain=v1', '--untracked-files=all'],
    ['capture', 'git', 'rev-parse', '--verify', 'HEAD'],
    ['run', 'npm', 'run', 'native:verify'],
    ['capture', 'git', 'status', '--porcelain=v1', '--untracked-files=all'],
    ['capture', 'git', 'rev-parse', '--verify', 'HEAD'],
    ['run', 'npm', 'test'],
    ['capture', 'git', 'status', '--porcelain=v1', '--untracked-files=all'],
    ['capture', 'git', 'rev-parse', '--verify', 'HEAD'],
    [
      'run',
      'git',
      'fetch',
      '--no-tags',
      'origin',
      'refs/heads/main:refs/remotes/origin/main',
    ],
    ['capture', 'git', 'rev-parse', '--verify', 'HEAD'],
    [
      'status',
      'git',
      'merge-base',
      '--is-ancestor',
      'refs/remotes/origin/main',
      HEAD,
    ],
    ['run', 'git', 'push', 'origin', `${HEAD}:refs/heads/main`],
  ]);
}

{
  const { events, runner } = scenario({ statuses: [' M src/main.ts'] });
  assert.throws(
    () => releaseMain({
      runner,
      expectedRoot: '/repo',
      nodeVersion: '24.1.0',
      log: () => {},
    }),
    /must start from a clean worktree[\s\S]*src\/main\.ts/,
  );
  assert.equal(events.some(event => event[0] === 'run'), false,
    'dirty checkout invoked a release command');
}

{
  const { events, runner } = scenario({ statuses: ['', ' M native/ios/App/App.xcodeproj/project.pbxproj'] });
  assert.throws(
    () => releaseMain({
      runner,
      expectedRoot: '/repo',
      nodeVersion: '24.1.0',
      npm: 'npm',
      log: () => {},
    }),
    /Native verification changed repository files/,
  );
  assert.equal(events.some(event => event.includes('test')), false,
    'native sync drift was ignored and the full gate started');
  assert.equal(events.some(event => event.includes('push')), false,
    'native sync drift was pushed');
}

{
  const { events, runner } = scenario({ ancestry: 1 });
  assert.throws(
    () => releaseMain({
      runner,
      expectedRoot: '/repo',
      nodeVersion: '24.1.0',
      npm: 'npm',
      log: () => {},
    }),
    /refusing a non-fast-forward push/,
  );
  assert.equal(events.some(event => event.includes('push')), false,
    'diverged origin/main was pushed');
}

{
  const invocations = [];
  const runner = createCommandRunner({
    cwd: '/repo',
    announce: () => {},
    spawn(command, args, options) {
      invocations.push({ command, args, options });
      return { status: 0, signal: null, stdout: 'value\n', stderr: '' };
    },
  });
  assert.equal(runner.capture('git', ['rev-parse', 'HEAD']), 'value');
  runner.run('npm', ['test']);
  runner.status('git', ['merge-base', '--is-ancestor', 'a', 'b']);
  assert.equal(invocations.every(call => call.options.shell === false), true,
    'a child command enabled shell interpretation');
  assert.equal(invocations[1].options.stdio, 'inherit');
  assert.equal(invocations[2].options.stdio, 'inherit');
}

console.log(JSON.stringify({
  out: { releaseMainSafety: true },
  problems: [],
  errs: [],
}, null, 2));
