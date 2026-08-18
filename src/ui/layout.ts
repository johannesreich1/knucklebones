// @ts-nocheck -- moved verbatim from the monolith; typed in the milestone-D
// strictness ratchet. New code goes in typed modules, not here.
// fit(): pick the cell size (and the .land breakpoint) from whichever box the
// game occupies. JS owns the breakpoint so CSS and logic always agree.
import { SPEC, ROWSWITCH, ROWMULT } from '../core/rules.ts';
import { S } from '../state.ts';
import { $ } from './dom.ts';
import { isEmbed, kbroot } from './embed.ts';
/* the row rail's pill (main.css .rowchips .rc min-width) plus its 9px offset */
const RAIL_LANE = 50;
export function fit(){
  const app=isEmbed()?kbroot():$('#app');
  const w=app.clientWidth, h=app.clientHeight;
  const land = w>h && h<560;                 // short and wide: phone on its side
  document.documentElement.classList.toggle('land', land);
  let cell;
  if(land){
    // one board tall: hud + plate + a column of cells; one board wide: both
    // boards' rows + 2 chip strips + the centre stage
    const byH = Math.floor((h - 28 - 20 - 2*6 - 14) / SPEC.cols);
    const byW = Math.floor((w - 2*30 - 116 - 40) / (2*SPEC.rows));
    cell = Math.max(34, Math.min(byH, byW, 84));   // capped so it isn't edge-to-edge
  }else{
    const lane = S.tut ? 15 : 4;               // preview-pill lane is tutorial-only
    const fixed = 34 + 2*24 + 2*20 + 4*5 + 94 + 26 + 2*lane + 12;
    const byH = Math.floor((h - fixed - 4*6) / (2*SPEC.rows));
    /* Row modes hang a score rail outside each board. It is absolutely
       positioned, so nothing else reserves its lane — without this the centred
       board grows until the rail is pressed against the screen edge. Both sides
       are reserved to keep the board centred; on tall phones the cell is
       height-bound anyway, so this costs nothing there. */
    const rail = (S.scoring===ROWSWITCH || S.scoring===ROWMULT) ? 2*RAIL_LANE : 0;
    const byW = Math.floor((Math.min(w,430) - 20 - 2*6 - rail) / SPEC.cols);
    cell = Math.max(38, Math.min(byH, byW, 88));
  }
  document.documentElement.style.setProperty('--cell', cell+'px');
}
