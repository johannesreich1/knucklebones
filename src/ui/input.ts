// @ts-nocheck -- moved verbatim from the monolith; typed in the milestone-D
// strictness ratchet. New code goes in typed modules, not here.
// Input: tap binding that survives inconsistent webviews, and the
// press-then-release-on-the-same-column placement gesture (slide off to
// cancel). commitColumn is the single gate every input path funnels through.
import { ME, SPEC } from '../core/rules';
import { S } from '../state';
import { ownerOf } from './dom';
import { Sfx } from './audio';
import { place } from '../flow/game';
/* ===================== INPUT BINDING =====================
   Embedded webviews are inconsistent about synthesising `click` from a touch.
   Bind pointerdown / touchstart / click and de-duplicate, so a tap registers
   on whichever of the three the host actually delivers. */
export function tap(el,fn){
  let last=0;
  const fire=e=>{ last=Date.now(); fn(e); };
  if(window.PointerEvent) el.addEventListener('pointerdown',fire);
  else if('ontouchstart' in window) el.addEventListener('touchstart',fire,{passive:true});
  // click stays bound as a fallback for hosts that deliver only synthetic clicks;
  // it is ignored when it is just the tail of a tap we already handled.
  el.addEventListener('click',e=>{ if(Date.now()-last<600) return; fire(e); });
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
  if(!playableCol(col)) return;
  pressedCol=col;
  col.classList.add('press');
}
export function boardUp(e){
  const started=pressedCol;
  clearPress();
  if(!started) return;
  let over=null;
  if(typeof e.clientX==='number'){
    const el=document.elementFromPoint(e.clientX,e.clientY);
    over = el && el.closest ? el.closest('.col') : null;
  }else over=started;
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
    col.classList.add('nope'); setTimeout(()=>col.classList.remove('nope'),340);
    Sfx.tap(); return;                       // the lesson wants a specific column
  }
  if(S.boards[who][c].length>=SPEC.rows){
    col.classList.add('nope'); setTimeout(()=>col.classList.remove('nope'),340); Sfx.tap(); return;
  }
  Sfx.tap();
  place(who,c);
}
