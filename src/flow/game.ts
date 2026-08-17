// @ts-nocheck -- moved verbatim from the monolith; typed in the milestone-D
// strictness ratchet. New code goes in typed modules, not here.
// The turn-flow state machine: roll, choose, place, destroy, hand-off,
// game lifecycle, and the AI policy that picks the CPU's column. One deep
// module on purpose -- these steps are one process, and S.gen guards every
// await against a game that was abandoned mid-animation.
import { AI, ME, SPEC, legalCols, colScore, boardTotal, counts, isFull, emptyBoard } from '../core/rules.ts';
import { searchRoot, getRiskW, setRiskW } from '../core/ai.ts';
import { S } from '../state.ts';
import { saveGame, clearGame, saveStats } from '../persist.ts';
import { Sfx, vibrate } from '../ui/audio.ts';
import { isEmbed, kbroot, rootRect } from '../ui/embed.ts';
import { $, show, hide, sideKey, slotEl, slotIdx, colEl, faceRotated } from '../ui/dom.ts';
import { nameOf, colorOf } from '../ui/identity.ts';
import { makeDie, setStageDie } from '../ui/die.ts';
import { REDUCED, burst, floatPts, shake, flash } from '../ui/fx.ts';
import { renderSide, renderAll, applySides, updateRecord, clearHints, showHints, setStatus, setActivePlate } from '../ui/render.ts';
import { fit } from '../ui/layout.ts';
import { startTimer, stopTimer } from './timer.ts';
import { coachShow, coachHide, clearTut, tutNextRoll, tutOnChoose } from './tutorial.ts';
import { updateStatLine } from './menu.ts';

/* arm the turn clock: on expiry the die drops into a random legal column */
export function armTimer(){ const gen=S.gen; startTimer(()=>autoPlace(gen)); }
function wait(ms){ return new Promise(r=>setTimeout(r,ms)); }
/* ===================== AI POLICY =====================
   Scoring + search live in core/ (pure, shared with the server-side replay
   validator). This is the glue that turns difficulty + tutorial state into a
   column choice. */
export function aiChoose(){
  const st=[ S.boards[AI].map(c=>c.slice()), S.boards[ME].map(c=>c.slice()) ];
  const legal=legalCols(st[AI]);
  if(legal.length===1) return legal[0];
  if(S.tut){
    if(S.tut.cmoves.length) return S.tut.cmoves.shift();   // lesson setup
    const w1=getRiskW(); setRiskW(0);                       // then a beatable greedy
    const c1=searchRoot(st,AI,S.die,1).c; setRiskW(w1); return c1;
  }
  const filled = st[AI].flat().length + st[ME].flat().length;
  const w0=getRiskW();
  let c;
  if(S.diff==='easy'){
    if(Math.random()<0.5) return legal[(Math.random()*legal.length)|0];
    setRiskW(0);                                  // easy is blind to danger
    c=searchRoot(st,AI,S.die,1).c;
  }else if(S.diff==='medium'){
    setRiskW(0.9);                                // 59.9% vs greedy over 400 games
    c=searchRoot(st,AI,S.die,2).c;
  }else{
    setRiskW(1.5);
    /* Time-boxed deepening: always search 4 plies, and only go to 5 if this
       device did 4 fast enough that 5 (~10-18x the nodes) stays responsive.
       Keeps a slow phone at ~30ms/move instead of ~850ms. */
    const t0=performance.now();
    c=searchRoot(st,AI,S.die,4).c;
    if(performance.now()-t0 < 18 && filled < SPEC.cols*SPEC.rows*2-2) c=searchRoot(st,AI,S.die,5).c;
  }
  setRiskW(w0);
  return c;
}
function autoPlace(gen){
  if(S.gen!==gen || S.phase!=='choose' || S.busy) return;
  const who=S.turn;
  const legal=legalCols(S.boards[who]);
  if(!legal.length) return;
  const c=legal[(Math.random()*legal.length)|0];
  setStatus('Out of time — column '+(c+1),who);
  vibrate([30,40,30]);
  place(who,c);
}
/* ---- pass the phone ---- */
let passResolve=null;
function handOff(who){
  return new Promise(res=>{
    const gen=S.gen;
    S.phase='pass';
    stopTimer();
    clearHints();
    setStageDie(0);
    setStatus('Pass the phone',who);
    const ov=$('#ovPass');
    ov.style.setProperty('--pc',colorOf(who));
    const w=$('#passWho');
    w.textContent=nameOf(who);
    w.style.color=colorOf(who);
    $('#passP1').textContent=boardTotal(S.boards[ME]);
    $('#passP2').textContent=boardTotal(S.boards[AI]);
    show('#ovPass');
    Sfx.pass();
    const go=()=>{
      hide('#ovPass');
      if(S.gen!==gen) return res(false);
      S.bottom=who;
      applySides();
      const t=$('#tableEl');
      t.classList.remove('swap'); void t.offsetWidth; t.classList.add('swap');
      setTimeout(()=>t.classList.remove('swap'),480);
      Sfx.tap(); vibrate(10);
      res(true);
    };
    passResolve=go;      // consumed by the single listener bound in boot()
  });
}
/* the hand-off card's tap target (ignores taps on the quit button) */
export function passTap(e){
  if(e && e.target && e.target.closest && e.target.closest('#passQuit')) return;
  if(passResolve){ const f=passResolve; passResolve=null; f(); }
}
/* abandoning mid-hand-off (quit to menu): drop the pending resolver */
export function cancelPass(){ passResolve=null; }
async function rollDice(){
  const gen=S.gen;
  S.phase='roll';
  setActivePlate();
  const stage=$('#dieStage');
  stage.classList.add('rolling');
  setStatus(S.turn===ME?'Your roll':'CPU roll',S.turn);
  Sfx.roll();
  const t0=performance.now();
  while(performance.now()-t0 < 430){
    if(S.gen!==gen){ stage.classList.remove('rolling'); return; }
    setStageDie(1+((Math.random()*6)|0), S.turn);
    Sfx.tick();
    await wait(60);
  }
  stage.classList.remove('rolling');
  if(S.gen!==gen) return;
  S.die = (S.tut && tutNextRoll()) || 1+((Math.random()*6)|0);
  setStageDie(S.die,S.turn);
  stage.classList.add('pop');
  setTimeout(()=>stage.classList.remove('pop'),320);
  vibrate(8);
}

export async function nextTurn(){
  const gen=S.gen;
  if(S.phase==='over') return;
  if(S.mode==='duo' && S.seat==='pass' && S.turn!==S.bottom){
    const ok=await handOff(S.turn);           // face mode switches turns directly
    if(!ok || S.gen!==gen || S.phase==='over') return;
  }
  await rollDice();
  if(S.phase==='over' || S.gen!==gen) return;
  if(S.mode==='duo' || S.turn===ME){
    S.phase='choose';
    if(S.tut) tutOnChoose();     // sets the lesson message and any column restriction
    setStatus(S.mode==='duo' ? nameOf(S.turn)+' — tap a column' : 'Tap a column', S.turn);
    showHints();
    saveGame();                  // the roll is now committed: no quitting to reroll
    armTimer();
  }else{
    S.phase='anim';
    setStatus('CPU thinking',AI,true);
    await wait(300);
    if(S.gen!==gen) return;
    const c=aiChoose();
    await wait(140);
    if(S.gen!==gen) return;
    await place(AI,c);
  }
}

export async function flyDie(who,col,die){
  const stage=$('#dieStage');
  const src=stage.firstElementChild;
  if(!src) return;
  const from=src.getBoundingClientRect();
  const idx=S.boards[who][col].length;
  const target=slotEl(who,col,slotIdx(who,idx));
  const to=target.getBoundingClientRect();
  const ghost=makeDie(die,who);
  if(faceRotated(who)) ghost.classList.add('p2flip');
  ghost.style.position=isEmbed()?'absolute':'fixed';
  const gx=isEmbed()?rootRect():{left:0,top:0};
  ghost.style.left=(from.left-gx.left)+'px';
  ghost.style.top=(from.top-gx.top)+'px';
  ghost.style.width=from.width+'px';
  ghost.style.height=from.height+'px';
  ghost.style.setProperty('--cell',from.width+'px');
  ghost.style.zIndex='60';
  (isEmbed()?kbroot():document.body).appendChild(ghost);
  src.style.opacity='0';
  const dx=(to.left+to.width/2)-(from.left+from.width/2);
  const dy=(to.top+to.height/2)-(from.top+from.height/2);
  const sc=to.width/from.width;
  const anim=ghost.animate([
    {transform:'translate(0,0) scale(1) rotate(0deg)'},
    {transform:'translate('+(dx*0.5)+'px,'+(dy*0.5-18)+'px) scale('+((1+sc)/2*1.06)+') rotate('+(who===ME?-10:10)+'deg)',offset:.55},
    {transform:'translate('+dx+'px,'+dy+'px) scale('+sc+') rotate(0deg)'}
  ],{duration:300,easing:'cubic-bezier(.3,.7,.2,1)'});
  await anim.finished.catch(()=>{});
  ghost.remove();
}

export async function destroyAt(who,col,die){
  // who = owner of the dice being destroyed
  const b=S.boards[who];
  const victims=[];
  for(let i=0;i<b[col].length;i++) if(b[col][i]===die) victims.push(i);
  if(!victims.length) return 0;
  const color = who===ME ? '#28e8ff' : '#ff2fa0';
  for(const i of victims){
    const slot=slotEl(who,col,slotIdx(who,i));
    const d=slot && slot.firstElementChild;
    if(d){
      d.classList.add('dying');
      const r=d.getBoundingClientRect();
      burst(r.left+r.width/2, r.top+r.height/2, color, 18);
    }
  }
  const lost = colScore(b[col]) - colScore(b[col].filter(v=>v!==die));
  floatPts(who,col,'−'+lost,'var(--gold)');
  Sfx.kill(); vibrate([16,30,26]); shake(7); flash(0.22);
  await wait(320);
  S.boards[who][col]=b[col].filter(v=>v!==die);
  renderSide(who,true);
  return victims.length;
}

export async function place(who,col){
  if(S.phase==='over') return;
  const gen=S.gen;
  S.busy=true;
  S.phase='anim';
  stopTimer();
  clearHints();
  const die=S.die;
  const preScore=colScore(S.boards[who][col]);
  await flyDie(who,col,die);
  if(S.gen!==gen) return;
  S.boards[who][col].push(die);
  if(S.tut && who===ME){
    if(S.tut.firstCol==null) S.tut.firstCol=col;   // the multiplier lesson stacks here
    coachHide();                                    // instruction fulfilled
  }
  const k=counts(S.boards[who][col])[die];
  Sfx.place(); vibrate(12);
  setStageDie(0);
  renderSide(who,true);
  const gain=colScore(S.boards[who][col])-preScore;
  floatPts(who,col,'+'+gain, k>1?'var(--gold)':colorOf(who));   // gold = multiplied
  if(k>1){ Sfx.mult(); const r=colEl(who,col).getBoundingClientRect();
           burst(r.left+r.width/2,r.top+r.height/2,'#ffd166',10); }
  await wait(120);
  if(S.gen!==gen) return;
  await destroyAt(1-who,col,die);
  await wait(60);
  if(S.gen!==gen) return;
  if(isFull(S.boards[who])){ return endGame(); }
  S.turn = 1-who;
  S.busy=false;
  S.die=0; saveGame();
  nextTurn();
}
/* ===================== GAME LIFECYCLE ===================== */
export function newGame(opts){
  const tutorial = !!(opts && opts.tutorial);
  S.gen++;
  S.scoring=0;   // local play is always classic (an online teardown may lag by a watchdog tick)
  stopTimer();
  if(tutorial){
    // a real saved game (if any) is deliberately left alone — see saveGame
    S.mode='cpu';
    S.starter=ME;                            // the lessons assume you move first
    S.tut={ turnNo:-1, prolls:[4,4,5], crolls:[2,5], cmoves:[2,1],
            firstCol:null, restrict:null };
  }else{
    clearTut();
    clearGame();
  }
  document.documentElement.classList.toggle('tut', !!S.tut);
  S.boards=[emptyBoard(),emptyBoard()];
  S.die=0; S.phase='roll'; S.busy=false;
  S.turn=S.starter;
  S.starter = 1-S.starter;
  // pass mode: whoever starts holds the phone. face mode: halves never move.
  S.bottom = (S.mode==='duo' && S.seat==='pass') ? S.turn : ME;
  clearHints();
  setStageDie(0);
  fit();                                     // the tutorial's pill lane changes cell size
  applySides();
  updateRecord();
  hide('#ovEnd'); hide('#ovStart'); hide('#ovRules'); hide('#ovPass'); hide('#ovPractice');
  setStatus(S.mode==='duo' ? nameOf(S.turn)+' starts'
                           : (S.turn===ME?'You go first':'CPU goes first'), S.turn);
  setActivePlate();
  if(tutorial){
    const gen=S.gen;
    coachShow('Welcome to Knucklebones! Your grid is the BOTTOM one. Fill it with dice before the CPU fills theirs — highest total wins.', true)
      .then(()=>{ if(S.gen===gen) nextTurn(); });
  }else{
    setTimeout(nextTurn,650);
  }
}
function endGame(){
  S.phase='over'; S.busy=false;
  stopTimer();
  const tut=!!S.tut;
  if(tut){ S.tutDone=true; clearTut(); }     // graduate; leave any real save intact
  else clearGame();
  setActivePlate();
  clearHints();
  const me=boardTotal(S.boards[ME]), ai=boardTotal(S.boards[AI]);
  const t=$('#endTitle'), sub=$('#endSub');
  const duo = S.mode==='duo';
  if(me===ai){
    if(!tut) duo ? S.ties++ : S.draws++;
    t.textContent='DEAD HEAT'; t.className='draw'; sub.textContent='Nobody blinks';
  }else{
    const p1won = me>ai;                    // cyan won; in CPU mode that means you
    if(!tut){ if(duo) p1won ? S.p1++ : S.p2++; else p1won ? S.wins++ : S.losses++; }
    t.textContent = duo ? (p1won?'PLAYER 1 WINS':'PLAYER 2 WINS')
                        : (p1won?'VICTORY':'DEFEAT');
    t.className   = p1won ? 'win' : 'lose';  // cyan gradient vs magenta, either mode
    sub.textContent = duo ? (p1won?'Cyan takes the round':'Magenta takes the round')
                          : (p1won?'You out-rolled the machine':'The CPU takes this one');
    if(tut) sub.textContent = p1won ? 'Tutorial complete — the bones obey you'
                                    : 'Tutorial complete — now beat the real thing';
    // in two-player somebody always won, so it is always a celebration
    if(duo || p1won){ Sfx.win(); vibrate([20,50,20,50,60]); }
    else { Sfx.lose(); vibrate(220); }
  }
  $('#endYou').textContent=me; $('#endCpu').textContent=ai;
  $('#endYouLbl').textContent = duo?'Player 1':'You';
  $('#endCpuLbl').textContent = duo?'Player 2':'CPU';
  $('#btnMenu2').textContent = duo?'Change mode':'Change difficulty';
  $('#endRec').textContent = tut ? 'TUTORIAL COMPLETE'
    : duo ? 'SESSION  P1 '+S.p1+' – '+S.p2+' P2'+(S.ties?('  ·  '+S.ties+' drawn'):'')
          : 'SESSION  '+S.wins+'–'+S.losses+(S.draws?('–'+S.draws+' D'):'');
  updateRecord();
  if(!tut){                                     // a scripted round earns no records
    const best = duo ? Math.max(me,ai) : me;    // duo: best score by either player
    if(best>S.best) S.best=best;
  }
  saveStats(); updateStatLine();
  setStatus(me>ai?nameOf(ME)+' wins':me<ai?nameOf(AI)+' wins':'Draw', me>ai?ME:me<ai?AI:null);
  if(me!==ai){
    const winner = me>ai?ME:AI;
    if(duo || winner===ME){
      const r=$('#side'+(sideKey(winner)==='bot'?'Bot':'Top')).getBoundingClientRect();
      const pal = winner===ME?['#28e8ff','#ffd166','#8dffcf']:['#ff2fa0','#ffd166','#ff8a3d'];
      for(let i=0;i<5;i++) setTimeout(()=>burst(r.left+Math.random()*r.width, r.top+Math.random()*r.height,
        pal[(Math.random()*3)|0], 14), i*130);
    }
  }
  setTimeout(()=>show('#ovEnd'), 900);
}
