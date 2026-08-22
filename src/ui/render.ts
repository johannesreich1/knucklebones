// @ts-nocheck -- moved verbatim from the monolith; typed in the milestone-D
// strictness ratchet. New code goes in typed modules, not here.
// Painting the table: boards, dice, scores, plates, status line and the
// tutorial-only strategy hints. State in, DOM out -- game logic stays out.
import { AI, ME, SPEC, ROWSWITCH, ROWMULT, BOUNTY, colScore, rowScore, totalOf, isShielded, counts, countOf } from '../core/rules.ts';
import { DICE_FACES } from '../config.ts';
import { S, DIFF_LABEL } from '../state.ts';
import { $, sideKey, slotEl, slotIdx, colEl, chipEl } from './dom.ts';
import { nameOf } from './identity.ts';
import { makeDie } from './die.ts';
import { modeIcon } from './modeicons.ts';
import { spellIcon } from './spellicons.ts';
import { modeByEnum } from '../core/modes.ts';
import { spellById, dealtOf } from '../core/spells.ts';
/* ===================== DOM BUILD ===================== */
export function buildBoards(){
  for(const side of ['top','bot']){
    const b=$('#'+side+'Board'); b.innerHTML='';
    const cs=$('#'+side+'Cols'); cs.innerHTML='';
    for(let c=0;c<SPEC.cols;c++){
      const col=document.createElement('div');
      col.className='col'; col.dataset.col=c;
      col.setAttribute('role','button');
      col.setAttribute('tabindex','-1');
      for(let r=0;r<SPEC.rows;r++){
        const s=document.createElement('div'); s.className='slot'; s.dataset.slot=r;
        s.setAttribute('aria-hidden','true');
        col.appendChild(s);
      }
      b.appendChild(col);
      const chip=document.createElement('div');
      chip.className='chip';
      chip.innerHTML='<span class="cs">0</span><span class="mx"></span><span class="sh"></span><span class="wd"></span><span class="dl"></span>';
      cs.appendChild(chip);
    }
    // per-row score rail, left of the board — visible only in row modes
    const rc=document.createElement('div');
    rc.className='rowchips'; rc.id=side+'Rows'; rc.setAttribute('aria-hidden','true');
    rc.innerHTML='<span class="rc"><span class="cs"></span><span class="mx"></span></span>'.repeat(SPEC.rows);
    b.appendChild(rc);
  }
}
/* ===================== RENDER ===================== */
export function renderSide(who,animate){
  const b=S.boards[who];
  const rowswitch=S.scoring===ROWSWITCH, rowmult=S.scoring===ROWMULT;
  // row modes: tally matches ACROSS the row — rowCounts[r][v]
  let rowCounts=null;
  if(rowswitch||rowmult){
    rowCounts=[];
    for(let r=0;r<SPEC.rows;r++){
      const m={};
      for(let c=0;c<SPEC.cols;c++){ const v=b[c][r]; if(v!==undefined) m[v]=(m[v]||0)+1; }
      rowCounts.push(m);
    }
  }
  for(let c=0;c<SPEC.cols;c++){
    const cm=counts(b[c]);
    for(let i=0;i<SPEC.rows;i++){
      const slot=slotEl(who,c,slotIdx(who,i));
      const v=b[c][i];
      if(v===undefined){ if(slot.firstChild) slot.innerHTML=''; continue; }
      let d=slot.firstElementChild;
      if(!d || +d.dataset.v!==v){
        slot.innerHTML='';
        d=makeDie(v,who);
        slot.appendChild(d);
        if(animate){ d.classList.add('settle'); }
      }
      // A kept element may still wear the death animation: .dying ends at
      // opacity 0 with `forwards`, so a SURVIVOR that compacts into a slot
      // whose old die just died (same face → element reused) would render
      // invisible for the rest of the match. Cost the user a whole mode.
      d.classList.remove('dying');
      // the multiplier glow follows whatever actually multiplies: columns in
      // classic/shield/rowmult, ROWS in rowswitch (columns would lie there)
      const rk=rowCounts ? (rowCounts[i][v]||1) : 1;
      const k=rowswitch ? rk : (cm[v]||1);
      d.classList.toggle('m2',k===2);
      d.classList.toggle('m3',k===3);
      // ROWMULT scores BOTH ways, so a row match needs its own mark on top of
      // the column glow. It is drawn as a SPAN bracketed at its ends (main.css),
      // and the ends are the only thing the stylesheet is told: a match can jump
      // a stranger (cols 1 and 3 matching through col 2), so "my neighbour" is
      // not the same question as "the end of the run" and only this loop can
      // answer it honestly.
      const inRow=rowmult && rk>=2;
      d.classList.toggle('rm2',inRow && rk===2);
      d.classList.toggle('rm3',inRow && rk===3);
      let ahead=false; for(let n=c+1;n<SPEC.cols;n++) if(b[n][i]===v) ahead=true;
      let behind=false; for(let n=0;n<c;n++) if(b[n][i]===v) behind=true;
      d.classList.toggle('rms',inRow && !behind);   // left end of the span
      d.classList.toggle('rme',inRow && !ahead);    // right end
    }
  }
  updateScores(who);
}
function updateScores(who){
  const b=S.boards[who];
  const rowswitch=S.scoring===ROWSWITCH, rowmult=S.scoring===ROWMULT;
  document.documentElement.classList.toggle('rowmode',rowswitch||rowmult);
  document.documentElement.classList.toggle('rowswitch',rowswitch);   // hides the idle column chips
  for(let c=0;c<SPEC.cols;c++){
    const sc=rowswitch ? b[c].reduce((a,v)=>a+v,0) : colScore(b[c]);
    const chip=chipEl(who,c);
    // ROW SWITCH scores SOLELY by rows — the row rail carries the numbers
    chip.querySelector('.cs').textContent=rowswitch ? '' : sc;
    chip.classList.toggle('has',!rowswitch && sc>0);
    const cm=counts(b[c]); let mx='';
    if(!rowswitch) for(const v in cm){ if(cm[v]===3) mx='×3'; else if(cm[v]===2 && mx!=='×3') mx='×2'; }
    const mxb=chip.querySelector('.mx');
    mxb.textContent=mx;
    mxb.classList.toggle('h3',mx==='×3');   // ×3 wears the hot heat, ×2 the gold one
    // COLUMN SHIELD: a full column wears its shield (pops in the first time)
    const sh=chip.querySelector('.sh');
    const shielded=isShielded(b[c],S.scoring);
    if(shielded && !sh.firstChild){ sh.innerHTML=modeIcon('colshield',13); sh.classList.add('pop'); }
    else if(!shielded && sh.firstChild){ sh.innerHTML=''; sh.classList.remove('pop'); }
    colEl(who,c).classList.toggle('shielded',shielded);
    // WARD: a warded column wears its rune until the mark burns (flow/spells).
    // Painted from S.charm — the same state destruction consults, so the chip
    // can never outlive or precede the protection it announces.
    const wd=chip.querySelector('.wd');
    const warded=S.charm.wards[who][c]>0;
    if(warded && !wd.firstChild){ wd.innerHTML=spellIcon('ward',13); wd.classList.add('pop'); }
    else if(!warded && wd.firstChild){ wd.innerHTML=''; wd.classList.remove('pop','block'); }
    colEl(who,c).classList.toggle('warded',warded);
    // and describe it for screen readers, reusing the score we just computed
    const free=SPEC.rows-b[c].length;
    colEl(who,c).setAttribute('aria-label',
      nameOf(who)+' column '+(c+1)+', score '+sc+', '+
      (free? free+' space'+(free>1?'s':'')+' free' : 'full'));
  }
  // the row rail: full row scores in ROW SWITCH, just the bonus in ROW MULTIPLY
  if(rowswitch||rowmult){
    const rail=$('#'+sideKey(who)+'Rows');
    if(rail) for(let r=0;r<SPEC.rows;r++){
      // rows mirror on the top half (dice stack toward the centre line)
      const el=rail.children[sideKey(who)==='bot' ? r : SPEC.rows-1-r];
      let kmax=1, bonus=0;
      for(let v=1;v<=DICE_FACES;v++){
        let k=0; for(let c=0;c<SPEC.cols;c++) if(b[c][r]===v) k++;
        if(k>kmax) kmax=k;
        if(k>=2) bonus+=v*k*k;
      }
      const val=rowswitch ? rowScore(b,r) : bonus;
      // same anatomy as the column chips: plain value + a ×k badge
      el.querySelector('.cs').textContent=rowswitch ? String(val) : (val ? String(val) : '');
      const rmx=el.querySelector('.mx');
      rmx.textContent=kmax>=2 ? '×'+kmax : '';
      rmx.classList.toggle('h3',kmax>=3);
      el.classList.toggle('has',val>0);
    }
  }
  // BOUNTY: banked +1s count toward the total and show as their own gold tally
  const tot=totalOf(b,S.bounty[who],S.scoring);
  const k=sideKey(who)==='bot'?'Bot':'Top';
  const bty=$('#bty'+k);
  if(bty){
    // The lane exists for the whole BOUNTY game, not from the first kill: the
    // score cluster is vertically centred, so a tally appearing mid-match
    // re-centred it and the score and rune jumped ~10px (user report). Same
    // rule as the rune slot — a game that HAS a thing reserves its place.
    const on=S.scoring===BOUNTY, n=on?S.bounty[who]:0;
    bty.hidden=!on;
    bty.style.visibility=n?'':'hidden';
    if(on) bty.textContent='✦'+n;
  }
  const el = $('#tot'+k), plate = $('#plate'+k);
  if(el.textContent!==String(tot)){
    el.textContent=tot;
    plate.classList.add('bump');
    setTimeout(()=>plate.classList.remove('bump'),190);
  }
}
export function renderAll(anim){ renderSide(AI,anim); renderSide(ME,anim); }
/* Point each half of the screen at its current owner and repaint from scratch.
   Called on new game and after every hand-off swap. */
export function applySides(){
  const bot=S.bottom, top=1-S.bottom;
  $('#sideBot').dataset.owner=bot;
  $('#sideTop').dataset.owner=top;
  $('#nameBot').textContent=nameOf(bot);
  $('#nameTop').textContent=nameOf(top);
  const tag=$('#tagTop');
  tag.hidden = !(S.mode==='cpu' && top===AI);
  tag.textContent = S.tut ? 'TUTORIAL' : DIFF_LABEL[S.diff];
  $('#tagBot').hidden=true;
  document.documentElement.classList.toggle('face', S.mode==='duo' && S.seat==='face');
  buildBoards();          // wipe: stops stale dice living on a swapped-away half
  renderAll(false);
  setActivePlate();
}
/* ===================== THE HUD BADGE =====================
   #rec names WHAT IS BEING PLAYED, and every name it carries is the front door
   to that thing's rules. So it is a ROW OF CHIPS, not a label: a chip is a
   caption plus the roster that explains it, which makes a second thing in play
   -- a spell beside the mode -- another entry rather than another branch. Boot
   binds ONE delegated listener and opens whichever roster was tapped, so the
   affordance cannot go missing on one side again.

   It shows no score. The slot used to count wins whenever the mode was classic,
   which is how classic alone never got the tap: S.scoring is 0 for CLASSIC, so
   `if(S.scoring)` fell straight through to the record. A slot that sometimes
   named the mode and sometimes counted wins taught nobody either (user call);
   the tallies live on the result screen, which is where a game is read. */
function paintBadge(chips){
  $('#rec').innerHTML = chips.map(c => c.lib
    ? `<button type="button" class="rchip tapmode" data-lib="${c.lib}" data-id="${c.id}">`
      + `${c.html}<span class="mi">ⓘ</span></button>`
    : `<span class="rchip">${c.html}</span>`).join('');
}
/* a registry entry as a chip -- one shape for both rosters, so the mode's
   caption and the spell's cannot drift apart. Exported: the online flow builds
   its own chips and must build them the same way. */
export const modeChip = m => ({ html: modeIcon(m.id,12)+' '+m.name, lib:'modes', id:m.id });
export const spellChip = s => ({ html: spellIcon(s.id,12)+' '+s.name, lib:'spells', id:s.id });
/* A live online match CLAIMS the badge: anything that saves mid-match calls
   updateRecord(), and that must not repaint the mode away underneath it. */
let badgeClaimed=false;
export function claimBadge(chips){ badgeClaimed=true; paintBadge(chips); }
export function releaseBadge(){ badgeClaimed=false; updateRecord(); }
export function updateRecord(){
  if(badgeClaimed) return;
  // the mode is named in EVERY game, classic included -- the picker's choice is
  // visible wherever you are, and a tap explains it
  const chips=[modeChip(modeByEnum(S.scoring|0))];
  // ...and the rune this game deals, when it deals one, opens the spell sheet
  const dealt=spellById(dealtOf(S.spellCharges[ME]));
  if(dealt) chips.push(spellChip(dealt));
  paintBadge(chips);
}
/* ===================== PREVIEW HINTS ===================== */
export function clearHints(){
  document.querySelectorAll('.col').forEach(c=>c.classList.remove('legal','danger'));
  document.querySelectorAll('.chip .dl').forEach(d=>{ d.classList.remove('show','gain','kill'); d.textContent=''; });
}
export function showHints(){
  clearHints();
  if(S.phase!=='choose') return;
  if(S.mode==='cpu' && S.turn!==ME) return;
  const me=S.turn, foe=1-S.turn, die=S.die;
  /* Normal play shows only the dashed "you may play here" affordance. The point
     previews and destruction warnings do the strategic thinking for the player,
     so they are a tutorial aid — reading the board IS the game. */
  const teach = !!S.tut;
  const restrict = S.tut ? S.tut.restrict : null;
  for(let c=0;c<SPEC.cols;c++){
    if(S.boards[me][c].length>=SPEC.rows) continue;
    if(restrict!=null && c!==restrict) continue;   // lesson steps point at one column
    colEl(me,c).classList.add('legal');
    if(!teach) continue;
    const gain = colScore(S.boards[me][c].concat([die])) - colScore(S.boards[me][c]);
    const g=chipEl(me,c).querySelector('.dl');
    g.textContent='+'+gain; g.className='dl gain show';
    const kills=countOf(S.boards[foe][c],die);
    if(kills){
      // show the POINTS they lose (multiplier included), matching the + pill
      const loss=colScore(S.boards[foe][c])-colScore(S.boards[foe][c].filter(v=>v!==die));
      const k=chipEl(foe,c).querySelector('.dl');
      k.textContent='−'+loss; k.className='dl kill show';
      colEl(foe,c).classList.add('danger');
    }
  }
}
/* ===================== TURN FLOW ===================== */
/* ONE status line, said once. The third parameter used to append a ticking
   ellipsis, and the only caller that passed it was the offline AI's turn — so
   "AI thinking…" animated offline while the identical online wait ("<name>
   thinking") sat still. A flag whose whole job is to let two callers of the
   same function disagree is the difference itself; removing it is what makes
   them agree, rather than remembering to pass false. */
export function setStatus(text,who){
  const s=$('#status');
  s.textContent=text;
  s.className='status'+(who===ME?' me':who===AI?' ai':'');
}
export function setActivePlate(){
  const live = S.phase!=='over' && S.phase!=='menu';
  const topActive = S.turn!==S.bottom;
  $('#plateBot').classList.toggle('active', live && !topActive);
  $('#plateTop').classList.toggle('active', live && topActive);
  /* face-to-face: the idle half dims, and the centre stage (die, status, clock)
     turns toward whoever is playing — that IS the hand-off signal.
     <html>.face is the ONE source of truth for the seating (see faceRotated) */
  const face = document.documentElement.classList.contains('face');
  $('#sideTop').classList.toggle('idle', face && live && !topActive);
  $('#sideBot').classList.toggle('idle', face && live && topActive);
  document.documentElement.classList.toggle('p2turn', face && live && topActive);
}
/* The game stopped: settle the shared view. Whichever flow decided it is over,
   the board must stop advertising a live turn — online used to leave the last
   mover's plate glowing and the dashed legal columns up for the whole end beat
   while the status line already read "You win". */
export function settleBoard(){
  S.phase='over'; S.busy=false;
  setActivePlate();
  clearHints();
}
