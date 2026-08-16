// Test hooks (harmless in normal play): the stable surface the Playwright
// suites drive the game through. Keep names stable -- the suites depend on them.
import { colScore, boardTotal, isFull, applyMove, cloneSt } from './core/rules';
import { search, searchRoot, riskOf, getRiskW, setRiskW, nodes } from './core/ai';
import { S } from './state';
import { loadGame, saveGame, clearGame } from './persist';
import { sideKey } from './ui/dom';
import { nameOf } from './ui/identity';
import { setStageDie } from './ui/die';
import { REDUCED, burst } from './ui/fx';
import { applySides, renderAll, showHints, setStatus, setActivePlate } from './ui/render';
import { fit } from './ui/layout';
import { aiChoose, newGame, place } from './flow/game';
import { resumeGame } from './flow/menu';

export function hooks(){
  return { S, colScore, boardTotal, search, searchRoot, aiChoose, newGame, place, isFull,
           applyMove, cloneSt, riskOf, getW:getRiskW, setW:setRiskW, nodes,
           sideKey, applySides, renderAll, showHints, setStageDie, setStatus, setActivePlate, nameOf,
           loadGame, saveGame, clearGame, resumeGame, burst, reduced:REDUCED, fit };
}
