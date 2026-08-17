// @ts-nocheck -- moved verbatim from the monolith; typed in the milestone-D
// strictness ratchet. New code goes in typed modules, not here.
// The two-player turn clock. Pure countdown + display; what happens on
// expiry is injected by the flow (no upward dependency).
import { S } from '../state.ts';
import { $ } from '../ui/dom.ts';
import { colorOf } from '../ui/identity.ts';
/* ===================== TURN CLOCK (two-player only) =====================
   Runs only while a human is choosing, never during the hand-off card. On
   expiry it drops the die into a random legal column so a walk-away can't
   stall the game. */
let timerId=null;
export function stopTimer(){
  if(timerId){ clearInterval(timerId); timerId=null; }
  const w=$('#timerWrap');
  if(w){ w.classList.remove('on','warn'); $('#timerNum').textContent=''; }
}
export function startTimer(onExpire,secs){
  stopTimer();
  // No explicit secs = local two-player, opted in via the practice setting.
  // With secs (online) the CALLER owns the lifecycle: it runs for either
  // side's turn (phase is 'anim' on the opponent's) and stops via stopTimer.
  if(secs==null && (S.mode!=='duo' || !S.timer || S.phase!=='choose')) return;
  const gen=S.gen, total=(secs??S.timer)*1000, end=performance.now()+total;
  const wrap=$('#timerWrap'), bar=$('#timerBar'), num=$('#timerNum');
  wrap.style.setProperty('--tcbase', colorOf(S.turn));   // clock wears the mover's colour
  wrap.classList.add('on');
  bar.style.width='100%';
  let warned=false;
  timerId=setInterval(()=>{
    if(S.gen!==gen || (secs==null && S.phase!=='choose')){ stopTimer(); return; }
    const left=Math.max(0,end-performance.now());
    bar.style.width=(left/total*100)+'%';
    const secsLeft=Math.ceil(left/1000);       // display only — `secs` is the param
    num.textContent = secsLeft<=5 ? secsLeft : '';
    if(left<=5000 && !warned){ warned=true; wrap.classList.add('warn'); }
    if(left<=0){ stopTimer(); onExpire(); }
  },100);
}
