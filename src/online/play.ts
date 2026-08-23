// Online play drives the shared board and animation, while the server owns the
// turn machine: every die and move comes from it, and the die-carrying log lets
// this client rebuild after any missed Realtime event.
import { ME, CLASSIC, BOUNTY, LIMITED, emptyBoard, applyMove, legalCols, type Player } from '../core/rules.ts';
import { modeById } from '../core/modes.ts';
import { ONLINE_TURN_SECS } from '../config.ts';
import { S } from '../state.ts';
import { startTimer, stopTimer, showClock } from '../flow/timer.ts';
import { clearSpells } from '../flow/spells.ts';
import { setLeaveInterceptor } from '../flow/leave.ts';
import { $, show, hide } from '../ui/dom.ts';
import { showBag, renderBag, BAG_SIZE } from '../ui/bag.ts';
import { buildBoards, renderAll } from '../ui/game/board.ts';
import { clearHints, showHints } from '../ui/game/hints.ts';
import { claimBadge, releaseBadge, modeChip } from '../ui/game/hud.ts';
import { setActivePlate, setStatus } from '../ui/game/turn-state.ts';
import { fit } from '../ui/layout.ts';
import { setPlaceHandler } from '../ui/input.ts';
import { setSeatingPresentation, setTurnPresentation, setTutorialPresentation } from '../ui/game/root-state.ts';
import { supa } from './client.ts';
import { move, claim, resign, nudge, watchMatch, type MatchRow, type JoinResult } from './match-api.ts';
import { animateOnlineMove, cancelOnlineReveal, playBotReply, revealOnlineDie } from './play-motion.ts';
import { finishOnlineMatch } from './play-finish.ts';
import type { FinishReport, OnlineState } from './play-types.ts';

let O: OnlineState | null = null;

function isCurrentOnline(online: OnlineState): boolean {
  return O === online && S.gen === online.gen;
}

/* test hook, same philosophy as window.__kb: harmless introspection */
if (typeof window !== 'undefined') {
  (window as any).__kbOnline = () => O && { matchId: O.matchId, you: O.you, applied: O.applied, done: O.done };
}

const oppSeat = () => O!.you === ME ? 'p2' as const : 'p1' as const;
const myName = () => O!.you === ME ? O!.names.p1 : O!.names.p2;
const oppName = () => O!.names[oppSeat()];

/* one callback per match end, wired by ui.ts to open the Result screen */
export type { FinishReport } from './play-types.ts';
let onFinished: ((r: FinishReport) => void) | null = null;
export function setFinishHandler(f: typeof onFinished): void { onFinished = f; }

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
  S.gen++;                       // abandon any local game mid-flight
  S.tut = null;
  S.mode = 'duo';                // input gating: taps allowed for whoever S.turn says
  S.busy = false;
  clearSpells();                 // ranked replays a plain move log — no casting here
  S.boards = [emptyBoard(), emptyBoard()];
  S.turn = res.match.turn;
  S.bottom = res.you;
  O = {
    matchId: res.match.id, you: res.you, names: res.names ?? { p1: 'PLAYER 1', p2: 'PLAYER 2' },
    pendingDie: res.match.next_die, applied: 0, gen: S.gen,
    channel: null, tick: null, lastMoveAt: Date.parse(res.match.last_move_at), busySync: false, animating: false, pendingRow: null, done: false,
    limited: false,
  };

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
  setTurnPresentation('none');
  $('#sideBot').dataset.owner = String(O.you);
  $('#sideTop').dataset.owner = String(1 - O.you);
  $('#nameBot').textContent = myName();
  $('#nameTop').textContent = oppName();
  ($('#tagTop') as HTMLElement).hidden = true;
  ($('#tagBot') as HTMLElement).hidden = true;
  // the badge names where you are and what is being played; boot's one binding
  // makes the mode chip open its rules, offline and online alike. The mode is
  // named in classic too — "ONLINE" says nothing about how this game scores.
  claimBadge([{ html: 'ONLINE' }, modeChip(spec)]);
  fit();
  buildBoards();
  setPlaceHandler(onlinePlace);
  setLeaveInterceptor(leaveTap);
  O.channel = watchMatch(O.matchId,
    () => { void sync(false); },
    (m) => { void onMatchUpdate(m); });
  O.tick = setInterval(() => { void watchdog(); }, 5000);

  if (res.rejoined) await sync(true);      // mid-match reconnect: rebuild from log
  else { renderAll(false); refreshTurnUI(); }
}

/* the bag: every move consumed one die, and the die on the stage is drawn too */
function renderPool(): void {
  if (!O?.limited) return;
  renderBag(BAG_SIZE - O.applied - (O.pendingDie ? 1 : 0));
}

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
  if (O.pendingDie) revealOnlineDie(O.pendingDie, S.turn);
  renderPool();
  // a calm static status — the countdown bar below carries the motion
  setStatus(mine ? 'Your move' : oppName() + ' thinking', S.turn);
  setActivePlate();
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
  /* An open-ended "waiting" is indistinguishable from a hang. Say what is about
     to happen and count it down, so the pause has a shape. */
  const tick = (): void => {
    if (!O || O.done || S.turn === O.you) return;
    const left = Math.max(0, Math.ceil((13_000 - (Date.now() - O.lastMoveAt)) / 1000));
    setStatus(left > 0 ? 'Away — auto play in ' + left
                       : 'Auto play…', S.turn);
    if (left > 0) setTimeout(tick, 500);
  };
  tick();
}

function autoPlace(): void {
  if (!O || O.done || S.busy || S.turn !== O.you) return;
  // A hidden page must not drive the optimistic pipeline: flyDie awaits a
  // WAAPI finish that never comes without rendering frames, so the flow would
  // wedge mid-move. The watchdog's self-nudge owns away turns — the server
  // places the same uniform legal die this line would have picked.
  if (document.hidden) return;
  const lg = legalCols(S.boards[O.you]);
  if (lg.length) void onlinePlace(O.you, lg[(Math.random() * lg.length) | 0]);
}

/* my move: animate IMMEDIATELY, in parallel with the server request — the die
   and column are both known at tap time, so the round-trip must never be felt.
   The rare server rejection falls back to a full log resync, which also
   reverts the optimistic board. */
async function onlinePlace(who: Player, col: number): Promise<void> {
  if (!O || O.done || S.busy || who !== O.you || S.turn !== O.you) return;
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
  online.applied += 1;
  const [r] = await Promise.all([
    move(online.matchId, col),
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
      opponentName: oppName(),
      onOpponentStalled: oppStalled,
    });
  } finally { if (isCurrentOnline(online)) online.animating = false; }
  if (!isCurrentOnline(online)) return;
  const row = online.pendingRow ?? r.data.match;
  online.pendingRow = null;
  applyMatchRow(row);   // may re-defer into pendingRow if a sync is mid-fetch
}

function isDone(m: MatchRow): boolean { return m.status !== 'active'; }

async function onMatchUpdate(m: MatchRow): Promise<void> {
  if (!O || m.id !== O.matchId) return;
  const online = O;
  await sync(false);
  if (isCurrentOnline(online)) applyMatchRow(m);
}

function applyMatchRow(m: MatchRow): void {
  if (!O || m.id !== O.matchId) return;
  // board mutations OR a sync fetch in flight: defer — sync's tail drains it
  if (O.animating || O.busySync) { O.pendingRow = m; return; }
  O.pendingDie = m.next_die;
  O.lastMoveAt = Date.parse(m.last_move_at);
  S.turn = m.turn;
  if (isDone(m)) return finishUI(m);
  refreshTurnUI();
}

/* the die-carrying log is the client's source of truth; apply whatever the
   local board hasn't seen yet (animating only a single fresh opponent move) */
async function sync(fullRedraw: boolean): Promise<void> {
  if (!O || O.busySync || O.animating) return;
  const online = O;
  online.busySync = true;
  try {
    const { data: rows } = await supa().from('match_moves')
      .select('idx, who, col, die').eq('match_id', online.matchId).order('idx');
    if (!isCurrentOnline(online) || !rows || online.animating) return;
    const fresh = rows.filter((r) => r.idx >= online.applied);
    if (!fresh.length && !fullRedraw) return;
    if (fresh.length === 1 && !fullRedraw && fresh[0].who !== online.you) {
      online.applied = fresh[0].idx + 1;
      online.animating = true;
      try {
        await animateOnlineMove(fresh[0].who as Player, fresh[0].col, fresh[0].die,
          () => isCurrentOnline(online));
      }
      finally { online.animating = false; }
      if (!isCurrentOnline(online)) return;
    } else if (fresh.length || fullRedraw) {
      S.boards = [emptyBoard(), emptyBoard()];
      S.bounty = [0, 0];
      for (const r of rows) {
        const d = applyMove(S.boards, r.who as Player, r.col, r.die, S.scoring);
        if (S.scoring === BOUNTY) S.bounty[r.who as Player] += d;
      }
      online.applied = rows.length;
      renderAll(false);
      renderPool();
    }
    const { data: m } = await supa().from('matches')
      .select('id, p1, p2, status, turn, winner, p1_score, p2_score, p1_rating_delta, p2_rating_delta, next_die, last_move_at, modifier')
      .eq('id', online.matchId).maybeSingle();
    if (isCurrentOnline(online) && m && !online.pendingRow) online.pendingRow = m as MatchRow;
  } finally { online.busySync = false; }
  // drain: anything deferred during the fetch/animation applies now, once
  if (isCurrentOnline(online) && online.pendingRow && !online.animating && !online.busySync) {
    const m = online.pendingRow; online.pendingRow = null;
    applyMatchRow(m);
  }
}

/* stalled opponent → automatic forfeit claim; abandoned local state → teardown */
async function watchdog(): Promise<void> {
  if (!O) return;
  const online = O;
  if (S.gen !== online.gen) return teardown();          // a local game started over us
  if (online.done) return;
  if (S.turn !== online.you && Date.now() - online.lastMoveAt > 13_000) {
    /* Their clock ran out and their own client did not answer for it — so the
       game goes on WITHOUT them rather than stopping dead. The server proves
       the stall itself and answers 425 until it is real, so calling this on
       every tick costs nothing. Leaving no longer wins the leaver a way out;
       it just hands their turns to a die. */
    const r = await nudge(online.matchId);
    if (!isCurrentOnline(online)) return;
    if (r.status === 200 && r.data?.match) { applyMatchRow(r.data.match); return; }
    if (r.status === 425) return;                  // not stalled yet by the server's clock
    /* The deployed function may predate auto-place (it answers 400 for a body
       with no column). Fall back to the forfeit claim so this client is never
       WORSE than the one before it, whatever the server is running. */
    if (Date.now() - online.lastMoveAt > 35_000) {
      const f = await claim(online.matchId);
      if (!isCurrentOnline(online)) return;
      if (f.status === 200 && f.data?.match) { applyMatchRow(f.data.match); return; }
    }
    void sync(false);
  } else if (S.turn !== online.you) {
    void sync(false);                              // belt-and-braces vs missed events
  } else if (document.hidden && Date.now() - online.lastMoveAt > 13_000) {
    /* MY turn, and this page is hidden — the turn clock that keeps an honest
       client's promise is throttled or frozen back there, and vs a bot no
       other client exists to hand my turn to a die (in PvP the opponent asks;
       a bot cannot). So the away client asks for ITSELF. The server still
       proves the stall on its own clock (425 until real) and places the same
       uniform legal die the local clock would have — a visible turn is never
       touched, present players place their own dice. A pvp-move from before
       self-nudge answers 409 — harmless, the client just keeps the old
       behaviour — so this never has to race a deploy. */
    const r = await nudge(online.matchId);
    if (!isCurrentOnline(online)) return;
    if (r.status === 200 && r.data?.match) applyMatchRow(r.data.match);
    void sync(false);       // pull the moves realtime may have dropped while hidden
  }
}

function finishUI(m: MatchRow): void {
  if (!O || O.done) return;
  const finished = O;
  finishOnlineMatch({
    online: finished,
    match: m,
    opponentName: oppName(),
    opponentSeat: oppSeat(),
    isCurrent: () => isCurrentOnline(finished),
    teardown,
    onFinished,
  });
}

export function teardown(): void {
  if (!O) return;
  stopTimer();
  S.scoring = CLASSIC;             // local play is always classic
  O.channel?.unsubscribe();
  if (O.tick) clearInterval(O.tick);
  setPlaceHandler(null);
  setLeaveInterceptor(null);
  releaseBadge();                  // hands #rec back to the local record
  showBag(false);
  showClock(false);
  O = null;
}
