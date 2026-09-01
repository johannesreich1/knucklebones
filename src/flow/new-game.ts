// How a fresh local game is dealt and dressed: the scoring rules, the LIMITED
// bag, the tutorial script, empty boards, rune charges, seating, the clock
// lane, the fit, and the opening status. Middle of the offline pipeline —
// local-start.ts resolves the setup PROMISES, this module APPLIES them, and
// flow/game.ts's newGame() only starts the first turn on top of the result.
import { CLASSIC, LIMITED, ME, emptyBoard, type Mode, type Player } from '../core/rules.ts';
import { makeBag } from '../core/dice.ts';
import { t } from '../i18n/index.ts';
import { S, type LocalRuneTrial } from '../state.ts';
import { showBag, renderBag } from '../ui/bag.ts';
import { hide } from '../ui/dom.ts';
import { nameOf } from '../ui/identity.ts';
import { setStageDie } from '../ui/die.ts';
import { clearHints } from '../ui/game/hints.ts';
import { updateRecord } from '../ui/game/hud.ts';
import { setScoringPresentation, setTutorialPresentation } from '../ui/game/root-state.ts';
import { applySides, setActivePlate, setStatus } from '../ui/game/turn-state.ts';
import { fit } from '../ui/layout.ts';
import { stopTimer, showClock } from './timer.ts';
import { clearTut } from './tutorial.ts';
import { resetSpells, type SpellDeal } from './spells.ts';

export interface NewGameOptions {
  tutorial?: boolean;
  scoring?: Mode;
  spell?: string;
  spells?: Readonly<SpellDeal>;
  trial?: LocalRuneTrial | null;
}

/* What the opener needs back: the generation this deal claimed, so a first turn
   scheduled on it can tell whether a later deal has already replaced it. */
export interface NewGameDeal {
  readonly tutorial: boolean;
  readonly gen: number;
}

/** Apply one resolved local setup to the table, up to but not including the first turn. */
export function dealNewGame(opts: NewGameOptions): NewGameDeal {
  const tutorial = !!opts.tutorial;
  const gen = ++S.gen;
  // the OFFLINE view's selector picks the mode; the tutorial teaches classic.
  // opts.scoring is how RANDOM arrives — already rolled and shown on the dial,
  // so the deal is handed the answer rather than rolling a second one.
  // opts.spells is the same bargain for the rune cards the deck turned over;
  // opts.spell remains the shared-rune convenience used by focused helpers.
  S.scoring = tutorial ? CLASSIC
    : (opts.scoring ?? (S.localMode >= CLASSIC ? S.localMode as Mode : CLASSIC));
  setScoringPresentation(S.scoring);
  S.localTrial = tutorial || !opts.trial ? null : {
    offer: [...opts.trial.offer] as [string, string, string],
    spells: [...opts.trial.spells] as [string, string],
  };
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
  return { tutorial, gen };
}
