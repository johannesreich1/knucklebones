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
/* A control PRESSES on the way down and ACTS on the way up. Firing on
   pointerdown (what this did) swapped the screen before the pressed frame
   could ever paint, so the same button looked animated or instant depending
   only on how fast the next view arrived — and a mis-tap could not be taken
   back (user report). Down arms and lets :active show; up over the same
   control fires; sliding off cancels, exactly like the board's placement
   gesture. The ghost-click guard is unchanged: a real pointer or touch
   still arms it, so the synthetic click trailing a tap is ignored while
   click-only hosts keep working. */
export function tap(el,fn){
  const fire=e=>{ lastNativeTap=Date.now(); fn(e); };
  let armed=false;
  /* the press visual is OURS, not the UA's: :active is unreliable in embedded
     webviews (and dies under pointer capture), which is why the same button
     looked animated on one tap and dead on the next (user report). One class,
     mirrored by every :active rule in the sheet. */
  const hold=on=>el.classList.toggle('pressing',on);
  const disarm=()=>{ armed=false; hold(false); };
  if(window.PointerEvent){
    /* No setPointerCapture here, deliberately: capture RETARGETS the release to
       the capturing element, and half these bindings sit on a CONTAINER and
       read e.target.closest('button') to learn which segment was hit (boot's
       bindSeg, the picker rows). Capturing blinded all of them — seven suites
       caught it. Slide-off is handled by the rect test and pointerleave. */
    el.addEventListener('pointerdown',()=>{ armed=true; hold(true); });
    el.addEventListener('pointerup',e=>{
      if(!armed) return;
      armed=false; hold(false);
      // released off the control (slid away): cancelled, not a tap
      const r=el.getBoundingClientRect();
      if(typeof e.clientX==='number' &&
         (e.clientX<r.left||e.clientX>r.right||e.clientY<r.top||e.clientY>r.bottom)) return;
      fire(e);
    });
    el.addEventListener('pointercancel',disarm);
    el.addEventListener('pointerleave',disarm);
  }
  else if('ontouchstart' in window){
    el.addEventListener('touchstart',()=>{ armed=true; hold(true); },{passive:true});
    el.addEventListener('touchend',e=>{
      if(!armed) return;
      armed=false; hold(false);
      const t=e.changedTouches && e.changedTouches[0];
      const over=t ? document.elementFromPoint(t.clientX,t.clientY) : null;
      if(over && !el.contains(over) && over!==el) return;   // slid off: cancelled
      fire(e);
    });
    el.addEventListener('touchcancel',disarm);
  }
  el.addEventListener('click',e=>{ if(Date.now()-lastNativeTap<600) return; fn(e); });
}
/* Press a bound control from CODE (the edge swipe commits this way). A bare
   .click() is swallowed whenever any real tap landed within the guard's
   600ms — the guard cannot tell a synthetic click from a ghost. So feed the
   control the event tap() actually binds first, then click() for handlers
   bound the plain way; whichever fires, the other one is deduped. */
export function press(el){
  /* the full down-then-up now, since tap() acts on release: the release
     carries the control's own centre so the slid-off test passes */
  if(window.PointerEvent){
    const r=el.getBoundingClientRect();
    const at={bubbles:true,clientX:r.left+r.width/2,clientY:r.top+r.height/2};
    el.dispatchEvent(new PointerEvent('pointerdown',at));
    el.dispatchEvent(new PointerEvent('pointerup',at));
  }
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
