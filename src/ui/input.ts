// @ts-nocheck -- moved verbatim from the monolith; typed in the milestone-D
// strictness ratchet. New code goes in typed modules, not here.
// Input: tap binding that survives inconsistent webviews, and the
// press-then-release-on-the-same-column placement gesture (slide off to
// cancel). commitColumn is the single gate every input path funnels through.
import { ME, SPEC } from '../core/rules.ts';
import { S } from '../state.ts';
import { ownerOf } from './dom.ts';
import { nope } from './fx.ts';
import { Sfx } from './audio.ts';
import { place } from '../flow/game.ts';
import { castArmed } from '../flow/spells.ts';

/* Online matches route placements to the server instead of the local machine.
   Everything else about input (gesture, gating, sfx) stays identical. */
let placeHandler = place;
export function setPlaceHandler(h){ placeHandler = h || place; }
/* ===================== INPUT BINDING =====================
   Embedded webviews are inconsistent about synthesising `click` from a touch.
   Bind pointerdown / touchstart / click and de-duplicate, so a tap registers
   on whichever of the three the host actually delivers. */
/* The ghost-click guard is GLOBAL, not per-element, and only a real pointer or
   touch arms it. A tap acts on pointerdown; the synthetic click that trails it
   arrives later and hits whatever is under the finger BY THEN — which is a
   different element once the first handler has closed an overlay. The Settings
   ✕ sits directly over the HUD gear that opens Settings, so closing on
   pointerdown let the trailing click reopen the sheet instantly. A per-element
   guard cannot see that: the second element was never tapped.
   Hosts that deliver ONLY synthetic clicks never arm the guard, so their
   fallback still works. */
let lastNativeTap = 0;
export function tap(el,fn){
  const fireNative=e=>{ lastNativeTap=Date.now(); fn(e); };
  if(window.PointerEvent) el.addEventListener('pointerdown',fireNative);
  else if('ontouchstart' in window) el.addEventListener('touchstart',fireNative,{passive:true});
  el.addEventListener('click',e=>{ if(Date.now()-lastNativeTap<600) return; fn(e); });
}
/* Press a bound control from CODE (the edge swipe commits this way). A bare
   .click() is swallowed whenever any real tap landed within the guard's
   600ms — the guard cannot tell a synthetic click from a ghost. So feed the
   control the event tap() actually binds first, then click() for handlers
   bound the plain way; whichever fires, the other one is deduped. */
export function press(el){
  if(window.PointerEvent) el.dispatchEvent(new PointerEvent('pointerdown',{bubbles:true}));
  else if('ontouchstart' in window) el.dispatchEvent(new TouchEvent('touchstart'));
  el.click();
}
/* Placement commits on RELEASE over the same column it started on, so a
   mis-tap can be cancelled by sliding a finger off before lifting. Touch
   implicitly captures the pointer to the original element, so the element
   actually under the finger has to be looked up by coordinate. */
let pressedCol=null;
function playableCol(col){
  if(!col || S.phase!=='choose' || S.busy) return false;
  const who=ownerOf(col.closest('.side'));
  return who===S.turn && !(S.mode==='cpu' && who!==ME);
}
export function clearPress(){
  if(pressedCol) pressedCol.classList.remove('press');
  pressedCol=null;
}
export function boardDown(e){
  const col=e.target.closest && e.target.closest('.col');
  clearPress();
  if(S.spellArmed) return;              // a spell is aiming: no placement press
  if(!playableCol(col)) return;
  pressedCol=col;
  col.classList.add('press');
}
export function boardUp(e){
  const started=pressedCol;
  clearPress();
  let over=null, onStage=false;
  if(typeof e.clientX==='number'){
    const el=document.elementFromPoint(e.clientX,e.clientY);
    over = el && el.closest ? el.closest('.col') : null;
    onStage = !!(el && el.closest && el.closest('#dieStage'));
  }else over=started;
  // an armed spell claims the tap — a column, the die in play (−1, the self
  // spells' target), or nowhere useful, which cancels. castArmed sorts out
  // whether the hit fits the armed spell's vocabulary.
  if(S.spellArmed) return void castArmed(onStage ? -1 : over ? +over.dataset.col : null);
  if(!started) return;
  if(over!==started) return;            // slid away: treat as cancelled
  commitColumn(started);
}
export function commitColumn(col){
  if(!col) return;
  const who=ownerOf(col.closest('.side'));
  if(S.phase!=='choose' || S.busy || who!==S.turn) return;
  if(S.mode==='cpu' && who!==ME) return;
  const c=+col.dataset.col;
  if(S.tut && S.tut.restrict!=null && c!==S.tut.restrict){
    nope(col); Sfx.tap(); return;            // the lesson wants a specific column
  }
  if(S.boards[who][c].length>=SPEC.rows){ nope(col); Sfx.tap(); return; }
  Sfx.tap();
  placeHandler(who,c);
}
