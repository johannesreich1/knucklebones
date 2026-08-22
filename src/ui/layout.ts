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
/* The board is a screen body like any other, so it stops at the SAME column as
   the menus rather than carrying its own cap — a playfield wider than its own
   UI is the mismatch you notice without being able to name it. CSS owns the
   number (--w-col); this reads it, so there is still only one. */
function colWidth(): number {
  const v = parseFloat(getComputedStyle(document.documentElement).getPropertyValue('--w-col'));
  return v > 0 ? v : 400;
}
/* The base padding #app carries on top of the device's safe-area insets, per
   orientation (main.css #app and .land #app). */
const BASE_PAD = { portrait: { v: 6, h: 10 }, land: { v: 4, h: 8 } };
/* How much of #app's padding is DEVICE inset rather than our own flat padding.
   clientHeight/clientWidth include padding, and on a notched phone that padding
   holds the Dynamic Island and home-indicator strips — space the board can never
   use. The budgets below already account for the flat base, so only the extra
   comes off. Without it the cell was sized against unusable strips and the near
   nameplate slid under the home indicator on every notched phone small enough
   that the cell cap didn't quietly absorb the error (390x844: 9px under). */
function inset(cs, land){
  const b = land ? BASE_PAD.land : BASE_PAD.portrait;
  const over = (side, base) => Math.max(0, parseFloat(cs['padding'+side]) - base);
  return { v: over('Top', b.v) + over('Bottom', b.v),
           h: over('Left', b.h) + over('Right', b.h) };
}
export function fit(){
  const app=isEmbed()?kbroot():$('#app');
  const w=app.clientWidth, h=app.clientHeight;
  const land = w>h && h<560;                 // short and wide: phone on its side
  document.documentElement.classList.toggle('land', land);
  const safe = inset(getComputedStyle(app), land);
  let cell;
  if(land){
    // one board tall: hud + plate + a column of cells; one board wide: both
    // boards' rows + 2 chip strips + the centre stage
    const byH = Math.floor((h - safe.v - 28 - 20 - 2*6 - 14) / SPEC.cols);
    const byW = Math.floor((w - safe.h - 2*30 - 116 - 40) / (2*SPEC.rows));
    cell = Math.max(34, Math.min(byH, byW, 84));   // capped so it isn't edge-to-edge
  }else{
    const lane = S.tut ? 15 : 4;               // preview-pill lane is tutorial-only
    const fixed = 34 + 2*24 + 2*20 + 4*5 + 94 + 26 + 2*lane + 12;
    const byH = Math.floor((h - safe.v - fixed - 4*6) / (2*SPEC.rows));
    /* Row modes hang a score rail outside each board. It is absolutely
       positioned, so nothing else reserves its lane — without this the centred
       board grows until the rail is pressed against the screen edge. Both sides
       are reserved to keep the board centred; on tall phones the cell is
       height-bound anyway, so this costs nothing there. */
    const rail = (S.scoring===ROWSWITCH || S.scoring===ROWMULT) ? 2*RAIL_LANE : 0;
    const byW = Math.floor((Math.min(w - safe.h, colWidth()) - 20 - 2*6 - rail) / SPEC.cols);
    cell = Math.max(38, Math.min(byH, byW, 88));
  }
  document.documentElement.style.setProperty('--cell', cell+'px');
  /* the side-points seating (main.css html.sidepts): the score leaves the
     nameplate for the gutter beside the board wherever that gutter can hold
     a number at all — the font SCALES to the gutter (main.css), so 40px is
     enough for the small end of it; truly tight screens keep the original
     plate (user call). Landscape has no gutter at all.
     THE SEATING MAY NOT DEPEND ON THE MODE at a given size (user call): a
     name that centres in classic and slides left in ROW SWITCH reads as the
     table rearranging itself for no reason. Row modes only need a BIGGER
     gutter, not a different plate — their score rail hangs off the board's
     left (main.css html.rowmode .rowchips is right:100%) while the points
     sit in the right one, so the two never meet; asking the gutter to hold
     the wider of the two tenants is the whole difference. */
  /* EVEN, always. The score cluster is placed at right:--gut/2 and centres a
     20px rune inside itself, so an odd gutter puts both on a half pixel — the
     button's edge and its glowing icon then straddle the device grid and
     shimmer on every repaint (user report). Rounding down to even costs at
     most one pixel of gutter and buys a rune that sits still. */
  const gut = 2 * Math.floor((w - safe.h - 20 - (cell*SPEC.cols + 2*6)) / 4);
  const rowmode = S.scoring===ROWSWITCH || S.scoring===ROWMULT;
  const sidepts = !land && gut >= (rowmode ? RAIL_LANE : 40);
  document.documentElement.classList.toggle('sidepts', sidepts);
  document.documentElement.style.setProperty('--gut', gut+'px');
}
