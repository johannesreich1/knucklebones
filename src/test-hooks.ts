// Test hooks (harmless in normal play): the stable surface the Playwright
// suites drive the game through. Keep names stable -- the suites depend on them.
import { colScore, boardTotal, isFull, applyMove, cloneSt } from './core/rules.ts';
import { searchRoot, riskOf, nodes } from './core/ai.ts';
import { S } from './state.ts';
import { sideKey, faceRotated, show, hide } from './ui/dom.ts';
import { nameOf } from './ui/identity.ts';
import { setStageDie } from './ui/die.ts';
import { loaderDie } from './ui/loader.ts';
import { REDUCED, burst } from './ui/fx.ts';
import { renderAll } from './ui/game/board.ts';
import { showHints } from './ui/game/hints.ts';
import { applySides, setStatus, setActivePlate } from './ui/game/turn-state.ts';
import { fit } from './ui/layout.ts';
import { closeEnd, showEnd } from './ui/endscreen.ts';
import { closeOpenSheet, sheetOpen } from './ui/sheet.ts';
import { reveal } from './ui/reveal.ts';
import { aiChoose, newGame, place, sayChoose } from './flow/game.ts';
import {
  cast,
  arm,
  disarm,
  chargesOf,
  renderSpells,
  aiSpellTurn,
  aiSpellDelay,
  resolveTimedOutSpellAim,
} from './flow/spells.ts';

import { modeByEnum } from './core/modes.ts';

export function hooks(){
  return { S, colScore, boardTotal, searchRoot, aiChoose, newGame, place, sayChoose, isFull,
           applyMove, cloneSt, riskOf, nodes,
           sideKey, faceRotated, applySides, renderAll, showHints, setStageDie, loaderDie, setStatus, setActivePlate, nameOf,
           burst, get reduced(){ return REDUCED; }, fit,
           showEnd, closeEnd,
           /* The pre-game reveal, so a suite can drive the one thing no player
              can reach on purpose: a deferred act that REJECTS. The overlay is
              full-screen and its only dismissal is the hold's tap, so "it comes
              off on every exit" is a contract, not an implementation detail. */
           reveal,
           /* The one shared modal sheet, published so a suite can ask the APP
              whether a card is still up instead of guessing at class names —
              a settled sheet and a dismissing one wear the same `fofly`. The
              close is `closeOpenSheet`, the same door ui/firstrun.ts uses, so
              a harness tidying up between scenarios goes out the way a player
              would rather than deleting the node. */
           sheet: { open: sheetOpen, close: closeOpenSheet },
           spells: {
             cast,
             arm,
             disarm,
             chargesOf,
             render: renderSpells,
             // Most effect scenarios ask the CPU to act immediately. The
             // delayed hook exercises the visible cast tell separately.
             ai: (who: 0 | 1) => aiSpellTurn(who, false),
             aiDelayed: aiSpellTurn,
             aiDelay: aiSpellDelay,
             timeoutAim: resolveTimedOutSpellAim,
           },
           modeByEnum,
           openPractice: () => { hide('#ovStart'); show('#ovPractice'); },
           goHome: () => { hide('#ovPractice'); show('#ovStart'); } };
}
