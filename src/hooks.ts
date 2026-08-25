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
