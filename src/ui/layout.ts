// fit(): pick the cell size (and the .land breakpoint) from whichever box the
// game occupies. JS owns the breakpoint so CSS and logic always agree.
import { SPEC, ROWSWITCH, ROWMULT } from '../core/rules.ts';
import { S } from '../state.ts';
import { appRoot, isEmbed } from './embed.ts';
import { holdInert } from './modal-background.ts';
import { $ } from './query.ts';
import {
  setLandscapeLayout,
  setShortViewport,
  setSidePointsLayout,
} from './game/root-state.ts';
import { reflowBadge } from './game/hud.ts';
/* the row rail's pill (main.css .rowchips .rc min-width) plus its 9px offset */
const RAIL_LANE = 50;
/* The board is a screen body like any other, so it stops at the SAME column as
   the menus rather than carrying its own cap — a playfield wider than its own
   UI is the mismatch you notice without being able to name it. CSS owns the
   number (--w-col); this reads it, so there is still only one. */
function cssPx(name: string, fallback: number): number {
  const v = parseFloat(getComputedStyle(appRoot()).getPropertyValue(name));
  return v > 0 ? v : fallback;
}
const colWidth = () => cssPx('--w-col', 400);
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
function inset(cs: CSSStyleDeclaration, land: boolean): { v: number; h: number } {
  const b = land ? BASE_PAD.land : BASE_PAD.portrait;
  const over = (value: string, base: number): number => Math.max(0, parseFloat(value) - base);
  return { v: over(cs.paddingTop, b.v) + over(cs.paddingBottom, b.v),
           h: over(cs.paddingLeft, b.h) + over(cs.paddingRight, b.h) };
}
/* WHICH SCREENS MAY TURN. Landscape belongs to the table and to the two screens
   that dress it: the setup you pick a game mode and a rune on, and the result
   you end on. Everything else is a portrait column — a menu that also reflows
   sideways is a second layout to maintain, and only the board gains from the
   width (user call). The list is an ALLOWLIST on purpose: a screen added later
   is portrait until someone decides otherwise, which is the safe default. */
const LANDSCAPE_SCREENS = new Set(['ovPractice', 'ovEnd', 'ovPass', 'ovWheel']);
/* …and these float over whatever is beneath without being a screen of their own,
   so they must not change its mind: a confirm over a menu is still a menu. */
const PASSTHROUGH = new Set(['ovAsk', 'ovLoad', 'ovFirst', 'ovGroupTransition']);
/* Overlays STACK (home stays on beneath pages), and paint order is DOM order,
   so the last `.on` sibling is the one the player is looking at. */
function topScreen(): string {
  let top = '';
  for (const ov of appRoot().querySelectorAll<HTMLElement>('.ov.on')) {
    if (!PASSTHROUGH.has(ov.id)) top = ov.id;
  }
  return top;                                  // '' = no overlay at all = the table
}
function landscapeScreen(top: string): boolean {
  return !top || LANDSCAPE_SCREENS.has(top);
}
export function fit(): void {
  const app=isEmbed()?appRoot():$('#app');
  if (!app) return;
  const w=app.clientWidth, h=app.clientHeight;
  const short = h < 560;
  const top = topScreen();
  const land = w>h && short && landscapeScreen(top);   // short, wide, AND a screen that turns
  setLandscapeLayout(land);
  /* THE BOARD IS ALWAYS MOUNTED, so a page over it is only paint. #app kept its
     place in the tab order and the accessibility tree behind Settings, Profile,
     HOW TO PLAY and Home, where Tab reached the in-game Leave control and
     activating it opened the forfeit ask from underneath an open page. Sheets,
     legal pages and the group transition have always borrowed inert for the
     whole background; ordinary .ov.paged pages never did.
     Driven by the same fact the layout above already needs — which screen the
     player is actually looking at — so a page cannot arrive without it, and
     held through makeInert()'s lock so a sheet opening over a page and closing
     again restores this hold rather than clearing it. A PASSTHROUGH ask over
     the live table is deliberately not counted: it is a sheet, and it borrows
     the background itself. In an embedded widget `app` IS the root, so there is
     no background to hold. */
  if (!isEmbed()) holdInert(app, top !== '');
  /* A SHORT VIEWPORT IS NOT THE SAME FACT AS A LANDSCAPE LAYOUT, and conflating
     them cost the offline setup screen its Play button: .ov centres its content
     and never scrolls, so on a 390px-tall phone the button sat below the fold
     with no way to reach it. The overlays need to know the viewport is short
     even when — especially when — they are keeping their portrait layout. */
  setShortViewport(short);
  const safe = inset(getComputedStyle(app), land);
  const rowmode = S.scoring===ROWSWITCH || S.scoring===ROWMULT;
  let cell: number;
  if(land){
    // one board tall: hud + plate + a column of cells; one board wide: both
    // boards' rows + 2 chip strips + the centre stage
    /* The centre lane's width is a CSS token, not a number repeated here: the
       lane is pinned to it (main.css .land .center) and this reads the same
       one. It was a literal 116 while the CSS let the lane size itself to the
       status text, so the two disagreed on every turn — which is exactly the
       kind of drift a shared token exists to make impossible. */
    /* Row modes hang their rail ABOVE the board in landscape (portrait puts it
       beside). It is absolutely positioned, so this is what reserves it — same
       bargain as the portrait branch below. */
    const railL = rowmode ? cssPx('--land-rail', 22) : 0;
    /* Protection ink is deliberately outside the board box. Reserve its clasp
       and stroke at both viewport edges; without this, 667x375 chose a 75px
       cell and clipped about five pixels of the ward's only breakable mark. */
    const inkEdges = 2 * cssPx('--seal-edge-gutter', 8);
    const boardChipGaps = 2 * cssPx('--land-board-chip-gap', 8);
    const byH = Math.floor((h - safe.v - 28 - 20 - 2*6 - 14 - railL) / SPEC.cols);
    /* 32px is the two boards' four 6px cell gaps plus the table's two 4px
       gaps. The board/chip gap is a token because CSS and this budget share it. */
    const byW = Math.floor((w - safe.h - 2*30 - cssPx('--land-lane', 116)
      - 32 - boardChipGaps - inkEdges) / (2*SPEC.rows));
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
  appRoot().style.setProperty('--cell', cell+'px');
  /* the side-points seating (main.css #kbroot.sidepts): the score leaves the
     nameplate for the gutter beside the board wherever that gutter can hold
     a number at all — the font SCALES to the gutter (main.css), so 40px is
     enough for the small end of it; truly tight screens keep the original
     plate (user call). Landscape has no gutter at all.
     THE SEATING MAY NOT DEPEND ON THE MODE at a given size (user call): a
     name that centres in classic and slides left in ROW SWITCH reads as the
     table rearranging itself for no reason. Row modes only need a BIGGER
     gutter, not a different plate — their score rail hangs off the board's
     left (main.css #kbroot.rowmode .rowchips is right:100%) while the points
     sit in the right one, so the two never meet; asking the gutter to hold
     the wider of the two tenants is the whole difference. */
  /* EVEN, always. The score cluster is placed at right:--gut/2 and centres a
     20px rune inside itself, so an odd gutter puts both on a half pixel — the
     button's edge and its glowing icon then straddle the device grid and
     shimmer on every repaint (user report). Rounding down to even costs at
     most one pixel of gutter and buys a rune that sits still. */
  const gut = 2 * Math.floor((w - safe.h - 20 - (cell*SPEC.cols + 2*6)) / 4);
  const sidepts = !land && gut >= (rowmode ? RAIL_LANE : 40);
  setSidePointsLayout(sidepts);
  appRoot().style.setProperty('--gut', gut+'px');
  /* The asymmetric-rune nameplates use the board's measured width, localized
     identity, and localized rune label. Re-evaluate only after every geometry
     token and layout fact for this fit has settled. */
  reflowBadge();
}
