// Shared fail-closed CLI spawn wrapper for the guarded production rollout
// helpers. Every invocation is announced with its exact command line,
// Supabase telemetry stays disabled, and any spawn failure, signal death, or
// non-zero exit throws instead of letting a rollout continue on a partial
// result. Pure JSON file reading lives here too so both rollout scripts share
// one unreadable-input error path.

import { spawnSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const REPOSITORY_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');

function displayCommand(command, args) {
  return [command, ...args]
    .map(value => (/^[A-Za-z0-9_./:@=-]+$/.test(value) ? value : JSON.stringify(value)))
    .join(' ');
}

export function createCliRunner({
  cwd = REPOSITORY_ROOT,
  env = process.env,
  spawn = spawnSync,
  announce = message => console.log(message),
} = {}) {
  const invoke = (command, args, options) => {
    announce(`$ ${displayCommand(command, args)}`);
    const result = spawn(command, args, {
      cwd,
      env: { ...env, SUPABASE_TELEMETRY_DISABLED: '1' },
      shell: false,
      ...options,
    });
    if (result.status !== 0 || result.error || result.signal) {
      const detail = String(result.stderr || result.stdout || '').trim();
      const state = result.error
        ? `could not start: ${result.error.message}`
        : result.signal ? `was terminated by ${result.signal}` : `exited with ${result.status}`;
      throw new Error(`${displayCommand(command, args)} ${state}${detail ? `\n${detail}` : ''}`);
    }
    return result;
  };
  return Object.freeze({
    capture(command, args) {
      const result = invoke(command, args, {
        encoding: 'utf8',
        stdio: ['ignore', 'pipe', 'pipe'],
      });
      return String(result.stdout || '').trim();
    },
    run(command, args) {
      invoke(command, args, { stdio: 'inherit' });
    },
  });
}

export function readJson(file, label) {
  try {
    return JSON.parse(readFileSync(file, 'utf8'));
  } catch (error) {
    throw new Error(`${label} is unreadable: ${error instanceof Error ? error.message : String(error)}`);
  }
}
