// @ts-nocheck -- moved verbatim from the monolith; typed in the milestone-D
// strictness ratchet. New code goes in typed modules, not here.
// The turn-flow state machine: roll, choose, place, destroy, hand-off,
// game lifecycle, and the AI policy that picks the CPU's column. One deep
// module on purpose -- these steps are one process, and S.gen guards every
// await against a game that was abandoned mid-animation.
import { AI, ME, SPEC, legalCols, colScore, boardTotalMode, totalOf, victimsOf, isShielded, isOver,
         openStrikes, emptyBoard, BOUNTY, LIMITED } from '../core/rules.ts';
import { makeBag } from '../core/dice.ts';
import { RANDOM, pickMode } from '../core/modes.ts';
import { RANDOM_SPELL, spellById } from '../core/spells.ts';
import { reveal } from '../ui/reveal.ts';
import { isNewcomer, offerTutorial } from '../ui/firstrun.ts';
import { searchRoot, getRiskW, setRiskW } from '../core/ai.ts';
import { S } from '../state.ts';
import { saveStats } from '../persist.ts';
import { Sfx, vibrate } from '../ui/audio.ts';
import { $, show, hide, sideKey, slotEl, slotIdx, colEl, faceRotated } from '../ui/dom.ts';
import { showBag, renderBag } from '../ui/bag.ts';
import { nameOf, colorOf, heatOf } from '../ui/identity.ts';
import { makeDie, setStageDie } from '../ui/die.ts';
import { REDUCED, burst, floatPts, shake, flash, pin, fxRoot } from '../ui/fx.ts';
import { renderSide, renderAll, applySides, updateRecord, clearHints, showHints, setStatus, setActivePlate, settleBoard, shieldBlocked, wardBurned } from '../ui/render.ts';
import { fit } from '../ui/layout.ts';
import { startTimer, stopTimer, showClock } from './timer.ts';
import { coachShow, coachHide, clearTut, tutNextRoll, tutOnChoose } from './tutorial.ts';
import { toMenu } from './menu.ts';
import { showEnd, closeEnd } from '../ui/endscreen.ts';
import { resetSpells, drawSpell, renderSpells, aiSpellTurn, clearUndo } from './spells.ts';

/* arm the turn clock: on expiry the die drops into a random legal column */
export function armTimer(){ const gen=S.gen; startTimer(()=>autoPlace(gen)); }
function wait(ms){ return new Promise(r=>setTimeout(r,ms)); }
/* the one true local score — the SAME helper the server settles matches with */
function localTotal(p){ return totalOf(S.boards[p],S.bounty[p],S.scoring); }
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
    // free play: the coach's sparring partner throws the match — it picks the
    // column that helps itself LEAST (no multipliers, no destruction), so a
    // guided first game all but always ends in a win
    let worst=legal[0], worstV=1e9;
    for(const c of legal){
      const gain=colScore(st[AI][c].concat([S.die]))-colScore(st[AI][c]);
      const kill=colScore(st[ME][c])-colScore(st[ME][c].filter(v=>v!==S.die));
      const v=gain+kill;
      if(v<worstV){ worstV=v; worst=c; }
    }
    return worst;
  }
  const filled = st[AI].flat().length + st[ME].flat().length;
  const w0=getRiskW();
  let c;
  if(S.diff==='easy'){
    if(Math.random()<0.5) return legal[(Math.random()*legal.length)|0];
    setRiskW(0);                                  // easy is blind to danger
    c=searchRoot(st,AI,S.die,1,S.scoring).c;
  }else if(S.diff==='medium'){
    setRiskW(0.9);                                // 59.9% vs greedy over 400 games
    c=searchRoot(st,AI,S.die,2,S.scoring).c;
  }else{
    setRiskW(1.5);
    /* Time-boxed deepening: always search 4 plies, and only go to 5 if this
       device did 4 fast enough that 5 (~10-18x the nodes) stays responsive.
       Keeps a slow phone at ~30ms/move instead of ~850ms. */
    const t0=performance.now();
    c=searchRoot(st,AI,S.die,4,S.scoring).c;
    if(performance.now()-t0 < 18 && filled < SPEC.cols*SPEC.rows*2-2) c=searchRoot(st,AI,S.die,5,S.scoring).c;
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
    $('#passP1').textContent=localTotal(ME);
    $('#passP2').textContent=localTotal(AI);
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
  setStatus(S.turn===ME?'Your roll':'AI roll',S.turn);
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
  S.die = (S.tut && tutNextRoll()) || (S.pool ? S.pool.shift() : 0) || 1+((Math.random()*6)|0);
  if(S.pool) renderBag(S.pool.length);
  setStageDie(S.die,S.turn);
  stage.classList.add('pop');
  setTimeout(()=>stage.classList.remove('pop'),320);
  vibrate(8);
}

/* What the status line says while a player is choosing a column. Two callers:
   the turn machine, and a spell handing the turn back after a cast. The rune
   rail wakes up here too — a choice starting is exactly when it becomes live,
   and in two-player it changes hands with the turn. */
export function sayChoose(){
  setStatus(S.mode==='duo' ? nameOf(S.turn)+' — tap a column' : 'Tap a column', S.turn);
  renderSpells();
}
export async function nextTurn(){
  const gen=S.gen;
  if(S.phase==='over') return;
  renderAll(false);   // same repaint belt online uses: state wins every turn
  renderSpells();     // ...and the rail belongs to the turn: the seat that just
                      // lost it dims here. sayChoose() repaints it again when a
                      // HUMAN gets the choice; on the machine's turn nothing
                      // else would, and the rune stayed lit through it.
  if(S.mode==='duo' && S.seat==='pass' && S.turn!==S.bottom){
    const ok=await handOff(S.turn);           // face mode switches turns directly
    if(!ok || S.gen!==gen || S.phase==='over') return;
  }
  await rollDice();
  if(S.phase==='over' || S.gen!==gen) return;
  if(S.mode==='duo' || S.turn===ME){
    S.phase='choose';
    if(S.tut) tutOnChoose();     // sets the lesson message and any column restriction
    sayChoose();
    showHints();
    armTimer();
  }else{
    S.phase='anim';
    setStatus('AI thinking',AI);
    await wait(300);
    if(S.gen!==gen) return;
    // it holds the same rune you do — it spends it at the same point in the
    // turn, before choosing a column, and aiChoose then reads the new board
    if(await aiSpellTurn(AI)) return;             // the swap ended the game
    if(S.gen!==gen) return;
    const c=aiChoose();
    await wait(140);
    if(S.gen!==gen) return;
    await place(AI,c);
  }
}

export async function flyDie(who,col,die){
  // the choosing is over the moment the die lifts off: whatever the status
  // line was saying ("Tap a column", "AI thinking") goes dark INSTANTLY —
  // the next turn writes its own line. Serves online too (one driver rule).
  setStatus('',null);
  const stage=$('#dieStage');
  const src=stage.firstElementChild;
  if(!src) return;
  const from=src.getBoundingClientRect();
  const idx=S.boards[who][col].length;
  const target=slotEl(who,col,slotIdx(who,idx));
  const to=target.getBoundingClientRect();
  const ghost=makeDie(die,who);
  if(faceRotated(who)) ghost.classList.add('p2flip');
  pin(ghost,from);                       // same lift the spell swap uses (ui/fx)
  fxRoot().appendChild(ghost);
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
  // core decides WHO falls (shield, single strike, classic) — the animation
  // only performs it, so screen and state can never tell different stories
  const victims=victimsOf(b[col],die,S.scoring);
  if(!victims.length) return 0;
  const color = colorOf(who);
  for(const i of victims){
    const slot=slotEl(who,col,slotIdx(who,i));
    const d=slot && slot.firstElementChild;
    if(d){
      d.classList.add('dying');
      const r=d.getBoundingClientRect();
      burst(r.left+r.width/2, r.top+r.height/2, color, 18);
    }
  }
  const survivors=b[col].filter((v,i)=>!victims.includes(i));
  // what the victim actually loses under the ACTIVE mode — rows score in
  // ROW SWITCH, rows pay a bonus in ROW MULTIPLY, so a column-only delta
  // would lie there. Whole-board diff against a hypothetical survivor board;
  // in classic it is exactly the old column delta.
  const lost = boardTotalMode(b,S.scoring)
             - boardTotalMode(b.map((c,i)=>i===col?survivors:c),S.scoring);
  floatPts(who,col,'−'+lost,heatOf(who));
  Sfx.kill(); vibrate([16,30,26]); shake(7); flash(0.22);
  await wait(320);
  S.boards[who][col]=survivors;
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
  clearUndo();                    // the die is committed: a cast on it is final now
  renderSpells();                 // the turn is spending itself: the rail goes quiet
  const die=S.die;
  // mode-aware, exactly like online play: what the whole board gains, not what
  // the column gains (columns don't score in ROW SWITCH). Classic is unchanged.
  const preScore=boardTotalMode(S.boards[who],S.scoring);
  await flyDie(who,col,die);
  if(S.gen!==gen) return;
  S.boards[who][col].push(die);
  if(S.tut && who===ME){
    if(S.tut.firstCol==null) S.tut.firstCol=col;   // the multiplier lesson stacks here
    coachHide();                                    // instruction fulfilled
  }
  Sfx.place(); vibrate(12);
  setStageDie(0);
  renderSide(who,true);
  const gain=boardTotalMode(S.boards[who],S.scoring)-preScore;
  // beating the die's own face value means SOMETHING multiplied — the same
  // test online uses, and the only one that holds in every mode
  const mult = gain>die;
  floatPts(who,col,'+'+gain, mult?heatOf(who):colorOf(who));
  if(mult){ Sfx.mult(); const r=colEl(who,col).getBoundingClientRect();
           burst(r.left+r.width/2,r.top+r.height/2,heatOf(who),10); }
  await wait(120);
  if(S.gen!==gen) return;
  // core decides WHICH columns this placement strikes — the facing one, or
  // every matching column under a SUNDER — and whether a ward answers each.
  // The very openStrikes applyMove resolves headlessly, and it consumes the
  // sunder mark, so screen and state can never tell different stories.
  const plan=openStrikes(S.boards,who,col,die,S.scoring,S.charm);
  const stage=$('#dieStage'); if(stage) stage.classList.remove('sundered');  // the charged die has flown
  // COLUMN SHIELD: a full facing column is immune — flash the shield instead,
  // but only when the die would actually have hit something
  if(isShielded(S.boards[1-who][col],S.scoring) && S.boards[1-who][col].includes(die)){
    shieldBlocked(1-who,col);
  }
  let destroyed=0;
  for(const hit of plan){
    if(S.gen!==gen) return;
    if(hit.warded){
      // the ward absorbs the whole strike and burns out: the chip's mark flares
      // and the seal's clasp snaps on the SAME beat, then the repaint clears
      // both — the mark is gone from the charm it reads
      S.charm.wards[1-who][hit.col]--;
      wardBurned(1-who,hit.col);
      Sfx.mult(); flash(0.14);
      await wait(300);
      renderSide(1-who,true);
    }else{
      destroyed+=await destroyAt(1-who,hit.col,die);
    }
  }
  if(S.scoring===BOUNTY && destroyed){
    // the kill pays: bank the permanent +1s, celebrate them in gold
    S.bounty[who]+=destroyed;
    floatPts(who,col,'+'+destroyed+' ✦',heatOf(who));
    renderSide(who,true);
  }
  await wait(60);
  if(S.gen!==gen) return;
  // LIMITED: the just-placed die may have been the bag's last — that ends it
  if(isOver(S.boards[who], S.pool ? S.pool.length : null)){ return endGame(); }
  S.turn = 1-who;
  S.busy=false;
  S.die=0;
  nextTurn();
}
/* ===================== GAME LIFECYCLE ===================== */
/* THE way a local game starts, and the only place RANDOM is resolved.
   There are three ways to ask for a game — the OFFLINE sheet's Play, the
   keyboard, and Next duel on the result screen — and the first version of this
   taught only the Play button about RANDOM, so the rematch button quietly dealt
   classic for the rest of the session. One door, no exceptions.
   BOTH of the sheet's RANDOMs are resolved here, before anything is dealt, and
   handed to newGame as answers. Drawing them inside newGame instead would look
   identical on screen and be a different game every time. */
export async function startLocal(){
  /* A newcomer is offered the tutorial before their first real game — once,
     ever, and never in front of the tutorial itself. */
  if(isNewcomer() && await offerTutorial()){ newGame({tutorial:true}); return; }
  const mode = S.localMode===RANDOM ? pickMode(Math.random().toString(36).slice(2)) : null;
  const spell = S.spell===RANDOM_SPELL ? drawSpell() : null;
  /* Whatever the player left to chance gets ONE screen and one countdown —
     the dial for the mode, the deck for the rune, in that order (ui/reveal). */
  if(mode || spell){
    hide('#ovEnd'); hide('#ovStart'); hide('#ovPractice');
    await reveal({ mode, spell: spellById(spell) });
  }
  newGame({ scoring: mode ? mode.mode : undefined, spell: spell ?? undefined });
}

export function newGame(opts){
  const tutorial = !!(opts && opts.tutorial);
  S.gen++;
  // the OFFLINE view's selector picks the mode; the tutorial teaches classic.
  // opts.scoring is how RANDOM arrives — already rolled and shown on the dial,
  // so newGame is handed the answer rather than rolling a second one. opts.spell
  // is the same bargain for the rune the deck turned over.
  S.scoring = tutorial ? 0 : (opts && opts.scoring != null ? opts.scoring|0 : (S.localMode|0));
  S.bounty=[0,0];
  // LIMITED offline: the same bag the ranked game deals, shuffled locally
  // (no replay validator to agree with, so plain Math.random is right here)
  S.pool = S.scoring===LIMITED ? makeBag() : null;
  showBag(!!S.pool);
  if(S.pool) renderBag(S.pool.length);
  stopTimer();
  if(tutorial){
    S.mode='cpu';
    S.starter=ME;                            // the lessons assume you move first
    S.tut={ turnNo:-1, prolls:[4,4,5], crolls:[2,5], cmoves:[2,1],
            firstCol:null, restrict:null };
  }else{
    clearTut();
  }
  document.documentElement.classList.toggle('tut', !!S.tut);
  S.boards=[emptyBoard(),emptyBoard()];
  S.die=0; S.phase='roll'; S.busy=false;
  S.turn=S.starter;
  resetSpells(opts && opts.spell);           // deal this game's charges (none in a lesson)
  S.starter = 1-S.starter;
  // pass mode: whoever starts holds the phone. face mode: halves never move.
  S.bottom = (S.mode==='duo' && S.seat==='pass') ? S.turn : ME;
  clearHints();
  setStageDie(0);
  showClock();                               // reserve the clock lane only if this game has one
  fit();                                     // the tutorial's pill lane changes cell size
  applySides();
  updateRecord();
  hide('#ovEnd'); hide('#ovStart'); hide('#ovRules'); hide('#ovPass'); hide('#ovPractice');
  hide('#ovLearn');   // the hub the tutorial is started FROM, or it stays over the board
  setStatus(S.mode==='duo' ? nameOf(S.turn)+' starts'
                           : (S.turn===ME?'You go first':'AI goes first'), S.turn);
  setActivePlate();
  if(tutorial){
    const gen=S.gen;
    coachShow('Welcome to Knucklebones! Your grid is the BOTTOM one. Fill it with dice before the AI fills theirs — highest total wins.', true)
      .then(()=>{ if(S.gen===gen) nextTurn(); });
  }else{
    setTimeout(nextTurn,650);
  }
}
/* Exported because a spell can end the game too: a swap can fill either grid,
   and "either grid full ends it" is the rule, not "the mover's grid". */
export function endGame(){
  stopTimer();
  const tut=!!S.tut;
  if(tut){ S.tutDone=true; clearTut(); }     // graduate
  settleBoard();
  renderSpells();                            // nothing is castable after the last die
  const me=localTotal(ME), ai=localTotal(AI);
  const duo = S.mode==='duo';
  const drawn = me===ai, p1won = me>ai;      // cyan won; in CPU mode that means you
  if(drawn && !tut) duo ? S.ties++ : S.draws++;
  if(!drawn && !tut){ if(duo) p1won ? S.p1++ : S.p2++; else p1won ? S.wins++ : S.losses++; }
  if(!tut) S.played=true;                    // the hub stops nagging after this
  // in two-player somebody always won, so it is always a celebration
  if(drawn){ /* no fanfare for a dead heat */ }
  else if(duo || p1won){ Sfx.win(); }
  else { Sfx.lose(); vibrate(220); }
  updateRecord();
  /* Still recorded, deliberately unshown: the Best/Record line above the Play
     button was removed 2026-08-22 (user call — the offline screen is a setup
     screen, not a trophy case), and the session record now lives on the result
     screen alone. The high score keeps accumulating rather than being deleted,
     because a player's history cannot be got back once it stops being written. */
  if(!tut){                                     // a scripted round earns no records
    const best = duo ? Math.max(me,ai) : me;    // duo: best score by either player
    if(best>S.best) S.best=best;
  }
  saveStats();
  setStatus('',null);   // the result screen announces the winner — the table says nothing twice (user call)
  // ONE result screen, filled from here — the fireworks and the title's landing
  // belong to it, so a ranked win gets exactly the same show (ui/endscreen)
  showEnd({
    outcome: drawn ? 'draw' : (duo || p1won) ? 'win' : 'lose',
    title: drawn ? 'DEAD HEAT'
      : duo ? (p1won?'PLAYER 1 WINS':'PLAYER 2 WINS') : (p1won?'VICTORY':'DEFEAT'),
    sub: drawn ? 'Nobody blinks'
      : tut ? (p1won ? 'Tutorial complete — the bones obey you'
                     : 'Tutorial complete — now beat the real thing')
      /* the seat, never the hue: Settings can trade or repaint the pair,
         and a line that names a colour would then name the wrong player */
      : duo ? (p1won?'Player 1 takes the round':'Player 2 takes the round')
            : (p1won?'You out-rolled the machine':'The AI takes this one'),
    you:  { score: me, label: duo?'Player 1':'You' },
    them: { score: ai, label: duo?'Player 2':'AI' },
    meta: tut ? 'TUTORIAL COMPLETE'
      : duo ? 'SESSION  P1 '+S.p1+' – '+S.p2+' P2'+(S.ties?('  ·  '+S.ties+' drawn'):'')
            : 'SESSION  '+S.wins+'–'+S.losses+(S.draws?('–'+S.draws+' D'):''),
    /* The tutorial ends in a graduation, not a rematch — one button, and none
       of the "change difficulty" furniture that assumes you chose anything. */
    again: tut ? { label: 'Finish', run: () => { closeEnd(); toMenu(); } }
               : { label: 'Next duel', run: () => { void startLocal(); } },
    /* ONE quiet way on (user call): back to the setup screen this game came
       from. It replaced a pair — "Change difficulty" and "Home" — that gave a
       two-choice screen three buttons, and the two were barely distinct: the
       setup screen IS the way home (its ‹ goes there), so the second was a
       shortcut past a screen you may well want anyway. One label for both
       seatings, too: what waits there is the whole setup, not one segment. */
    quiet: tut ? undefined
               : { label: 'Change setup', run: () => { closeEnd(); show('#ovPractice'); } },
    delay: 900,                              // the board holds the last move first
  });
}
