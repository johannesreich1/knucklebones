// Shared ranked view; the server owns turns and its die-carrying log heals missed events.
import { ME, CLASSIC, LIMITED, emptyBoard, type Player } from '../../core/rules.ts';
import { modeById } from '../../core/modes.ts';
import { spellById } from '../../core/spells.ts';
import { ONLINE_AUTO_FORFEIT_STREAK, ONLINE_TURN_SECS } from '../../config.ts';
import { S } from '../../state.ts';
import { startTimer, stopTimer, showClock } from '../../flow/timer.ts';
import { clearSpells, resetSpells, setSpellTransport } from '../../flow/spells.ts';
import { handTurnTo } from '../../flow/turn.ts';
import { setLeaveInterceptor } from '../../flow/leave.ts';
import { $, hide } from '../../ui/dom.ts';
import { showBag, renderBag, BAG_SIZE } from '../../ui/bag.ts';
import { buildBoards, renderAll } from '../../ui/game/board.ts';
import { clearHints, showHints } from '../../ui/game/hints.ts';
import { claimBadge, releaseBadge, runeTrialChip, spellChip } from '../../ui/game/hud.ts';
import { setStatus } from '../../ui/game/turn-state.ts';
import { fit } from '../../ui/layout.ts';
import { setPlaceHandler } from '../../ui/input.ts';
import { setOpponentTurnPresentation, setScoringPresentation, setSeatingPresentation, setTurnPresentation, setTutorialPresentation } from '../../ui/game/root-state.ts';
import type { MatchRow, JoinResult } from '../api/match-api.ts';
import { watchMatch } from '../api/match-realtime.ts';
import { createInitialSyncBoundary, type InitialSyncBoundary } from './initial-sync.ts';
import { newerMatchProjection } from './match-sync.ts';
import { openOpponentTurn, revealOnlineDie, raiseAwayWarning } from './play-motion.ts';
import { finishOnlineMatch } from './play-finish.ts';
import { rankedBadge, reconnectingCopy, turnCopy } from './play-copy.ts';
import { createOnlineState } from './play-state.ts';
import { createOnlineSynchronizer } from './play-sync.ts';
import { createRankedActionSubmitter } from './play-trial-actions.ts';
import { createTurnClockHandlers } from './play-clock.ts';
import { seatOnlineBoard, unseatOnlineBoard } from './play-seating.ts';
import { submitOnlineMove } from './play-move.ts';
import { leaveRankedMatch } from './play-leave.ts';
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
/* presentation hook, like __kbResult: seat the board exactly as the server
   would, so a test can read the painted colours from BOTH seats without
   standing up a live match. */
if (typeof window !== 'undefined') {
  (window as any).__kbSeat = (you: Player): void => seatOnlineBoard(you);
}

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
  // Action replay knows WHEN the opponent takes over; the status copy, clock
  // and this match's name live here. Bound to the match being replayed, never
  // to the module global.
  openOpponentBeat: (online, die) => openOpponentTurn((1 - online.you) as Player, die, {
    you: online.you,
    isCurrent: () => isCurrentOnline(online),
    opponentName: onlineOpponentName(online),
    onOpponentStalled: clock.opponentStalled,
  }),
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

/* Both turn clocks. Armed by refreshTurnUI, fired long after; they re-read
   the live match rather than closing over the one they were built for. */
const clock = createTurnClockHandlers({
  current: () => O,
  isCurrent: isCurrentOnline,
  watchdog: () => watchdog(),
});

const rankedActions = createRankedActionSubmitter({
  current: () => O,
  isCurrent: isCurrentOnline,
  sync,
  applyMatchRow,
});

const leaveTap = (): boolean => leaveRankedMatch({
  current: () => O,
  isCurrent: isCurrentOnline,
  freezeInput: freezeMatchInput,
  sync,
  applyMatchRow,
});

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

  if (online.actionProtocol && online.rankedRunes) {
    resetSpells(online.rankedRunes);
    setSpellTransport({
      aim: (id) => rankedActions.aim(id),
      cast: (id, column) => rankedActions.cast(id, column),
      casterAllowed: (who) => O === online && who === online.you,
    });
  } else {
    clearSpells();
    setSpellTransport(null);
  }

  const spec = modeById(res.match.modifier);
  S.scoring = spec.mode;           // rendering/destroy animations follow the server's mode
  setScoringPresentation(S.scoring); // score rails belong to the first empty-table frame
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
  seatOnlineBoard(O.you);
  $('#nameBot').textContent = myName();
  $('#nameTop').textContent = oppName();
  ($('#tagTop') as HTMLElement).hidden = true;
  ($('#tagBot') as HTMLElement).hidden = true;
  // The format/mode chip remains first. Each non-empty public rune snapshot
  // then belongs to its seat; a bare player simply has no rune chip.
  if (O.actionProtocol && O.rankedRunes) {
    const p2 = spellById(O.rankedRunes[0]);
    const p1 = spellById(O.rankedRunes[1]);
    const outcomeBadge = O.trial ? () => [runeTrialChip()] : rankedBadge(spec);
    claimBadge(() => [
      ...outcomeBadge(),
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
  handTurnTo(S.turn, O.you);   // the rail and plate follow the seat to move
  // a calm static status — the countdown bar below carries the motion
  setStatus(turnCopy(mine, () => oppName()), S.turn);
  clearHints();
  if (mine) showHints();
  // One automatic placement left before the match is lost — a warning only.
  raiseAwayWarning(O, mine && O.autoStreak >= ONLINE_AUTO_FORFEIT_STREAK - 1);
  // The 10s turn clock, both sides. Mine auto-places at zero (an honest
  // client never stalls); theirs just downgrades the status to "waiting" —
  // the 30s watchdog/forfeit handles an opponent who is truly gone.
  startTimer(mine ? clock.autoPlace : clock.opponentStalled, ONLINE_TURN_SECS);
}
/* my move: the optimistic animation and the server round-trip live in
   play-move.ts; what stays here is this view's answer to each of its ports. */
async function onlinePlace(who: Player, col: number): Promise<void> {
  if (!O || O.done || S.busy || who !== O.you || S.turn !== O.you) return;
  const online = O;
  await submitOnlineMove(online, col, {
    isCurrent: () => isCurrentOnline(online),
    sync,
    applyMatchRow,
    onOpponentStalled: clock.opponentStalled,
    actionPlace: (target) => rankedActions.place(target),
  });
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
  const complete = !online.actionProtocol
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
  O.autoStreak = (O.you === ME ? m.p1_auto_streak : m.p2_auto_streak) ?? 0;
  // This projection is a fresh turn, and refreshTurnUI gives it a fresh clock.
  O.selfAutoDue = false;
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
  unseatOnlineBoard();
  S.scoring = CLASSIC;             // local play is always classic
  setScoringPresentation(S.scoring);
  O.channel?.unsubscribe();
  if (O.tick) clearInterval(O.tick);
  setSpellTransport(null);
  clearSpells();
  setPlaceHandler(null);
  setLeaveInterceptor(null);
  releaseBadge();                  // hands #rec back to the local record
  showBag(false);
  showClock(false);
  hide('#ovAway');
  if (ownsPresentation) {
    S.mode = O.restoreMode;
    setOpponentTurnPresentation(false);
  }
  releasePlayerNames();
  releasePlayerNames = (): void => undefined;
  O = null;
}
