// @ts-nocheck -- moved verbatim from the monolith; typed in the milestone-D
// strictness ratchet. New code goes in typed modules, not here.
// Painting the table: boards, dice, scores, plates, status line and the
// tutorial-only strategy hints. State in, DOM out -- game logic stays out.
import { AI, ME, SPEC, colScore, boardTotal, counts, countOf } from '../core/rules';
import { S, DIFF_LABEL } from '../state';
import { $, sideKey, slotEl, slotIdx, colEl, chipEl } from './dom';
import { nameOf } from './identity';
import { makeDie } from './die';
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
      chip.innerHTML='<span class="cs">0</span><span class="mx"></span><span class="dl"></span>';
      cs.appendChild(chip);
    }
  }
}
/* ===================== RENDER ===================== */
export function renderSide(who,animate){
  const b=S.boards[who];
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
      const k=cm[v]||1;
      d.classList.toggle('m2',k===2);
      d.classList.toggle('m3',k===3);
    }
  }
  updateScores(who);
}
function updateScores(who){
  const b=S.boards[who];
  for(let c=0;c<SPEC.cols;c++){
    const sc=colScore(b[c]);
    const chip=chipEl(who,c);
    chip.querySelector('.cs').textContent=sc;
    chip.classList.toggle('has',sc>0);
    const cm=counts(b[c]); let mx='';
    for(const v in cm){ if(cm[v]===3) mx='×3'; else if(cm[v]===2 && mx!=='×3') mx='×2'; }
    chip.querySelector('.mx').textContent=mx;
    // and describe it for screen readers, reusing the score we just computed
    const free=SPEC.rows-b[c].length;
    colEl(who,c).setAttribute('aria-label',
      nameOf(who)+' column '+(c+1)+', score '+sc+', '+
      (free? free+' space'+(free>1?'s':'')+' free' : 'full'));
  }
  const tot=boardTotal(b);
  const k=sideKey(who)==='bot'?'Bot':'Top';
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
export function updateRecord(){
  $('#rec').innerHTML = S.mode==='duo'
    ? 'P1 <b>'+S.p1+'</b> · P2 <i>'+S.p2+'</i>'
    : 'W <b>'+S.wins+'</b> · L <i>'+S.losses+'</i>';
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
      const k=chipEl(foe,c).querySelector('.dl');
      k.textContent='−'+kills; k.className='dl kill show';
      colEl(foe,c).classList.add('danger');
    }
  }
}
/* ===================== TURN FLOW ===================== */
export function setStatus(text,who,dots){
  const s=$('#status');
  s.textContent=text;
  s.className='status'+(who===ME?' me':who===AI?' ai':'')+(dots?' dots':'');
}
export function setActivePlate(){
  const live = S.phase!=='over' && S.phase!=='menu';
  const topActive = S.turn!==S.bottom;
  $('#plateBot').classList.toggle('active', live && !topActive);
  $('#plateTop').classList.toggle('active', live && topActive);
  /* face-to-face: the idle half dims, and the centre stage (die, status, clock)
     turns toward whoever is playing — that IS the hand-off signal */
  const face = S.mode==='duo' && S.seat==='face';
  $('#sideTop').classList.toggle('idle', face && live && !topActive);
  $('#sideBot').classList.toggle('idle', face && live && topActive);
  document.documentElement.classList.toggle('p2turn', face && live && topActive);
}
