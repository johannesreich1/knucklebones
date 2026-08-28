// The local turn state machine and game lifecycle. Physical roll/move work is
// shared with ranked play under ui/game; CPU policy has its own typed seam.
import {
  AI,
  ME,
  isOver,
  legalCols,
  totalOf,
  type Player,
} from '../core/rules.ts';
import { outOfTimeCopy, t } from '../i18n/index.ts';
import { isNewcomer, offerTutorial } from '../ui/firstrun.ts';
import { S } from '../state.ts';
import { saveStats } from '../persist.ts';
import { Sfx, vibrate } from '../ui/audio.ts';
import { show } from '../ui/dom.ts';
import { renderBag } from '../ui/bag.ts';
import { nameOf } from '../ui/identity.ts';
import { closeEnd } from '../ui/endscreen.ts';
import { renderAll } from '../ui/game/board.ts';
import { clearHints, showHints } from '../ui/game/hints.ts';
import { updateRecord } from '../ui/game/hud.ts';
import { animateGameMove } from '../ui/game/move-view.ts';
import { animateStageRoll } from '../ui/game/motion.ts';
import { setActivePlate, setStatus, settleBoard } from '../ui/game/turn-state.ts';
import { startTimer, stopTimer } from './timer.ts';
import { coachShow, coachHide, clearTut, tutNextRoll, tutOnChoose } from './tutorial.ts';
import { toMenu } from './menu.ts';
import {
  aiSpellPlacementTurn,
  disarm,
  renderSpells,
  resolveTimedOutSpellAim,
} from './spells.ts';
import { aiChoose } from './game-ai.ts';
import { showLocalResult } from './local-result.ts';
import { handOff } from './pass-card.ts';
import { resolveLocalStart } from './local-start.ts';
import { dealNewGame, type NewGameOptions } from './new-game.ts';

export { aiChoose } from './game-ai.ts';
/* arm the turn clock: on expiry the die drops into a random legal column */
export function armTimer(): void { const gen = S.gen; startTimer(() => autoPlace(gen)); }
const wait = (ms: number): Promise<void> => new Promise((resolve) => setTimeout(resolve, ms));
function localTotal(player: Player): number {
  return totalOf(S.boards[player], S.bounty[player], S.scoring, S.charm.wards[player]);
}

async function autoPlace(gen: number): Promise<void> {
  if(S.gen!==gen || S.phase!=='choose' || S.busy) return;
  if(await resolveTimedOutSpellAim()) return;
  if(S.gen!==gen || S.phase!=='choose' || S.busy) return;
  const who=S.turn;
  const legal=legalCols(S.boards[who]);
  if(!legal.length) return;
  const c=legal[(Math.random()*legal.length)|0];
  setStatus(outOfTimeCopy(c + 1), who);
  vibrate([30,40,30]);
  void place(who, c);
}
async function rollDice(): Promise<void> {
  const gen = S.gen;
  const who = S.turn;
  S.phase = 'roll';
  setActivePlate();
  setStatus(() => who === ME ? t('game', 'status.yourRoll') : t('game', 'status.aiRoll'), who);
  await animateStageRoll({
    who,
    durationMs: 430,
    leadingTick: true,
    isCurrent: () => S.gen === gen,
    resolveDie: () => {
      S.die = (S.tut ? tutNextRoll() : 0)
        || (S.pool ? S.pool.shift() : 0)
        || 1 + ((Math.random() * 6) | 0);
      if (S.pool) renderBag(S.pool.length);
      return S.die;
    },
  });
}
/* What the status line says while a player is choosing a column. Two callers:
   the turn machine, and a spell handing the turn back after a cast. The rune
   rail wakes up here too — a choice starting is exactly when it becomes live,
   and in two-player it changes hands with the turn. */
export function sayChoose(): void {
  const who = S.turn;
  const duo = S.mode === 'duo';
  setStatus(duo
    ? { visible: () => t('game', 'status.playerChooseCompact', { player: nameOf(who) }),
      accessible: () => t('game', 'status.playerChoose', { player: nameOf(who) }) }
    : () => t('game', 'status.chooseColumn'), who);
  renderSpells();
}
const gameOver = (): boolean => S.phase === 'over';
export async function nextTurn(): Promise<void> {
  const gen=S.gen;
  if(S.phase==='over') return;
  renderAll(false);   // same repaint belt online uses: state wins every turn
  renderSpells();     // ...and the rail belongs to the turn: the seat that just
                      // lost it dims here. Deliberately the rail ONLY — the
                      // plate is rollDice()'s beat, and painting it here made
                      // the CPU's active card wear the standby treatment.
                      // sayChoose() repaints the rail again when a HUMAN gets
                      // the choice; on the machine's turn nothing else would,
                      // and the rune stayed lit through it.
  if(S.mode==='duo' && S.seat==='pass' && S.turn!==S.bottom){
    const ok=await handOff(S.turn);           // face mode switches turns directly
    if(!ok || S.gen!==gen || gameOver()) return;
  }
  await rollDice();
  if(gameOver() || S.gen!==gen) return;
  if(S.mode==='duo' || S.turn===ME){
    S.phase='choose';
    if(S.tut) tutOnChoose();     // sets the lesson message and any column restriction
    sayChoose();
    showHints();
    armTimer();
  }else{
    S.phase='anim';
    setStatus(() => t('game', 'status.aiThinking'), AI);
    await wait(300);
    if(S.gen!==gen) return;
    // It holds the same rune you do. A spell may ask the registry-owned CPU
    // policy to preview its follow-up placement before spending the charge.
    const spellTurn=await aiSpellPlacementTurn(AI, aiChoose);
    if(spellTurn.gameOver) return;
    if(S.gen!==gen) return;
    const c=spellTurn.placement ?? aiChoose();
    await wait(140);
    if(S.gen!==gen) return;
    await place(AI,c);
  }
}

export async function place(who: Player, col: number): Promise<void> {
  if (S.phase === 'over') return;
  /* Board input cannot reach placement while aiming, but timer/test/host
     seams can. A committed ANVIL must be resolved, never silently forfeited;
     an ordinary unanswered aim may close before the move commits. */
  if (S.spellAimCommitted) return;
  if (S.spellArmed) disarm(true);
  const gen = S.gen;
  S.busy = true;
  S.phase = 'anim';
  stopTimer();
  clearHints();
  renderSpells();
  const die = S.die;
  const result = await animateGameMove(who, col, die, {
    isCurrent: () => S.gen === gen,
    placeVibration: true,
    celebrateMultiplier: true,
    afterPlacementMs: 120,
    afterMoveMs: 60,
    charm: S.charm,
    onPlaced: () => {
      if (!S.tut || who !== ME) return;
      if (S.tut.firstCol === null) S.tut.firstCol = col;
      coachHide();
    },
  });
  if (result.interrupted || !result.placed) return;
  // LIMITED: the just-placed die may have been the bag's last — that ends it
  if (isOver(S.boards[who], S.pool ? S.pool.length : null)) { endGame(); return; }
  /* Local play does NOT route this through flow/turn's handTurnTo. It never had
     the bug that seam exists for: nextTurn() below already repaints the rail at
     every boundary, and the plate is painted a beat later by rollDice(). Adding
     the seam here paints both a step early and a second time, and the doubled
     paint restarts the .25s swap — measured, it caught the standby card at ~0%
     of its tween. The seam is for drivers that move the seat WITHOUT painting
     it, which is exactly what the ranked Trial replay was doing. */
  S.turn = (1 - who) as Player; S.spellCastThisTurn = null; // placement closes the cast window
  S.busy = false;
  S.die = 0;
  void nextTurn();
}
/* ===================== GAME LIFECYCLE ===================== */
/* Every local setup promise is resolved before newGame receives the concrete
   scoring rules and rune deal. Play, keyboard activation, and Next duel all
   enter through this same door. */
export async function startLocal(): Promise<void> {
  /* A newcomer is offered the tutorial before their first real game — once,
     ever, and never in front of the tutorial itself. */
  if(isNewcomer() && await offerTutorial()){ newGame({tutorial:true}); return; }
  const resolved = await resolveLocalStart();
  if (resolved) newGame(resolved);
}

/* The deal itself belongs to new-game.ts; what is left here is the opener. It
   runs on the generation that deal claimed, so a setup started in the meantime
   silently wins instead of two games racing for the first turn. */
export function newGame(opts: NewGameOptions = {}): void {
  const { tutorial, gen } = dealNewGame(opts);
  if(tutorial){
    coachShow(() => t('learn', 'tutorial.welcome'), true)
      .then(() => { if (S.gen === gen) void nextTurn(); });
  }else{
    setTimeout(() => { if (S.gen === gen) void nextTurn(); }, 650);
  }
}
/* Exported because a spell can end the game too: a swap can fill either grid,
   and "either grid full ends it" is the rule, not "the mover's grid". */
export function endGame(): void {
  stopTimer();
  const tut=!!S.tut;
  if(tut){ S.tutDone=true; clearTut(); }     // graduate
  settleBoard();
  renderSpells();                            // nothing is castable after the last die
  const me=localTotal(ME), ai=localTotal(AI);
  const duo = S.mode==='duo';
  const drawn = me===ai, p1won = me>ai;      // cyan won; in CPU mode that means you
  if(drawn && !tut) duo ? S.ties++ : S.draws++;
  if(!drawn && !tut){ if(duo) p1won ? S.p1++ : S.p2++; else p1won ? S.wins++ : S.losses++; }
  if(!tut) S.played=true;          // the hub stops nagging after this
  // in two-player somebody always won, so it is always a celebration
  if(drawn){ /* no fanfare for a dead heat */ }
  else if(duo || p1won){ Sfx.win(); }
  else { Sfx.lose(); vibrate(220); }
  updateRecord();
  /* Still recorded, deliberately unshown: the Best/Record line above the Play
     button was removed 2026-08-22, and the duplicate session recap left the
     result screen too. The high score keeps accumulating rather than being
     deleted, because a player's history cannot be got back once it stops being
     written. */
  if(!tut){                                     // scripted rounds earn no records
    const best = duo ? Math.max(me,ai) : me;    // duo: best score by either player
    if(best>S.best) S.best=best;
  }
  saveStats();
  setStatus('',null);   // the result screen announces the winner — the table says nothing twice (user call)
  showLocalResult({
    tutorial: tut,
    duo,
    drawn,
    playerOneWon: p1won,
    playerOneScore: me,
    playerTwoScore: ai,
  }, {
    /* Tutorial graduates; ordinary results offer a rematch and one quiet way
       back to the complete setup screen. */
    finishTutorial: () => { closeEnd(); toMenu(); },
    nextDuel: () => { void startLocal(); },
    changeSetup: () => { closeEnd(); show('#ovPractice'); },
  });
}
