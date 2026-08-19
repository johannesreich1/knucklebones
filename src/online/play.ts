// Online match play: drives the SAME board, dice and animations as local
// play, but the turn machine lives on the server. This module only reflects
// authoritative state — every die comes from the server, every move goes
// through pvp-move, and the die-carrying move log lets us rebuild the board
// after any missed realtime event.
import { AI, ME, SPEC, CLASSIC, COLSHIELD, BOUNTY, LIMITED, emptyBoard, applyMove, boardTotalMode, legalCols, type Player } from '../core/rules.ts';
import { modeById } from '../core/modes.ts';
import { modeIcon } from '../ui/modeicons.ts';
import { ONLINE_TURN_SECS } from '../config.ts';
import { S } from '../state.ts';
import { startTimer, stopTimer, showClock } from '../flow/timer.ts';
import { clearSpells } from '../flow/spells.ts';
import { setLeaveInterceptor } from '../flow/leave.ts';
import { $, show, hide, sideKey, chipEl } from '../ui/dom.ts';
import { Sfx, vibrate } from '../ui/audio.ts';
import { setStageDie } from '../ui/die.ts';
import { showBag, renderBag, BAG_SIZE } from '../ui/bag.ts';
import { floatPts } from '../ui/fx.ts';
import { colorOf } from '../ui/identity.ts';
import { buildBoards, renderAll, renderSide, clearHints, showHints, setStatus, setActivePlate, settleBoard, claimBadge, releaseBadge } from '../ui/render.ts';
import { fit } from '../ui/layout.ts';
import { setPlaceHandler } from '../ui/input.ts';
import { flyDie, destroyAt } from '../flow/game.ts';
import { supa, move, claim, nudge, watchMatch, type MatchRow, type JoinResult } from './session.ts';

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
  limited: boolean;            // LIMITED mode: the bag beside the stage is live
}
let O: OnlineState | null = null;

/* test hook, same philosophy as window.__kb: harmless introspection */
if (typeof window !== 'undefined') {
  (window as any).__kbOnline = () => O && { matchId: O.matchId, you: O.you, applied: O.applied, done: O.done };
}

const pause = (ms: number) => new Promise((r) => setTimeout(r, ms));
const myName = () => O!.you === ME ? O!.names.p1 : O!.names.p2;
const oppName = () => O!.you === ME ? O!.names.p2 : O!.names.p1;

/* one callback per match end, wired by ui.ts to open the Result screen */
export interface FinishReport {
  won: boolean; draw: boolean; forfeit: boolean;
  my: number; their: number; delta: number | null; opp: string;
}
let onFinished: ((r: FinishReport) => void) | null = null;
export function setFinishHandler(f: typeof onFinished): void { onFinished = f; }

/* Quitting a live ranked match forfeits it. The confirmation is the quit modal
   now (flow/leave → boot), so this no longer arms anything of its own — it
   tears the match down and lets the normal quit continue. */
function leaveTap(): boolean {
  if (!O || O.done) return false;
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
    matchId: res.match.id, you: res.you, names: (res as any).names ?? { p1: 'PLAYER 1', p2: 'PLAYER 2' },
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
  document.documentElement.classList.remove('face', 'tut', 'p2turn');
  $('#sideBot').dataset.owner = String(O.you);
  $('#sideTop').dataset.owner = String(1 - O.you);
  $('#nameBot').textContent = myName();
  $('#nameTop').textContent = oppName();
  ($('#tagTop') as HTMLElement).hidden = true;
  ($('#tagBot') as HTMLElement).hidden = true;
  // the badge names the mode; boot's one binding makes it open the rules
  claimBadge(spec.mode === CLASSIC ? 'ONLINE'
    : `ONLINE · ${modeIcon(spec.id, 12)} ${spec.name}`, spec.id);
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
  if (O.pendingDie) revealDie(O.pendingDie, S.turn);
  renderPool();
  // a calm static status — the countdown bar below carries the motion
  setStatus(mine ? 'Your move' : oppName() + ' thinking', S.turn, false);
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
    setStatus(left > 0 ? oppName() + ' is away — playing for them in ' + left
                       : 'Playing for ' + oppName() + '…', S.turn, false);
    if (left > 0) setTimeout(tick, 500);
  };
  tick();
}

/* the roll, with local play's full juice: scramble the face with ticks for a
   beat, then reveal with a pop. Purely cosmetic — a tap mid-scramble works,
   the authoritative die is O.pendingDie, not the pixels. Re-renders of the
   SAME die (resyncs, watchdog refreshes) don't re-roll; a newer reveal or a
   started placement (cancelReveal) supersedes a running one. */
let revealSeq = 0;
function cancelReveal(): void {
  revealSeq++;
  ($('#dieStage') as HTMLElement).classList.remove('rolling');
}
function revealDie(die: number, who: Player): void {
  const stage = $('#dieStage') as HTMLElement;
  const cur = stage.firstElementChild as HTMLElement | null;
  if (cur && +(cur.dataset.v ?? 0) === die) { setStageDie(die, who); return; }
  const gen = S.gen, my = ++revealSeq;
  stage.classList.add('rolling');
  Sfx.roll();
  const t0 = performance.now();
  const iv = setInterval(() => {
    if (S.gen !== gen || revealSeq !== my) { clearInterval(iv); stage.classList.remove('rolling'); return; }
    if (performance.now() - t0 >= 300) {
      clearInterval(iv);
      stage.classList.remove('rolling');
      setStageDie(die, who);
      stage.classList.add('pop');
      setTimeout(() => stage.classList.remove('pop'), 320);
      vibrate(8);
      return;
    }
    setStageDie(1 + ((Math.random() * 6) | 0), who);
    Sfx.tick();
  }, 60);
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
  cancelReveal();               // a running scramble must not fight the fly animation
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
    if (bot) await botReply(bot);
  } finally { if (O) O.animating = false; }
  if (!O) return;
  const row = O.pendingRow ?? r.data.match;
  O.pendingRow = null;
  applyMatchRow(row);   // may re-defer into pendingRow if a sync is mid-fetch
}

/* How long a bot "thinks". A fixed beat every single turn is what gives a bot
   away — most human turns are a quick tap, some are a real pause, and once in a
   while somebody stares at the board. Usually fast, so it never becomes a wait
   the player resents. Capped well inside the turn clock: a bot must never lose
   to its own countdown. */
function botThinkMs(): number {
  const r = Math.random();
  const t = r < 0.62 ? 260 + Math.random() * 620        // straight back
          : r < 0.92 ? 900 + Math.random() * 1500       // a considered pause
          : 2500 + Math.random() * 2800;                // a long look at the board
  return Math.min(t, ONLINE_TURN_SECS * 1000 - 1200);
}

/* The bot's move comes back inside OUR move request, already committed — so its
   turn is ours to perform. Give it a real turn: their colour on the clock, their
   die rolled in the open, and the countdown running exactly as a human's does,
   so the bar means the same thing whoever is sitting across the table. */
async function botReply(bot: { col: number; die: number }): Promise<void> {
  if (!O) return;
  const them = (1 - O.you) as Player;
  S.turn = them;                    // their turn for real — this also shuts the
  setActivePlate();                 // input gate, which reads S.turn
  setStatus(oppName() + ' thinking', them, false);
  startTimer(oppStalled, ONLINE_TURN_SECS);
  await pause(260);                 // the turn passing
  if (!O) return;
  revealDie(bot.die, them);
  await pause(340);                 // the roll lands...
  await pause(botThinkMs());        // ...and then they think about it
  if (!O) return;
  stopTimer();
  await animateMove(them, bot.col, bot.die);
}

async function animateMove(who: Player, col: number, die: number): Promise<void> {
  setStageDie(die, who);
  // defensive: never animate into an impossible slot — state stays authoritative
  if (S.boards[who][col].length < 3) await flyDie(who, col, die);
  const before = boardTotalMode(S.boards[who], S.scoring);
  S.boards[who][col].push(die);
  Sfx.place();
  setStageDie(0);
  renderSide(who, true);
  // the floating "+points" local play celebrates with — mode-aware, and gold
  // whenever a match multiplied the drop beyond its face value
  const gain = boardTotalMode(S.boards[who], S.scoring) - before;
  floatPts(who, col, '+' + gain, gain > die ? 'var(--gold)' : colorOf(who));
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
  const destroyed = await destroyAt(foe, col, die);
  if (S.scoring === BOUNTY && destroyed) {
    // the kill pays: bank the permanent +1s, celebrate them in gold
    S.bounty[who] += destroyed;
    floatPts(who, col, '+' + destroyed + ' ✦', 'var(--gold)');
    renderSide(who, true);
  }
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
      S.bounty = [0, 0];
      for (const r of rows) {
        const d = applyMove(S.boards as any, r.who as Player, r.col, r.die, S.scoring);
        if (S.scoring === BOUNTY) S.bounty[r.who as Player] += d;
      }
      O.applied = rows.length;
      renderAll(false);
      renderPool();
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
  if (S.turn !== O.you && Date.now() - O.lastMoveAt > 13_000) {
    /* Their clock ran out and their own client did not answer for it — so the
       game goes on WITHOUT them rather than stopping dead. The server proves
       the stall itself and answers 425 until it is real, so calling this on
       every tick costs nothing. Leaving no longer wins the leaver a way out;
       it just hands their turns to a die. */
    const r = await nudge(O.matchId);
    if (r.status === 200 && r.data?.match) { applyMatchRow(r.data.match); return; }
    if (r.status === 425) return;                  // not stalled yet by the server's clock
    /* The deployed function may predate auto-place (it answers 400 for a body
       with no column). Fall back to the forfeit claim so this client is never
       WORSE than the one before it, whatever the server is running. */
    if (Date.now() - O.lastMoveAt > 35_000) {
      const f = await claim(O.matchId);
      if (f.status === 200 && f.data?.match) { applyMatchRow(f.data.match); return; }
    }
    void sync(false);
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
    S.bounty = [0, 0];
    for (const r of rows) {
      const d = applyMove(S.boards as any, r.who as Player, r.col, r.die, S.scoring);
      if (S.scoring === BOUNTY) S.bounty[r.who as Player] += d;
    }
    renderAll(false);
  })();
  const btyOf = (p: Player) => S.scoring === BOUNTY ? S.bounty[p] : 0;
  const meP1 = O.you === ME;
  const my = (meP1 ? m.p1_score : m.p2_score) ?? (boardTotalMode(S.boards[O.you], S.scoring) + btyOf(O.you));
  const their = (meP1 ? m.p2_score : m.p1_score) ?? (boardTotalMode(S.boards[(1 - O.you) as Player], S.scoring) + btyOf((1 - O.you) as Player));
  const delta = (meP1 ? (m as any).p1_rating_delta : (m as any).p2_rating_delta) as number | null;
  const won = m.winner !== null && ((meP1 && m.winner === m.p1) || (!meP1 && m.winner === m.p2));
  setStatus(won ? 'You win' : m.winner === null ? 'Draw' : oppName() + ' wins', won ? O.you : (1 - O.you) as Player, false);
  settleBoard();                                   // same end beat as local play
  const report: FinishReport = {
    won, draw: m.winner === null, forfeit: m.status === 'forfeit',
    my, their, delta, opp: oppName(),
  };
  const cb = onFinished;
  setTimeout(() => { teardown(); cb?.(report); }, 1400);
}

export function teardown(): void {
  if (!O) return;
  stopTimer();
  S.scoring = CLASSIC;             // local play is always classic
  O.channel?.unsubscribe();
  if (O.tick) clearInterval(O.tick);
  setPlaceHandler(null as any);
  setLeaveInterceptor(null);
  releaseBadge();                  // hands #rec back to the local record
  showBag(false);
  showClock(false);
  O = null;
}
