// @ts-nocheck -- moved verbatim from the monolith; typed in the milestone-D
// strictness ratchet. New code goes in typed modules, not here.
// The title screen and settings panel: what they show, and how a saved game
// re-enters play.
import { ME } from '../core/rules.ts';
import { S, DIFFS, SEATS, oneOf } from '../state.ts';
import { loadGame } from '../persist.ts';
import { $, show, hide } from '../ui/dom.ts';
import { nameOf } from '../ui/identity.ts';
import { setStageDie } from '../ui/die.ts';
import { applySides, updateRecord, clearHints, showHints, setStatus, setActivePlate } from '../ui/render.ts';
import { stopTimer } from './timer.ts';
import { clearTut } from './tutorial.ts';
import { newGame, nextTurn, armTimer, cancelPass } from './game.ts';
export function resumeGame(){
  const g=loadGame();
  if(!g){ newGame(); return; }
  S.gen++;
  clearTut();
  S.boards=g.boards; S.mode=g.mode; S.turn=g.turn; S.bottom=g.bottom;
  S.seat = oneOf(SEATS, g.seat, S.seat);
  if(S.mode==='duo' && S.seat==='face') S.bottom=ME;   // face mode never swaps halves
  S.diff = oneOf(DIFFS, g.diff, S.diff);
  if(g.starter===0||g.starter===1) S.starter=g.starter;
  S.busy=false;
  clearHints();
  applySides(); updateRecord();
  hide('#ovEnd'); hide('#ovStart'); hide('#ovRules'); hide('#ovPass'); hide('#ovPractice');
  const human = S.mode==='duo' || S.turn===ME;
  if(human && g.die){
    // hand the same die back
    S.die=g.die; S.phase='choose';
    setStageDie(S.die,S.turn);
    setStatus(S.mode==='duo' ? nameOf(S.turn)+' — tap a column' : 'Tap a column', S.turn);
    setActivePlate(); showHints(); armTimer();
  }else{
    S.phase='roll'; setStageDie(0); setActivePlate();
    setStatus('Resuming',S.turn);
    setTimeout(nextTurn,450);
  }
}
function segOn(sel,key,val){
  document.querySelectorAll(sel+' button').forEach(b=>b.classList.toggle('on', b.dataset[key]===val));
}
/* single source of truth for "what the title screen should look like right now" */
export function syncSettingsUI(){
  const duo = S.mode==='duo';
  $('#diffCard').hidden  = duo;
  $('#seatCard').hidden  = !duo;
  $('#timerCard').hidden = !duo;
  $('#duoNote').hidden   = !duo;
  $('#duoNote').textContent = S.seat==='face'
    ? 'Phone flat between you — the top half faces Player 2'
    : 'One phone, passed back and forth';
  segOn('#modeSeg','m',S.mode);
  segOn('#diffSeg','d',S.diff);
  segOn('#timerSeg','t',String(S.timer));
  segOn('#seatSeg','seat',S.seat);
  segOn('#sndSeg','s', S.sound?'1':'0');
  segOn('#faceSeg','f', S.numerals?'nums':'pips');
  document.documentElement.classList.toggle('numerals',S.numerals);
  updateResumeButton();               // owns which title button reads as primary
}
/* leaving a game in progress: the save survives, so Resume is still offered */
export function toMenu(){
  S.gen++; S.phase='over';
  stopTimer(); clearTut(); clearHints();
  cancelPass(); hide('#ovPass');
  hide('#ovPractice');
  updateResumeButton(); show('#ovStart');
}
export function updateResumeButton(){
  const g=loadGame();
  const r=$('#btnResume'), p=$('#btnPlay'), t=$('#btnTut');
  r.hidden=!g;
  if(g){
    const placed=g.boards[0].flat().length + g.boards[1].flat().length;
    r.textContent='Resume · '+placed+(placed===1?' die':' dice')+' down';
    p.textContent='New game';
  }else p.textContent='Play';
  // exactly one obvious action: resume beats the first-launch tutorial beats play
  const fresh = !S.tutDone && (S.wins+S.losses+S.draws+S.p1+S.p2)===0;
  r.classList.toggle('primary', !!g);
  t.classList.toggle('primary', !g && fresh);
  p.classList.toggle('primary', !g && !fresh);
}
export function updateStatLine(){
  const el=$('#statLine');
  const played=S.wins+S.losses+S.draws;
  if(!played && !S.best){ el.hidden=true; return; }
  el.hidden=false;
  el.innerHTML = 'Best <b>'+S.best+'</b>' + (played? '  ·  Record '+S.wins+'–'+S.losses+(S.draws?('–'+S.draws):'') : '');
}
