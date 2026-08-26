import {
  requireProjectionRecovery,
} from '../src/online/play-recovery.ts';
import { runOnlineWatchdog } from '../src/online/play-watchdog.ts';
import type { OnlineState } from '../src/online/play-types.ts';
import { S } from '../src/state.ts';

const problems: string[] = [];
const check = (condition: boolean, message: string, detail?: unknown): void => {
  if (!condition) problems.push(`${message} :: ${JSON.stringify(detail)}`);
};

/* A successful command response may outrun the first log read. The watchdog
   must keep retrying on a visible own turn and may clear the input gate only
   after that confirmed action version is projected. */
const savedOnlineGlobals = { gen: S.gen, turn: S.turn, busy: S.busy, phase: S.phase };
const recoveryOnline = {
  matchId: 'recovery-match',
  you: 1,
  gen: 91_001,
  done: false,
  trial: true,
  lastMoveAt: 1_000,
  animating: false,
  busySync: false,
  recoverySync: false,
  recoveryActionVersion: null,
  actionApplied: 1,
  actionVersion: 2,
  applied: 0,
} as OnlineState;
S.gen = recoveryOnline.gen;
S.turn = recoveryOnline.you;
S.busy = true;
S.phase = 'anim';
let recoveryReads = 0;
const recoveryPorts = {
  current: () => recoveryOnline,
  isCurrent: (online: OnlineState) => online === recoveryOnline,
  initialPending: () => false,
  retryInitial: async () => false,
  sync: async () => { recoveryReads++; return true; },
  applyMatchRow: () => undefined,
  teardown: () => undefined,
  now: () => 20_000,
  hidden: () => false,
};
requireProjectionRecovery(recoveryOnline, 2);
requireProjectionRecovery(recoveryOnline);
requireProjectionRecovery(recoveryOnline, 1);
check(recoveryOnline.recoveryActionVersion === 2,
  'a generic/older recovery request weakened the confirmed action version');
await runOnlineWatchdog(recoveryPorts);
check(recoveryOnline.recoverySync && recoveryReads === 1,
  'a coherent but version-behind action snapshot cleared recovery', {
    recoveryReads,
    recoverySync: recoveryOnline.recoverySync,
  });
recoveryOnline.actionApplied = 2;
await runOnlineWatchdog(recoveryPorts);
check(!recoveryOnline.recoverySync && recoveryReads === 2,
  'a later watchdog tick did not recover the confirmed action version', {
    recoveryReads,
    recoverySync: recoveryOnline.recoverySync,
  });

/* A stale non-425 auto response also needs a durable read. If visibility or
   the apparent turn changes after the outage, the recovery flag still owns
   the next tick instead of falling through the ordinary stall branches. */
recoveryOnline.actionApplied = 2;
recoveryOnline.actionVersion = 2;
recoveryOnline.lastMoveAt = 1_000;
S.turn = 0;
let staleRecoveryReads = 0;
await runOnlineWatchdog({
  ...recoveryPorts,
  sync: async () => { staleRecoveryReads++; return false; },
  nudgeAction: async () => ({ status: 409, data: null }),
});
check(recoveryOnline.recoverySync && staleRecoveryReads === 1,
  'a failed sync after a stale auto response was not made durable');
S.turn = recoveryOnline.you;
await runOnlineWatchdog({
  ...recoveryPorts,
  sync: async () => { staleRecoveryReads++; return true; },
  nudgeAction: async () => ({ status: 500, data: null }),
});
check(!recoveryOnline.recoverySync && staleRecoveryReads === 2,
  'visible own-turn watchdog recovery stayed wedged after the outage healed');

/* A 425 says the authoritative stall clock is still young, despite this
   client's older server-derived timestamp. That contradiction requires a
   projection read; if the read fails, it must survive a turn/visibility
   change and must never reach the longer claim fallback. */
recoveryOnline.recoverySync = false;
recoveryOnline.recoveryActionVersion = null;
recoveryOnline.lastMoveAt = 1_000;
S.turn = 0;
let earlyRecoveryReads = 0;
let earlyNudges = 0;
let earlyClaims = 0;
const earlyPorts = {
  ...recoveryPorts,
  now: () => 40_000,
  sync: async () => {
    earlyRecoveryReads++;
    if (earlyRecoveryReads === 1) return false;
    recoveryOnline.lastMoveAt = 35_000;
    S.turn = recoveryOnline.you;
    return true;
  },
  nudgeAction: async () => {
    earlyNudges++;
    return { status: 425, data: null };
  },
  claim: async () => {
    earlyClaims++;
    return { status: 200, data: null };
  },
};
await runOnlineWatchdog(earlyPorts);
check(recoveryOnline.recoverySync && earlyRecoveryReads === 1,
  'a 425 did not make its failed stale-projection read durable', {
    earlyRecoveryReads,
    recoverySync: recoveryOnline.recoverySync,
  });
S.turn = recoveryOnline.you;
await runOnlineWatchdog(earlyPorts);
check(!recoveryOnline.recoverySync && earlyRecoveryReads === 2
    && earlyNudges === 1 && earlyClaims === 0
    && recoveryOnline.lastMoveAt === 35_000 && S.turn === recoveryOnline.you,
  'the durable 425 recovery did not install the authoritative advancement', {
    earlyClaims,
    earlyNudges,
    earlyRecoveryReads,
    lastMoveAt: recoveryOnline.lastMoveAt,
    recoverySync: recoveryOnline.recoverySync,
    turn: S.turn,
  });

/* A healthy read can still confirm the exact same stalled projection. That is
   not progress and must not permanently bypass the legacy authoritative claim
   fallback once its longer window has elapsed. */
recoveryOnline.recoverySync = false;
recoveryOnline.recoveryActionVersion = null;
recoveryOnline.actionApplied = 2;
recoveryOnline.actionVersion = 2;
recoveryOnline.applied = 0;
recoveryOnline.done = false;
recoveryOnline.lastMoveAt = 1_000;
S.turn = 0;
let unchangedReads = 0;
let fallbackClaims = 0;
await runOnlineWatchdog({
  ...recoveryPorts,
  now: () => 40_000,
  sync: async () => { unchangedReads++; return true; },
  nudgeAction: async () => ({ status: 409, data: null }),
  claim: async () => {
    fallbackClaims++;
    return { status: 425, data: null };
  },
});
check(unchangedReads === 1 && fallbackClaims === 1,
  'a successful unchanged projection bypassed the 35-second claim fallback', {
    unchangedReads,
    fallbackClaims,
  });

S.gen = savedOnlineGlobals.gen;
S.turn = savedOnlineGlobals.turn;
S.busy = savedOnlineGlobals.busy;
S.phase = savedOnlineGlobals.phase;

console.log(JSON.stringify({ problems }, null, 2));
if (problems.length) process.exitCode = 1;
