import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { createHash, randomUUID } from 'node:crypto';

const DEFAULT_TIMEOUT_MS = 20 * 60_000;

const delay = ms => new Promise(resolve => setTimeout(resolve, ms));
const ownerPid = value => Number.parseInt(value.split(' ')[0], 10);

export function processIsAlive(pid) {
  if (!Number.isInteger(pid) || pid <= 0) return false;
  try {
    process.kill(pid, 0);
    return true;
  } catch (error) {
    return error.code === 'EPERM';
  }
}

const claimPrefix = recovery => `${path.basename(recovery)}.claim-`;
const claimsFor = recovery => {
  const dir = path.dirname(recovery);
  const prefix = claimPrefix(recovery);
  let names;
  try { names = fs.readdirSync(dir); }
  catch (error) {
    if (error.code === 'ENOENT') return [];
    throw error;
  }
  const live = [];
  for (const name of names.filter(candidate => candidate.startsWith(prefix))) {
    const claim = path.join(dir, name);
    const [orderText, pidText] = name.slice(prefix.length).split('-', 2);
    const pid = Number.parseInt(pidText, 10);
    if (!processIsAlive(pid)) {
      // A unique claim name is never reused, so a dead owner's path can be
      // removed without deleting a successor's claim.
      fs.rmSync(claim, { recursive: true, force: true });
      continue;
    }
    let order;
    try { order = BigInt(orderText); } catch { order = 0n; }
    live.push({ claim, order });
  }
  return live.sort((a, b) => a.order < b.order ? -1
    : a.order > b.order ? 1 : a.claim.localeCompare(b.claim));
};

/* `.gate.lock.recovery` is only an atomic staging path. Ownership begins when
   it is renamed to a unique claim containing a monotonic creation order, PID,
   and nonce. A process killed before rename leaves a claimable staging path;
   one killed after rename leaves a uniquely-owned claim that can be discarded
   once its PID is dead. The oldest live claim wins if unusual scheduling ever
   produces more than one, and every later claimant backs off. */
function claimRecovery(recovery) {
  if (claimsFor(recovery).length) return null;
  try { fs.mkdirSync(recovery); }
  catch (error) {
    if (error.code !== 'EEXIST') throw error;
  }
  // Close the race where another waiter claimed the staging path between our
  // first scan and mkdir attempt.
  if (claimsFor(recovery).length) return null;

  const claim = `${recovery}.claim-${process.hrtime.bigint()}-${process.pid}-${randomUUID()}`;
  try { fs.renameSync(recovery, claim); }
  catch (error) {
    if (error.code === 'ENOENT') return null;
    throw error;
  }
  const live = claimsFor(recovery);
  if (live[0]?.claim === claim) return claim;
  fs.rmSync(claim, { recursive: true, force: true });
  return null;
}

/* A stale takeover needs a second atomic boundary. Without it, two waiters can
   both read the same dead owner; one replaces the lock and the other then
   deletes that fresh lock using its stale observation. */
function recoverStaleLock(lock, recovery, expected) {
  const claim = claimRecovery(recovery);
  if (!claim) return false;

  try {
    let current;
    try {
      current = fs.readFileSync(lock, 'utf8').trim();
    } catch (error) {
      if (error.code === 'ENOENT') return false;
      throw error;
    }
    if (current !== expected || processIsAlive(ownerPid(current))) return false;

    fs.rmSync(lock);
    try {
      fs.writeFileSync(lock, `${process.pid} ${new Date().toISOString()}\n`, { flag: 'wx' });
      return true;
    } catch (error) {
      if (error.code === 'EEXIST') return false;
      throw error;
    }
  } finally {
    fs.rmSync(claim, { recursive: true, force: true });
    // A contender killed before claiming can leave only this ownerless staging
    // path. It carries no authority, so removing it cannot evict a live claim.
    fs.rmSync(recovery, { recursive: true, force: true });
  }
}

/* ONE LOCK PER REPOSITORY, not per working tree — every worktree of the same
   clone queues on the same file, and an unrelated clone (a second CI checkout)
   still gates independently. The shared `.git` directory is what "the same
   repository" means, so the lock is named after it and lives in the temp
   directory rather than in any one tree.

   Worktrees were deliberately allowed to gate in parallel on 2026-08-22, once
   kernel-assigned ports made it CORRECT. It is still correct; it is not
   affordable. Three concurrent gates on this Mac put the load average at 284
   and produced failures that were pure starvation — 30s waits for buttons that
   were in the markup, screenshots timing out after fonts had loaded, benches
   40-50% over budget — while a peer's release needed five attempts to find a
   quiet moment. Serial gates finish sooner than contended ones plus their
   retries, and they never lie. Sessions had been coordinating this by hand,
   which works exactly as long as everyone remembers. */
function repositoryLock(cwd) {
  let key;
  try {
    key = execFileSync('git', ['rev-parse', '--path-format=absolute', '--git-common-dir'],
      { cwd, encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] }).trim();
  } catch {
    key = path.resolve(cwd);        // not a checkout: fall back to this tree alone
  }
  const digest = createHash('sha1').update(key).digest('hex').slice(0, 12);
  return path.join(os.tmpdir(), `knucklebones-gate-${digest}.lock`);
}

/**
 * Serialize gates across every working tree of one repository, because the
 * machine they share is the scarce resource. `lock` names the file explicitly;
 * tests pass their own so they never queue behind a real gate.
 */
export async function acquireGateLock({
  lock = repositoryLock(process.cwd()),
  bypass = process.env.KB_NO_LOCK === '1',
  timeoutMs = DEFAULT_TIMEOUT_MS,
  livePollMs = 2_000,
  recoveryPollMs = 50,
  announce = message => console.log(message),
} = {}) {
  if (bypass) return () => {};

  const recovery = `${lock}.recovery`;
  const deadline = Date.now() + timeoutMs;
  let announced = false;

  for (;;) {
    try {
      fs.writeFileSync(lock, `${process.pid} ${new Date().toISOString()}\n`, { flag: 'wx' });
      break;
    } catch (error) {
      if (error.code !== 'EEXIST') throw error;
    }

    let held;
    try {
      held = fs.readFileSync(lock, 'utf8').trim();
    } catch (error) {
      // The owner can release between our failed create and this read.
      if (error.code === 'ENOENT') continue;
      throw error;
    }

    if (!processIsAlive(ownerPid(held))) {
      if (recoverStaleLock(lock, recovery, held)) {
        announce(`stale gate lock (${held}) — that gate is gone, taking it`);
        break;
      }
      if (Date.now() > deadline) {
        throw new Error(
          `stale gate-lock recovery stayed busy for ${timeoutMs}ms — delete ${recovery} if no gate is recovering`,
        );
      }
      await delay(recoveryPollMs);
      continue;
    }

    if (!announced) {
      announce(`another gate on this repository holds ${lock} (${held}) — waiting for it`);
      announced = true;
    }
    if (Date.now() > deadline) {
      throw new Error(`${lock} still held by ${held} after ${timeoutMs}ms — delete it if that gate is gone`);
    }
    await delay(livePollMs);
  }

  const release = () => {
    try {
      if (fs.readFileSync(lock, 'utf8').startsWith(`${process.pid} `)) {
        fs.rmSync(lock, { force: true });
      }
    } catch { /* already released or handed on after this process died */ }
  };
  const onInterrupt = () => process.exit(130);
  const onTerminate = () => process.exit(143);
  process.on('exit', release);
  process.on('SIGINT', onInterrupt);
  process.on('SIGTERM', onTerminate);

  return () => {
    release();
    process.off('exit', release);
    process.off('SIGINT', onInterrupt);
    process.off('SIGTERM', onTerminate);
  };
}
