// The local turn state machine and game lifecycle. Physical roll/move work is
// shared with ranked play under ui/game; CPU policy has its own typed seam.
import {
  AI,
  ME,
  CLASSIC,
  BOUNTY,
  LIMITED,
  emptyBoard,
  isOver,
  legalCols,
  totalOf,
  type Mode,
  type Player,
} from '../core/rules.ts';
import { makeBag } from '../core/dice.ts';
import { RANDOM, pickMode } from '../core/modes.ts';
import { RANDOM_DUAL_SPELL, RANDOM_SPELL, SPELLS, spellById } from '../core/spells.ts';
import { formatNumber, t } from '../i18n/index.ts';
import { reveal } from '../ui/reveal.ts';
import { isNewcomer, offerTutorial } from '../ui/firstrun.ts';
import { S } from '../state.ts';
import { saveStats } from '../persist.ts';
import { Sfx, vibrate } from '../ui/audio.ts';
import { $, show, hide } from '../ui/dom.ts';
import { showBag, renderBag } from '../ui/bag.ts';
import { nameOf } from '../ui/identity.ts';
import { setStageDie } from '../ui/die.ts';
import { renderAll } from '../ui/game/board.ts';
import { clearHints, showHints } from '../ui/game/hints.ts';
import { updateRecord } from '../ui/game/hud.ts';
import { animateGameMove } from '../ui/game/move-view.ts';
import { animateStageRoll } from '../ui/game/motion.ts';
import { setTutorialPresentation } from '../ui/game/root-state.ts';
import { applySides, setActivePlate, setStatus, settleBoard } from '../ui/game/turn-state.ts';
import { fit } from '../ui/layout.ts';
import { startTimer, stopTimer, showClock } from './timer.ts';
import { coachShow, coachHide, clearTut, tutNextRoll, tutOnChoose } from './tutorial.ts';
import { toMenu } from './menu.ts';
import { closeEnd } from '../ui/endscreen.ts';
import {
  aiSpellPlacementTurn,
  disarm,
  drawSpellDeal,
  renderSpells,
  resetSpells,
  resolveTimedOutSpellAim,
  type SpellDeal,
} from './spells.ts';
import { aiChoose } from './game-ai.ts';
import { showLocalResult } from './local-result.ts';
import { hidePassCard, showPassCard } from './pass-card.ts';

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
  setStatus(() => t('game', 'status.outOfTime', { column: formatNumber(c + 1) }), who);
  vibrate([30,40,30]);
  void place(who, c);
}
let passResolve: (() => void) | null = null;
function handOff(who: Player): Promise<boolean> {
  return new Promise<boolean>((resolve) => {
    const gen=S.gen;
    S.phase='pass';
    stopTimer();
    clearHints();
    setStageDie(0);
    setStatus(() => t('game', 'status.passPhone'), who);
    showPassCard(who);
    Sfx.pass();
    const go=()=>{
      hidePassCard();
      if(S.gen!==gen) { resolve(false); return; }
      S.bottom=who;
      applySides();
      const table=$('#tableEl');
      table.classList.remove('swap'); void table.offsetWidth; table.classList.add('swap');
      setTimeout(()=>table.classList.remove('swap'),480);
      Sfx.tap(); vibrate(10);
      resolve(true);
    };
    passResolve=go;      // consumed by the single listener bound in boot()
  });
}
/* the whole hand-off card is the one continue target; it has no corner control */
export function passTap(): void {
  if(passResolve){ const f=passResolve; passResolve=null; f(); }
}
/* abandoning mid-hand-off (quit to menu): drop the pending resolver */
export function cancelPass(): void { passResolve=null; }
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
  setStatus(() => duo
    ? t('game', 'status.playerChoose', { player: nameOf(who) })
    : t('game', 'status.chooseColumn'), who);
  renderSpells();
}
const gameOver = (): boolean => S.phase === 'over';
export async function nextTurn(): Promise<void> {
  const gen=S.gen;
  if(S.phase==='over') return;
  renderAll(false);   // same repaint belt online uses: state wins every turn
  renderSpells();     // ...and the rail belongs to the turn: the seat that just
                      // lost it dims here. sayChoose() repaints it again when a
                      // HUMAN gets the choice; on the machine's turn nothing
                      // else would, and the rune stayed lit through it.
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
  S.turn = (1 - who) as Player;
  S.busy = false;
  S.die = 0;
  void nextTurn();
}
/* ===================== GAME LIFECYCLE ===================== */
/* THE way a local game starts, and the only place RANDOM is resolved.
   There are three ways to ask for a game — the OFFLINE sheet's Play, the
   keyboard, and Next duel on the result screen — and the first version of this
   taught only the Play button about RANDOM, so the rematch button quietly dealt
   classic for the rest of the session. One door, no exceptions.
   Every RANDOM promise is resolved here, before anything is dealt, and handed
   to newGame as its exact answer. Drawing inside newGame instead would look
   identical on screen and be a different game every time. */
export async function startLocal(): Promise<void> {
  /* A newcomer is offered the tutorial before their first real game — once,
     ever, and never in front of the tutorial itself. */
  if(isNewcomer() && await offerTutorial()){ newGame({tutorial:true}); return; }
  const selectedMode: number = S.localMode;
  const mode = selectedMode === RANDOM ? pickMode(Math.random().toString(36).slice(2)) : null;
  const randomRunes = S.spell === RANDOM_SPELL || S.spell === RANDOM_DUAL_SPELL
    ? drawSpellDeal() : null;
  /* Resolve every random choice in one reveal sequence and one countdown. */
  if(mode || randomRunes){
    hide('#ovEnd'); hide('#ovStart'); hide('#ovPractice');
    const mine = randomRunes ? spellById(randomRunes[ME]) : null;
    const theirs = randomRunes ? spellById(randomRunes[AI]) : null;
    await reveal({
      mode,
      spell: S.spell === RANDOM_SPELL ? mine : null,
      runes: S.spell === RANDOM_DUAL_SPELL && mine && theirs ? [
        { spell: mine, player: ME },
        { spell: theirs, player: AI, candidates: SPELLS.filter((spell) => spell.id !== mine.id) },
      ] : undefined,
    });
  }
  newGame({ scoring: mode?.mode, spells: randomRunes ?? undefined });
}

export interface NewGameOptions {
  tutorial?: boolean;
  scoring?: Mode;
  spell?: string;
  spells?: Readonly<SpellDeal>;
}

export function newGame(opts: NewGameOptions = {}): void {
  const tutorial = !!opts.tutorial;
  const gen = ++S.gen;
  // the OFFLINE view's selector picks the mode; the tutorial teaches classic.
  // opts.scoring is how RANDOM arrives — already rolled and shown on the dial,
  // so newGame is handed the answer rather than rolling a second one.
  // opts.spells is the same bargain for the rune cards the deck turned over;
  // opts.spell remains the shared-rune convenience used by focused helpers.
  S.scoring = tutorial ? CLASSIC : (opts.scoring ?? S.localMode);
  S.bounty=[0,0];
  // LIMITED offline: the same bag the ranked game deals, shuffled locally
  // (no replay validator to agree with, so plain Math.random is right here)
  S.pool = S.scoring===LIMITED ? makeBag(Math.random) : null;
  showBag(!!S.pool);
  if(S.pool) renderBag(S.pool.length);
  stopTimer();
  if(tutorial){
    S.mode='cpu';
    S.starter=ME;                            // the lessons assume you move first
    S.tut={ turnNo:-1, prolls:[4,4,5], crolls:[2,5], cmoves:[2,1],
            firstCol:null, restrict:null };
  }else{
    clearTut();
  }
  setTutorialPresentation(!!S.tut);
  S.boards=[emptyBoard(),emptyBoard()];
  S.die=0; S.phase='roll'; S.busy=false;
  S.turn=S.starter;
  resetSpells(opts.spells ?? opts.spell);    // deal this game's charges (none in a lesson)
  S.starter = (1 - S.starter) as Player;
  // pass mode: whoever starts holds the phone. face mode: halves never move.
  S.bottom = (S.mode==='duo' && S.seat==='pass') ? S.turn : ME;
  clearHints();
  setStageDie(0);
  showClock();                               // reserve the clock lane only if this game has one
  fit();                                     // the tutorial's pill lane changes cell size
  applySides();
  updateRecord();
  hide('#ovEnd'); hide('#ovStart'); hide('#ovRules'); hide('#ovPass'); hide('#ovPractice');
  hide('#ovLearn');   // the hub the tutorial is started FROM, or it stays over the board
  const openingPlayer = S.turn;
  const duo = S.mode === 'duo';
  setStatus(() => duo
    ? t('game', 'status.playerStarts', { player: nameOf(openingPlayer) })
    : (openingPlayer === ME ? t('game', 'status.youFirst') : t('game', 'status.aiFirst')),
  openingPlayer);
  setActivePlate();
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
  if(!tut) S.played=true;                    // the hub stops nagging after this
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
  if(!tut){                                     // a scripted round earns no records
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
