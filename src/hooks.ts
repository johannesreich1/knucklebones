// Test hooks (harmless in normal play): the stable surface the Playwright
// suites drive the game through. Keep names stable -- the suites depend on them.
import { colScore, boardTotal, isFull, applyMove, cloneSt } from './core/rules.ts';
import { search, searchRoot, riskOf, getRiskW, setRiskW, nodes } from './core/ai.ts';
import { S } from './state.ts';
import { sideKey, show, hide } from './ui/dom.ts';
import { nameOf } from './ui/identity.ts';
import { setStageDie } from './ui/die.ts';
import { REDUCED, burst } from './ui/fx.ts';
import { applySides, renderAll, showHints, setStatus, setActivePlate } from './ui/render.ts';
import { fit } from './ui/layout.ts';
import { aiChoose, newGame, place } from './flow/game.ts';

export function hooks(){
  return { S, colScore, boardTotal, search, searchRoot, aiChoose, newGame, place, isFull,
           applyMove, cloneSt, riskOf, getW:getRiskW, setW:setRiskW, nodes,
           sideKey, applySides, renderAll, showHints, setStageDie, setStatus, setActivePlate, nameOf,
           burst, reduced:REDUCED, fit,
           openPractice: () => { hide('#ovStart'); show('#ovPractice'); },
           goHome: () => { hide('#ovPractice'); show('#ovStart'); } };
}
