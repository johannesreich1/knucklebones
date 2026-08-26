// Shared ranked view; the server owns turns and its die-carrying log heals missed events.
import { ME, CLASSIC, LIMITED, emptyBoard, legalCols, type Player } from '../core/rules.ts';
import { modeById } from '../core/modes.ts';
import { spellById } from '../core/spells.ts';
import { ONLINE_TURN_SECS } from '../config.ts';
import { S } from '../state.ts';
import { startTimer, stopTimer, showClock } from '../flow/timer.ts';
import { clearSpells, renderSpells, resetSpells, resolveTimedOutSpellAim,
  setSpellTransport } from '../flow/spells.ts';
import { setLeaveInterceptor } from '../flow/leave.ts';
import { $, hide } from '../ui/dom.ts';
import { showBag, renderBag, BAG_SIZE } from '../ui/bag.ts';
import { buildBoards, renderAll } from '../ui/game/board.ts';
import { clearHints, showHints } from '../ui/game/hints.ts';
import { claimBadge, releaseBadge, runeTrialChip, spellChip } from '../ui/game/hud.ts';
import { setActivePlate, setStatus } from '../ui/game/turn-state.ts';
import { fit } from '../ui/layout.ts';
import { setPlaceHandler } from '../ui/input.ts';
import { setOpponentTurnPresentation, setSeatingPresentation, setTurnPresentation, setTutorialPresentation } from '../ui/game/root-state.ts';
import {
  move,
  resign,
  watchMatch,
  type MatchRow,
  type JoinResult,
} from './match-api.ts';
import { createInitialSyncBoundary, type InitialSyncBoundary } from './initial-sync.ts';
import { newerMatchProjection } from './match-sync.ts';
import { animateOnlineMove, cancelOnlineReveal, playBotReply, revealOnlineDie } from './play-motion.ts';
import { finishOnlineMatch } from './play-finish.ts';
import { rankedBadge, reconnectingCopy, showAwayAutoPlayCountdown, turnCopy } from './play-copy.ts';
import { createOnlineState } from './play-state.ts';
import { createOnlineSynchronizer } from './play-sync.ts';
import { createTrialActionSubmitter } from './play-trial-actions.ts';
import { drainTerminalProjection } from './play-terminal.ts';
import { runOnlineWatchdog } from './play-watchdog.ts';
import { claimOnlinePlayerNames, onlineOpponentName, onlineOpponentSeat, onlinePlayerName } from './play-identity.ts';
import type { FinishReport, OnlineState } from './play-types.ts';

let O: OnlineState | null = null, initialSync: InitialSyncBoundary | null = null;
let releasePlayerNames = (): void => undefined;
function isCurrentOnline(online: OnlineState): boolean { return O === online && S.gen === online.gen; }

/* test hook, same philosophy as window.__kb: harmless introspection */
if (typeof window !== 'undefined') (window as any).__kbOnline = () => O
  && { matchId: O.matchId, you: O.you, applied: O.applied, done: O.done };

const myName = () => onlinePlayerName(O!, O!.you);
const oppName = () => onlineOpponentName(O!)();

/* one callback per match end, wired by ui.ts to open the Result screen */
export type { FinishReport } from './play-types.ts';
let onFinished: ((r: FinishReport) => void) | null = null;
export function setFinishHandler(f: typeof onFinished): void { onFinished = f; }

const sync = createOnlineSynchronizer({
  current: () => O,
  isCurrent: isCurrentOnline,
  applyMatchRow,
  renderPool,
});

const watchdog = (): Promise<void> => runOnlineWatchdog({
  current: () => O,
  isCurrent: isCurrentOnline,
  initialPending: () => initialSync?.pending() ?? false,
  retryInitial: () => initialSync?.retry() ?? Promise.resolve(false),
  sync,
  applyMatchRow,
  teardown,
});

const trialActions = createTrialActionSubmitter({
  current: () => O,
  isCurrent: isCurrentOnline,
  sync,
  applyMatchRow,
});

/* Quitting a live ranked match forfeits it — at the SERVER, immediately. The
   confirmation is the quit modal (flow/leave → boot); by the time this runs
   the player has said "Forfeit", so the resign goes out and the match is
   flipped: the opponent's client hears the row change and celebrates its win
   right away instead of waiting out the stall clock, and the next pvp-join
   finds no active match to drag this player back into. Fire-and-forget —
   session.ts remembers the outcome so matchmaking can wait for it. */
function leaveTap(): boolean {
  if (!O || O.done) return false;
  resign(O.matchId);
  teardown();
  return false;
}

export async function enterMatch(res: Extract<JoinResult, { status: 'matched' }>): Promise<void> {
  teardown();
  const restoreMode = S.mode;
  S.gen++;                       // abandon any local game mid-flight
  S.tut = null; S.mode = 'duo';  // input gating: taps allowed for whoever S.turn says
  S.busy = true;                   // input opens only after the first authoritative log read
  S.boards = [emptyBoard(), emptyBoard()];
  S.turn = res.match.turn;
  S.bottom = res.you;
  O = createOnlineState(res, S.gen, restoreMode);
  releasePlayerNames = claimOnlinePlayerNames(() => O);
  const online = O;

  if (online.trial && online.trialRunes) {
    resetSpells(online.trialRunes);
    setSpellTransport({
      aim: (id) => trialActions.aim(id),
      cast: (id, column) => trialActions.cast(id, column),
      casterAllowed: (who) => O === online && who === online.you,
    });
  } else {
    clearSpells();
    setSpellTransport(null);
  }

  const spec = modeById(res.match.modifier);
  S.scoring = spec.mode;           // rendering/destroy animations follow the server's mode
  S.bounty = [0, 0];
  // LIMITED: the bag. Its size comes from PUBLIC data only (how many moves
  // the log holds + the visible next die) — the secret seed stays secret,
  // and no face is ever revealed.
  O.limited = spec.mode === LIMITED;
  showBag(O.limited);
  showClock(true);                 // ranked always runs the server clock

  hide('#ovOnline'); hide('#ovStart'); hide('#ovEnd'); hide('#ovRules'); hide('#ovPass'); hide('#ovPractice');
  setSeatingPresentation('shared');
  setTutorialPresentation(false);
  setTurnPresentation('none'); setOpponentTurnPresentation(false);
  $('#sideBot').dataset.owner = String(O.you);
  $('#sideTop').dataset.owner = String(1 - O.you);
  $('#nameBot').textContent = myName();
  $('#nameTop').textContent = oppName();
  ($('#tagTop') as HTMLElement).hidden = true;
  ($('#tagBot') as HTMLElement).hidden = true;
  // Trial is a format chip plus one public rune per owner. Ordinary ranked
  // remains the established single mechanical-mode chip.
  if (O.trial && O.trialRunes) {
    const p2 = spellById(O.trialRunes[0]);
    const p1 = spellById(O.trialRunes[1]);
    claimBadge(() => [runeTrialChip(),
      ...(p1 ? [spellChip(p1, ME)] : []),
      ...(p2 ? [spellChip(p2, 0)] : []),
    ]);
  } else claimBadge(rankedBadge(spec));
  fit();
  buildBoards();
  setPlaceHandler(onlinePlace);
  setLeaveInterceptor(leaveTap);
  O.channel = watchMatch(O.matchId,
    () => { void sync(false); },
    (m) => { void onMatchUpdate(m); },
    () => { void sync(false); });
  O.tick = setInterval(() => { void watchdog(); }, 5000);

  initialSync = createInitialSyncBoundary({
    sync: () => sync(true), owns: () => isCurrentOnline(online), onReady: refreshTurnUI,
    onWaiting: () => {
      S.busy = true;
      setStatus(reconnectingCopy, S.turn);
    },
  });
  await initialSync.start();
}

/* the bag: every move consumed one die, and the die on the stage is drawn too */
function renderPool(): void { if (O?.limited) renderBag(BAG_SIZE - O.applied - (O.pendingDie ? 1 : 0)); }

function refreshTurnUI(): void {
  if (!O || O.done) return;
  // BELT: re-lay both boards from state at every turn boundary. Animations
  // are optimistic theater — if any path ever misses a repaint (a strike's
  // compaction, an interrupted destroy), the divergence heals here within
  // one turn instead of persisting. Idempotent and cheap (18 slots).
  renderAll(false);
  const mine = S.turn === O.you;
  S.phase = mine ? 'choose' : 'anim';
  S.busy = false;
  S.die = O.pendingDie ?? 0;
  if (O.pendingDie) revealOnlineDie(O.pendingDie, S.turn);
  renderPool();
  renderSpells();
  // a calm static status — the countdown bar below carries the motion
  setStatus(turnCopy(mine, () => oppName()), S.turn);
  setActivePlate(O.you);
  clearHints();
  if (mine) showHints();
  // The 10s turn clock, both sides. Mine auto-places at zero (an honest
  // client never stalls); theirs just downgrades the status to "waiting" —
  // the 30s watchdog/forfeit handles an opponent who is truly gone.
  startTimer(mine ? autoPlace : oppStalled, ONLINE_TURN_SECS);
}
/* their clock ran out: say so and let the watchdog decide if they are gone */
function oppStalled(): void {
  if (!O || O.done) return;
  const online = O;
  showAwayAutoPlayCountdown({
    active: () => isCurrentOnline(online) && !online.done && S.turn !== online.you,
    lastMoveAt: () => online.lastMoveAt,
    who: S.turn,
  });
}

async function autoPlace(): Promise<void> {
  if (!O || O.done || S.busy || S.turn !== O.you) return;
  // A hidden page must not drive the optimistic pipeline: flyDie awaits a
  // WAAPI finish that never comes without rendering frames, so the flow would
  // wedge mid-move. The watchdog's self-nudge owns away turns — the server
  // places the same uniform legal die this line would have picked.
  if (document.hidden) return;
  if (O.trial && await resolveTimedOutSpellAim()) return;
  if (!O || O.done || S.busy || S.turn !== O.you) return;
  const lg = legalCols(S.boards[O.you]);
  if (lg.length) void onlinePlace(O.you, lg[(Math.random() * lg.length) | 0]);
}

/* my move: animate IMMEDIATELY, in parallel with the server request — the die
   and column are both known at tap time, so the round-trip must never be felt.
   The rare server rejection falls back to a full log resync, which also
   reverts the optimistic board. */
async function onlinePlace(who: Player, col: number): Promise<void> {
  if (!O || O.done || S.busy || who !== O.you || S.turn !== O.you) return;
  if (O.trial) {
    await trialActions.place(col);
    return;
  }
  const online = O;
  const die = online.pendingDie;
  if (!die) return;
  stopTimer();
  cancelOnlineReveal();         // a running scramble must not fight the fly animation
  S.busy = true; S.phase = 'anim';
  clearHints();
  // the gate goes up BEFORE the request: the realtime echo of our own move can
  // arrive during the round-trip, and sync must not rebuild around it. Our
  // move's log slot is claimed up front too — it is our turn, so no other
  // move can take idx O.applied.
  online.animating = true;
  const expectedMoveCount = online.applied;
  online.applied += 1;
  const [r] = await Promise.all([
    move(online.matchId, col, expectedMoveCount),
    animateOnlineMove(online.you, col, die, () => isCurrentOnline(online)),
  ]);
  if (!isCurrentOnline(online)) return;
  if (r.status !== 200 || !r.data?.match) {
    online.applied -= 1;              // un-claim; sync(true) resets it absolutely anyway
    online.animating = false;
    await sync(true);            // out of step — the log is the truth
    return;
  }
  const bot = r.data.bot_move;
  if (bot) online.applied += 1;       // the bot's reply is committed server-side too
  online.lastMoveAt = Date.now();
  try {
    if (bot) await playBotReply(bot, {
      you: online.you,
      isCurrent: () => isCurrentOnline(online),
      opponentName: () => oppName(),
      onOpponentStalled: oppStalled,
    });
  } finally { if (isCurrentOnline(online)) online.animating = false; }
  if (!isCurrentOnline(online)) return;
  const row = newerMatchProjection(online.pendingRow, r.data.match);
  online.pendingRow = null;
  applyMatchRow(row);   // may re-defer into pendingRow if a sync is mid-fetch
}

function isDone(m: MatchRow): boolean { return m.status !== 'active'; }
function freezeMatchInput(): void { S.busy = true; S.phase = 'anim'; stopTimer(); clearHints(); }
async function onMatchUpdate(m: MatchRow): Promise<void> {
  if (!O || m.id !== O.matchId) return;
  const online = O;
  if (isDone(m)) {
    freezeMatchInput();
    await drainTerminalProjection(online, m, { isCurrent: isCurrentOnline, sync, applyMatchRow });
    return;
  }
  const synced = await sync(false);
  const complete = !online.trial
    || online.actionApplied >= (m.action_version ?? online.actionApplied);
  if (isCurrentOnline(online) && synced && complete) applyMatchRow(m);
  else if (isCurrentOnline(online)) online.pendingRow = newerMatchProjection(online.pendingRow, m);
}
function applyMatchRow(m: MatchRow): void {
  if (!O || O.done || m.id !== O.matchId) return;
  if (isDone(m) && O.finalizing) {
    O.pendingRow = newerMatchProjection(O.pendingRow, m);
    freezeMatchInput();
    return;
  }
  // board mutations OR a sync fetch in flight: defer — sync's tail drains it
  if (O.animating || O.busySync) {
    O.pendingRow = newerMatchProjection(O.pendingRow, m);
    if (isDone(O.pendingRow)) freezeMatchInput();
    return;
  }
  O.pendingDie = m.next_die;
  O.actionVersion = m.action_version ?? O.actionVersion;
  O.lastMoveAt = Date.parse(m.last_move_at);
  S.turn = m.turn;
  if (isDone(m)) return finishUI(m);
  refreshTurnUI();
}

function finishUI(m: MatchRow): void {
  if (!O || O.done) return;
  const finished = O;
  const opponentSeat = onlineOpponentSeat(finished);
  finishOnlineMatch({
    online: finished,
    match: m,
    opponentName: onlineOpponentName(finished),
    opponentSeat,
    isCurrent: () => isCurrentOnline(finished),
    teardown,
    onFinished,
  });
}
export function teardown(): void {
  if (!O) return;
  const ownsPresentation = S.gen === O.gen; // a stale watchdog must not clear a replacement local game
  initialSync = null; stopTimer();
  S.scoring = CLASSIC;             // local play is always classic
  O.channel?.unsubscribe();
  if (O.tick) clearInterval(O.tick);
  setSpellTransport(null);
  clearSpells();
  setPlaceHandler(null);
  setLeaveInterceptor(null);
  releaseBadge();                  // hands #rec back to the local record
  showBag(false);
  showClock(false);
  if (ownsPresentation) {
    S.mode = O.restoreMode;
    setOpponentTurnPresentation(false);
  }
  releasePlayerNames();
  releasePlayerNames = (): void => undefined;
  O = null;
}
