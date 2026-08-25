#!/usr/bin/env node

import { spawnSync } from 'node:child_process';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const REQUIRED_NODE_MAJOR = 24;
const REMOTE = 'origin';
const REMOTE_MAIN = 'refs/remotes/origin/main';
const MAIN = 'refs/heads/main';
const SCRIPT_PATH = fileURLToPath(import.meta.url);
const REPOSITORY_ROOT = path.resolve(path.dirname(SCRIPT_PATH), '..');

const displayCommand = (command, args) => [command, ...args]
  .map(value => (/^[A-Za-z0-9_./:@=-]+$/.test(value) ? value : JSON.stringify(value)))
  .join(' ');

const describeExit = result => {
  if (result.error) return `could not start: ${result.error.message}`;
  if (result.signal) return `was terminated by ${result.signal}`;
  return `exited with status ${String(result.status)}`;
};

export function createCommandRunner({
  cwd = REPOSITORY_ROOT,
  env = process.env,
  spawn = spawnSync,
  announce = message => console.log(message),
} = {}) {
  const invoke = (command, args, options) => {
    announce(`$ ${displayCommand(command, args)}`);
    return spawn(command, args, {
      cwd,
      env,
      shell: false,
      ...options,
    });
  };

  return {
    capture(command, args) {
      const result = invoke(command, args, {
        encoding: 'utf8',
        stdio: ['inherit', 'pipe', 'pipe'],
      });
      if (result.status !== 0 || result.error || result.signal) {
        const detail = String(result.stderr || result.stdout || '').trim();
        throw new Error(
          `${displayCommand(command, args)} ${describeExit(result)}${detail ? `\n${detail}` : ''}`,
          result.error ? { cause: result.error } : undefined,
        );
      }
      return String(result.stdout || '').trim();
    },

    run(command, args) {
      const result = invoke(command, args, { stdio: 'inherit' });
      if (result.status !== 0 || result.error || result.signal) {
        throw new Error(
          `${displayCommand(command, args)} ${describeExit(result)}`,
          result.error ? { cause: result.error } : undefined,
        );
      }
    },

    status(command, args, acceptedStatuses = [0]) {
      const result = invoke(command, args, { stdio: 'inherit' });
      if (result.error || result.signal || !acceptedStatuses.includes(result.status)) {
        throw new Error(
          `${displayCommand(command, args)} ${describeExit(result)}`,
          result.error ? { cause: result.error } : undefined,
        );
      }
      return result.status;
    },
  };
}

export function requireNode24(version = process.versions.node) {
  const major = Number.parseInt(version.split('.')[0], 10);
  if (major !== REQUIRED_NODE_MAJOR) {
    throw new Error(
      `Node 24 is required for a release (received ${version}). `
      + 'Run this helper through mise exec --.',
    );
  }
}

const assertClean = (runner, stage) => {
  const status = runner.capture('git', [
    'status',
    '--porcelain=v1',
    '--untracked-files=all',
  ]);
  if (status) {
    throw new Error(`${stage}; release aborted because the worktree is not clean:\n${status}`);
  }
};

const assertHead = (runner, expectedHead, stage) => {
  const currentHead = runner.capture('git', ['rev-parse', '--verify', 'HEAD']);
  if (currentHead !== expectedHead) {
    throw new Error(
      `${stage}; release aborted because HEAD moved from ${expectedHead} to ${currentHead}`,
    );
  }
};

export function releaseMain({
  runner = createCommandRunner(),
  expectedRoot = REPOSITORY_ROOT,
  nodeVersion = process.versions.node,
  npm = process.platform === 'win32' ? 'npm.cmd' : 'npm',
  log = message => console.log(message),
} = {}) {
  requireNode24(nodeVersion);

  const actualRoot = path.resolve(runner.capture('git', ['rev-parse', '--show-toplevel']));
  if (actualRoot !== path.resolve(expectedRoot)) {
    throw new Error(
      `Release helper belongs to ${path.resolve(expectedRoot)}, but Git resolved ${actualRoot}`,
    );
  }

  assertClean(runner, 'Release must start from a clean worktree');
  const head = runner.capture('git', ['rev-parse', '--verify', 'HEAD']);
  log(`Preparing ${head} for ${REMOTE}/main.`);

  runner.run(npm, ['run', 'native:verify']);
  assertClean(runner, 'Native verification changed repository files');
  assertHead(runner, head, 'Native verification changed the release commit');

  runner.run(npm, ['test']);
  assertClean(runner, 'The full release gate changed repository files');
  assertHead(runner, head, 'The full release gate changed the release commit');

  runner.run('git', [
    'fetch',
    '--no-tags',
    REMOTE,
    `${MAIN}:${REMOTE_MAIN}`,
  ]);
  assertHead(runner, head, 'Fetching origin/main changed the release commit');

  const ancestry = runner.status(
    'git',
    ['merge-base', '--is-ancestor', REMOTE_MAIN, head],
    [0, 1],
  );
  if (ancestry !== 0) {
    throw new Error(
      `${REMOTE}/main is not an ancestor of ${head}; refusing a non-fast-forward push. `
      + 'Update the release commit and rerun the complete helper.',
    );
  }

  // Push the verified object, not a branch name that another process could move.
  // This is deliberately a normal push: a remote update after fetch is rejected.
  runner.run('git', ['push', REMOTE, `${head}:${MAIN}`]);
  log(`Released ${head} to ${REMOTE}/main with iOS and Android synchronized.`);

  return { head, remote: REMOTE, branch: MAIN };
}

if (process.argv[1] && path.resolve(process.argv[1]) === SCRIPT_PATH) {
  try {
    if (process.argv.length !== 2) {
      throw new Error('This release helper takes no arguments.');
    }
    releaseMain();
  } catch (error) {
    console.error(`release-main: ${error instanceof Error ? error.message : String(error)}`);
    process.exitCode = 1;
  }
}
