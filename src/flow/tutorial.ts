// @ts-nocheck -- moved verbatim from the monolith; typed in the milestone-D
// strictness ratchet. New code goes in typed modules, not here.
// The guided first game: scripted rolls, scripted CPU, one lesson per
// player turn. Deterministic, so the whole flow is testable.
import { ME } from '../core/rules.ts';
import { S } from '../state.ts';
import { $ } from '../ui/dom.ts';
import { Sfx } from '../ui/audio.ts';
/* ===================== TUTORIAL =====================
   A guided first game. Rolls and CPU moves are scripted so every lesson is
   guaranteed to happen: the player always draws a second 4 for the multiplier
   lesson, and the CPU always has a 5 in its middle column for the destruction
   lesson — wherever the player put their earlier dice. Deterministic, so the
   whole flow is testable. */
let coachResolve=null;
export function coachShow(msg,needTap){
  $('#coachMsg').textContent=msg;
  $('#coachHint').hidden=!needTap;
  $('#coach').hidden=false;
  return new Promise(res=>{ if(needTap) coachResolve=res; else res(); });
}
export function coachHide(){ $('#coach').hidden=true; coachResolve=null; }
export function clearTut(){
  S.tut=null;
  document.documentElement.classList.remove('tut');
  coachHide();
}
/* next scripted roll for whoever is rolling. After the script, free play
   keeps a thumb on the scale: the student re-rolls low dice once, the
   sparring partner re-rolls high ones — a guided first game should be WON
   (98.6% over 500 simulated games, vs 86% with fair dice). */
export function tutNextRoll(){
  const q = S.turn===ME ? S.tut.prolls : S.tut.crolls;
  if(q.length) return q.shift();
  let d = 1+((Math.random()*6)|0);
  if(S.turn===ME ? d<=2 : d>=5) d = 1+((Math.random()*6)|0);
  return d;
}
/* one lesson per player turn, keyed by turn number (board counts shift when
   dice get destroyed, so placements are the wrong key) */
export function tutOnChoose(){
  const t=S.tut; t.turnNo++; t.restrict=null;
  if(t.turnNo===0){
    coachShow('You rolled a 4. The +pills preview what each column would score — tap any column to drop it in.');
  }else if(t.turnNo===1){
    t.restrict=t.firstCol;
    coachShow('Another 4! Matching dice in one column multiply: two 4s score 16, not 8. Stack it on your first 4.');
  }else if(t.turnNo===2){
    t.restrict=1;
    coachShow('You rolled a 5 — and the AI has a 5 in their middle column. Place yours in YOUR middle column to destroy theirs!');
  }else if(t.turnNo===3){
    coachShow('Boom. That is the whole game: stack matches, smash theirs. Finish the round — highest total wins.');
  }else{
    coachHide();
  }
}
/* the coach banner's tap target -- consumes the pending continue-resolver */
export function coachTap(){
  if(coachResolve){ const f=coachResolve; coachResolve=null; coachHide(); Sfx.tap(); f(); }
}
