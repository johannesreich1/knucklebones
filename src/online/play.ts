// Online match play: drives the SAME board, dice and animations as local
// play, but the turn machine lives on the server. This module only reflects
// authoritative state — every die comes from the server, every move goes
// through pvp-move, and the die-carrying move log lets us rebuild the board
// after any missed realtime event.
import { AI, ME, SPEC, CLASSIC, COLSHIELD, emptyBoard, applyMove, boardTotalMode, legalCols, type Player } from '../core/rules.ts';
import { modeById } from '../core/modes.ts';
import { ONLINE_TURN_SECS } from '../config.ts';
import { S } from '../state.ts';
import { startTimer, stopTimer } from '../flow/timer.ts';
import { $, show, hide, sideKey, chipEl } from '../ui/dom.ts';
import { Sfx } from '../ui/audio.ts';
import { setStageDie } from '../ui/die.ts';
import { buildBoards, renderAll, renderSide, clearHints, showHints, setStatus, setActivePlate } from '../ui/render.ts';
import { fit } from '../ui/layout.ts';
import { setPlaceHandler } from '../ui/input.ts';
import { flyDie, destroyAt } from '../flow/game.ts';
import { supa, move, claim, watchMatch, type MatchRow, type JoinResult } from './session.ts';

interface OnlineState {
  matchId: string;
  you: Player;
  names: { p1: string; p2: string };
  pendingDie: number | null;   // the die the CURRENT mover must place
  applied: number;             // moves applied to the local board (log idx + 1)
  gen: number;                 // snapshot of S.gen — any local newGame tears us down
  channel: ReturnType<typeof watchMatch> | null;
  tick: ReturnType<typeof setInterval> | null;
  lastMoveAt: number;
  busySync: boolean;
  animating: boolean;          // board mutations in flight — sync must not rebuild
  pendingRow: MatchRow | null; // match update deferred until the animation ends
  done: boolean;
}
let O: OnlineState | null = null;

/* test hook, same philosophy as window.__kb: harmless introspection */
if (typeof window !== 'undefined') {
  (window as any).__kbOnline = () => O && { matchId: O.matchId, you: O.you, applied: O.applied, done: O.done };
}

const pause = (ms: number) => new Promise((r) => setTimeout(r, ms));
const myName = () => O!.you === ME ? O!.names.p1 : O!.names.p2;
const oppName = () => O!.you === ME ? O!.names.p2 : O!.names.p1;

/* one callback per match end, wired by ui.ts to reopen the online menu */
let onFinished: ((summary: string) => void) | null = null;
export function setFinishHandler(f: typeof onFinished): void { onFinished = f; }

export async function enterMatch(res: Extract<JoinResult, { status: 'matched' }>): Promise<void> {
  teardown();
  S.gen++;                       // abandon any local game mid-flight
  S.tut = null;
  S.mode = 'duo';                // input gating: taps allowed for whoever S.turn says
  S.busy = false;
  S.boards = [emptyBoard(), emptyBoard()];
  S.turn = res.match.turn;
  S.bottom = res.you;
  O = {
    matchId: res.match.id, you: res.you, names: (res as any).names ?? { p1: 'PLAYER 1', p2: 'PLAYER 2' },
    pendingDie: res.match.next_die, applied: 0, gen: S.gen,
    channel: null, tick: null, lastMoveAt: Date.parse(res.match.last_move_at), busySync: false, animating: false, pendingRow: null, done: false,
  };

  const spec = modeById(res.match.modifier);
  S.scoring = spec.mode;           // rendering/destroy animations follow the server's mode

  hide('#ovOnline'); hide('#ovStart'); hide('#ovEnd'); hide('#ovRules'); hide('#ovPass'); hide('#ovPractice');
  document.documentElement.classList.remove('face', 'tut', 'p2turn');
  $('#sideBot').dataset.owner = String(O.you);
  $('#sideTop').dataset.owner = String(1 - O.you);
  $('#nameBot').textContent = myName();
  $('#nameTop').textContent = oppName();
  ($('#tagTop') as HTMLElement).hidden = true;
  ($('#tagBot') as HTMLElement).hidden = true;
  $('#rec').textContent = spec.mode === CLASSIC ? 'ONLINE' : `ONLINE · ${spec.icon} ${spec.name}`;
  fit();
  buildBoards();
  setPlaceHandler(onlinePlace);
  O.channel = watchMatch(O.matchId,
    () => { void sync(false); },
    (m) => { void onMatchUpdate(m); });
  O.tick = setInterval(() => { void watchdog(); }, 5000);

  if (res.rejoined) await sync(true);      // mid-match reconnect: rebuild from log
  else { renderAll(false); refreshTurnUI(); }
}

function refreshTurnUI(): void {
  if (!O || O.done) return;
  const mine = S.turn === O.you;
  S.phase = mine ? 'choose' : 'anim';
  S.busy = false;
  if (O.pendingDie) setStageDie(O.pendingDie, S.turn);
  setStatus(mine ? 'Your move' : oppName() + ' thinking', S.turn, !mine);
  setActivePlate();
  clearHints();
  if (mine) showHints();
  // The 10s turn clock, both sides. Mine auto-places at zero (an honest
  // client never stalls); theirs just downgrades the status to "waiting" —
  // the 30s watchdog/forfeit handles an opponent who is truly gone.
  startTimer(mine ? autoPlace : () => { if (O && !O.done) setStatus('Waiting for ' + oppName(), S.turn, true); },
    ONLINE_TURN_SECS);
}

function autoPlace(): void {
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
  const die = O.pendingDie;
  if (!die) return;
  stopTimer();
  S.busy = true; S.phase = 'anim';
  clearHints();
  // the gate goes up BEFORE the request: the realtime echo of our own move can
  // arrive during the round-trip, and sync must not rebuild around it. Our
  // move's log slot is claimed up front too — it is our turn, so no other
  // move can take idx O.applied.
  O.animating = true;
  O.applied += 1;
  const [r] = await Promise.all([move(O.matchId, col), animateMove(O.you, col, die)]);
  if (!O) return;
  if (r.status !== 200 || !r.data?.match) {
    O.applied -= 1;              // un-claim; sync(true) resets it absolutely anyway
    O.animating = false;
    await sync(true);            // out of step — the log is the truth
    return;
  }
  const bot = r.data.bot_move;
  if (bot) O.applied += 1;       // the bot's reply is committed server-side too
  O.lastMoveAt = Date.now();
  try {
    if (bot) {
      await pause(450);          // a beat before the "opponent" answers
      setStageDie(bot.die, (1 - O.you) as Player);
      await pause(350);
      await animateMove((1 - O.you) as Player, bot.col, bot.die);
    }
  } finally { if (O) O.animating = false; }
  if (!O) return;
  const row = O.pendingRow ?? r.data.match;
  O.pendingRow = null;
  applyMatchRow(row);   // may re-defer into pendingRow if a sync is mid-fetch
}

async function animateMove(who: Player, col: number, die: number): Promise<void> {
  setStageDie(die, who);
  // defensive: never animate into an impossible slot — state stays authoritative
  if (S.boards[who][col].length < 3) await flyDie(who, col, die);
  S.boards[who][col].push(die);
  Sfx.place();
  setStageDie(0);
  renderSide(who, true);
  const foe = (1 - who) as Player;
  // COLUMN SHIELD: a full facing column is immune — flash the shield instead
  // of destroying, but only when the die would actually have hit something
  if (S.scoring === COLSHIELD && S.boards[foe][col].length >= SPEC.rows) {
    if (S.boards[foe][col].includes(die)) {
      const sh = chipEl(foe, col)?.querySelector('.sh') as HTMLElement | null;
      if (sh) { sh.classList.remove('block'); void sh.offsetWidth; sh.classList.add('block'); }
    }
    return;
  }
  await destroyAt(foe, col, die);
}

function isDone(m: MatchRow): boolean { return m.status !== 'active'; }

async function onMatchUpdate(m: MatchRow): Promise<void> {
  if (!O) return;
  await sync(false);
  applyMatchRow(m);
}

function applyMatchRow(m: MatchRow): void {
  if (!O) return;
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
  O.busySync = true;
  try {
    const { data: rows } = await supa().from('match_moves')
      .select('idx, who, col, die').eq('match_id', O.matchId).order('idx');
    if (!O || !rows || O.animating) return;
    const fresh = rows.filter((r) => r.idx >= O!.applied);
    if (!fresh.length && !fullRedraw) return;
    if (fresh.length === 1 && !fullRedraw && fresh[0].who !== O.you) {
      O.applied = fresh[0].idx + 1;
      O.animating = true;
      try { await animateMove(fresh[0].who as Player, fresh[0].col, fresh[0].die); }
      finally { if (O) O.animating = false; }
    } else if (fresh.length || fullRedraw) {
      S.boards = [emptyBoard(), emptyBoard()];
      for (const r of rows) applyMove(S.boards as any, r.who as Player, r.col, r.die, S.scoring);
      O.applied = rows.length;
      renderAll(false);
    }
    const { data: m } = await supa().from('matches')
      .select('id, p1, p2, status, turn, winner, p1_score, p2_score, p1_rating_delta, p2_rating_delta, next_die, last_move_at, modifier')
      .eq('id', O.matchId).maybeSingle();
    if (O && m && !O.pendingRow) O.pendingRow = m as MatchRow;
  } finally { if (O) O.busySync = false; }
  // drain: anything deferred during the fetch/animation applies now, once
  if (O && O.pendingRow && !O.animating && !O.busySync) {
    const m = O.pendingRow; O.pendingRow = null;
    applyMatchRow(m);
  }
}

/* stalled opponent → automatic forfeit claim; abandoned local state → teardown */
async function watchdog(): Promise<void> {
  if (!O) return;
  if (S.gen !== O.gen) return teardown();          // a local game started over us
  if (O.done) return;
  if (S.turn !== O.you && Date.now() - O.lastMoveAt > 35_000) {
    const r = await claim(O.matchId);
    if (r.status === 200 && r.data?.match) applyMatchRow(r.data.match);
  } else if (S.turn !== O.you) {
    void sync(false);                              // belt-and-braces vs missed events
  }
}

function finishUI(m: MatchRow): void {
  if (!O || O.done) return;
  O.done = true;
  stopTimer();
  void (async () => {
    if (!O) return;
    const { data: rows } = await supa().from('match_moves')
      .select('idx, who, col, die').eq('match_id', O.matchId).order('idx');
    if (!rows) return;
    S.boards = [emptyBoard(), emptyBoard()];
    for (const r of rows) applyMove(S.boards as any, r.who as Player, r.col, r.die, S.scoring);
    renderAll(false);
  })();
  const meP1 = O.you === ME;
  const my = (meP1 ? m.p1_score : m.p2_score) ?? boardTotalMode(S.boards[O.you], S.scoring);
  const their = (meP1 ? m.p2_score : m.p1_score) ?? boardTotalMode(S.boards[(1 - O.you) as Player], S.scoring);
  const delta = (meP1 ? (m as any).p1_rating_delta : (m as any).p2_rating_delta) as number | null;
  const won = m.winner !== null && ((meP1 && m.winner === m.p1) || (!meP1 && m.winner === m.p2));
  const head = m.status === 'forfeit'
    ? (won ? oppName() + ' forfeited — you win!' : 'Forfeited')
    : (m.winner === null ? 'Dead heat' : won ? 'Victory!' : oppName() + ' takes it');
  const summary = `${head} · ${my}–${their}` + (delta != null ? ` · ${delta >= 0 ? '+' : ''}${delta} Elo` : '');
  setStatus(won ? 'You win' : m.winner === null ? 'Draw' : oppName() + ' wins', won ? O.you : (1 - O.you) as Player, false);
  S.phase = 'over';
  const s = summary;
  const cb = onFinished;
  setTimeout(() => { teardown(); cb?.(s); }, 1400);
}

export function teardown(): void {
  if (!O) return;
  stopTimer();
  S.scoring = CLASSIC;             // local play is always classic
  O.channel?.unsubscribe();
  if (O.tick) clearInterval(O.tick);
  setPlaceHandler(null as any);
  O = null;
}
