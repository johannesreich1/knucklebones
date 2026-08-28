import { spawn } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { acquireGateLock } from './support/gate-lock.mjs';

const problems: string[] = [];
const errs: string[] = [];
const check = (condition: boolean, message: string) => {
  if (!condition) problems.push(message);
};

const workerAt = process.argv.indexOf('--worker');
if (workerAt >= 0) {
  const cwd = process.argv[workerAt + 1];
  try {
    const release = await acquireGateLock({
      lock: path.join(cwd, '.gate.lock'),
      timeoutMs: 5_000,
      livePollMs: 5,
      recoveryPollMs: 2,
      announce: () => {},
    });
    const critical = path.join(cwd, 'critical');
    try {
      fs.mkdirSync(critical);
      await new Promise(resolve => setTimeout(resolve, 20));
    } finally {
      fs.rmSync(critical, { recursive: true, force: true });
      release();
    }
    process.exit(0);
  } catch (error) {
    console.error(error);
    process.exit(1);
  }
}

const temp = fs.mkdtempSync(path.join(os.tmpdir(), 'kb-gate-lock-'));
const lock = path.join(temp, '.gate.lock');
const recovery = `${lock}.recovery`;
const recoveryArtifacts = () => fs.readdirSync(temp)
  .filter(name => name.startsWith('.gate.lock.recovery'));
try {
  // This is the kill window before the fixed staging marker is renamed to a
  // uniquely-owned claim. Exactly one contender may recover both orphans, and
  // every later contender must serialize behind the newly acquired live lock.
  fs.writeFileSync(lock, '2147483647 stale-owner\n');
  fs.mkdirSync(recovery);
  const workers = Array.from({ length: 12 }, () => new Promise<number>(resolve => {
    const child = spawn(process.execPath, [
      '--experimental-strip-types',
      fileURLToPath(import.meta.url),
      '--worker',
      temp,
    ], { stdio: ['ignore', 'ignore', 'pipe'] });
    let stderr = '';
    child.stderr.on('data', chunk => { stderr += chunk; });
    child.on('close', code => {
      if (code) errs.push(stderr.trim() || `gate-lock worker exited ${code}`);
      resolve(code ?? 1);
    });
  }));
  const exits = await Promise.all(workers);
  check(exits.every(code => code === 0),
    'simultaneous stale-lock waiters entered the critical section together');
  check(!fs.existsSync(lock),
    'the final gate-lock worker left the checkout locked');
  check(recoveryArtifacts().length === 0,
    'stale-lock recovery left staging or unique claim directories behind');

  // This is the other kill window: the staging marker was renamed, then its
  // owner died. A uniquely named dead claim is safely recoverable.
  fs.writeFileSync(lock, '2147483647 stale-owner\n');
  fs.mkdirSync(`${recovery}.claim-1-2147483647-orphan`);
  const releaseAfterOrphan = await acquireGateLock({
    lock,
    timeoutMs: 100,
    recoveryPollMs: 2,
    announce: () => {},
  });
  releaseAfterOrphan();
  check(!fs.existsSync(lock) && recoveryArtifacts().length === 0,
    'a dead unique recovery claimant permanently blocked the checkout');

  // Live claims are authoritative. Even when multiple claim paths exist, a
  // later waiter must fail closed rather than remove either live claimant.
  fs.writeFileSync(lock, '2147483647 stale-owner\n');
  const olderClaim = `${recovery}.claim-1-${process.pid}-older`;
  const laterClaim = `${recovery}.claim-2-${process.pid}-later`;
  fs.mkdirSync(laterClaim);
  fs.mkdirSync(olderClaim);
  let recoveryTimedOut = false;
  let unexpectedRelease: (() => void) | undefined;
  try {
    unexpectedRelease = await acquireGateLock({
      lock,
      timeoutMs: 20,
      recoveryPollMs: 2,
      announce: () => {},
    });
  } catch (error) {
    recoveryTimedOut = /recovery stayed busy/.test(String(error));
  } finally {
    unexpectedRelease?.();
  }
  check(recoveryTimedOut && fs.existsSync(olderClaim) && fs.existsSync(laterClaim),
    'a later waiter stole a stale lock while live recovery claims existed');
  fs.rmSync(olderClaim, { recursive: true });
  fs.rmSync(laterClaim, { recursive: true });
  fs.rmSync(lock);

  // A live owner must never be treated as stale, even under a very short wait.
  const release = await acquireGateLock({ lock, announce: () => {} });
  let timedOut = false;
  try {
    await acquireGateLock({
      lock,
      timeoutMs: 20,
      livePollMs: 2,
      recoveryPollMs: 2,
      announce: () => {},
    });
  } catch (error) {
    timedOut = /still held/.test(String(error));
  } finally {
    release();
  }
  check(timedOut, 'a live gate owner was stolen instead of making its peer wait');
} finally {
  fs.rmSync(temp, { recursive: true, force: true });
}

console.log(JSON.stringify({ workers: 12, problems, errs }, null, 2));
