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
/* ===================== THE COLUMN'S SEAL =====================
   The mark a PROTECTED column wears (design/screens/39c-guard-seal.html,
   approved). Built once here with the rest of the column's furniture, both
   kinds in the one element, because the stylesheet decides which of them is
   showing (main.css ".col>.seal") from the classes this file already toggles.
   ONE element, ONE builder: flow/game.ts and online/play.ts drive the same
   board through this layer and neither may paint a seal privately.

   THE FRAME IS THE COLUMN'S OWN BOX, IN REAL PIXELS. It used to be a fixed
   62x198 reference — one column at a 62px cell — stretched onto the element
   with preserveAspectRatio="none", which quietly made every number in here a
   PROPORTION of the cell instead of a length. The 18-unit corner painted
   24.4px at an 84px cell against .col's flat 18px radius, so the seal was
   visibly rounder than everything it enclosed and got rounder on every bigger
   phone (user report, on a ward — a single thin line makes it obvious). The
   same stretch painted the loop's vertical sides at a different weight from
   its horizontal ones. So there is no reference frame any more: the viewBox IS
   the element's pixel box, one user unit is one CSS pixel, and corner, stroke,
   clasp and stand-off are all the lengths they look like — constant at every
   cell size, exactly as --seal-out already was.
   WHAT THAT COSTS is that the geometry now depends on --cell, so it has to be
   re-cut when the cell changes; `watchCells` below is that, and it is the only
   thing that re-cuts it. The dash beats are untouched: every one of them rides
   `pathLength`, which normalises the line's real length away — which is why
   they survive this and did NOT survive vector-effect:non-scaling-stroke.

   THE CORNER IS ASKED FOR, NEVER RESTATED — AND IT ASKS THE CELL. main.css
   owns one corner for a seat and the die that lands in it (".slot,.die"), and
   sealMetrics reads it off a real .slot and adds the stand-off, because a line
   offset outward from a rounded rectangle only stays PARALLEL to it — corners
   included — if its radius grows by that same offset. It used to ask .col,
   whose box is 4px rounder than the cells it holds and paints NOTHING: the
   seal was then parallel to a rectangle no one can see, and bowed away from
   the dice it encloses by 4px at the corners while running flush to them down
   the sides. That is what a second report of "the radius is too strong" was
   looking at, after the stretched frame that made it worse was gone.

   The line runs along the frame's edge and main.css grows the ELEMENT by
   --seal-out, which is what stands it off the stack. The mouth — where the
   shield's two drawing heads meet and where the ward's clasp holds the gap
   shut — is the middle of the short end at y=0; the hinge the ward swings open
   on is the middle of the far end.

   A RUN OF ADJACENT SHIELDED COLUMNS IS ONE SEAL, not one each: `sealFor`
   below draws n columns and the gutters between them, and updateScores decides
   which column carries it (see the note there). The frame GROWS with the run
   rather than one column's loop being stretched across it, so the corner, the
   stroke and the circling bead are the same at every span. */
const SEAL_MOUTH = 4;      // half the gap at the mouth that the ward's clasp holds shut
/* READ ONCE PER LAYOUT, not once per column: getComputedStyle forces a style
   pass and updateScores runs on every placement. watchCells clears it.
   The BEATS come through here too. They do not depend on the cell — they are
   read here because this is the one place that asks the stylesheet anything,
   and a second reader is a second chance to drift. */
let SEALM = null;
function sealMetrics(){
  const cs = getComputedStyle(document.documentElement);
  const num = (k,d) => { const v = parseFloat(cs.getPropertyValue(k)); return v > 0 ? v : d; };
  /* A TIME TOKEN IN MILLISECONDS, WHATEVER UNIT IT REACHES US IN. The CSS
     minifier the build runs rewrites `950ms` as `.95s` because that is shorter,
     so a bare parseFloat reads 950 from the dev stylesheet and 0.95 from the
     shipped bundle — and the one-shot class would come off a millisecond in,
     cutting the draw-on off in the only place a player ever sees it. Ask the
     string for its unit; never assume the one that was typed survives. */
  const ms = (k,d) => { const v = cs.getPropertyValue(k).trim(), n = parseFloat(v);
    if(!(n > 0)) return d;
    return /ms$/.test(v) ? n : /s$/.test(v) ? n*1000 : n; };
  const cell = num('--cell',62), gap = num('--gap',6), out = num('--seal-out',1.6);
  const seat = document.querySelector('.slot');
  const corner = seat ? parseFloat(getComputedStyle(seat).borderRadius) : 14;
  return { cell, gap, out, r: (corner > 0 ? corner : 14) + out, h: 3*cell + 2*gap + 2*out,
           engage: ms('--seal-engage',950), strike: ms('--seal-strike',780), snap: ms('--seal-snap',1050) };
}
function sealM(){ return SEALM || (SEALM = sealMetrics()); }
function sealFor(n){
  const m = sealM(), w = m.cell*n + m.gap*(n-1) + 2*m.out, h = m.h, mid = w/2, R = m.r;
  const f = (v) => +v.toFixed(2);
  /* THE LINE — the frame's own edge, cornered at the cell's radius grown by the
     stand-off, which is what keeps it parallel to the stack. One rectangle, one
     line: the loop used to carry a hairline copy 3px inside it and that read as
     a second outline rather than as weight (main.css, ".seal .sl"). */
  const loop = 'M'+f(R)+' 0H'+f(w-R)+'a'+f(R)+' '+f(R)+' 0 0 1 '+f(R)+' '+f(R)
    + 'V'+f(h-R)+'a'+f(R)+' '+f(R)+' 0 0 1 '+f(-R)+' '+f(R)
    + 'H'+f(R)+'a'+f(R)+' '+f(R)+' 0 0 1 '+f(-R)+' '+f(-R)
    + 'V'+f(R)+'a'+f(R)+' '+f(R)+' 0 0 1 '+f(R)+' '+f(-R)+'Z';
  /* the shield's drawing heads: from the hinge, up one side, to the mouth */
  const half = (d) => 'M'+f(mid)+' '+f(h)+'H'+f(d<0 ? R : w-R)
    + 'a'+f(R)+' '+f(R)+' 0 0 '+(d<0?1:0)+' '+f(d*R)+' '+f(-R)
    + 'V'+f(R)+'a'+f(R)+' '+f(R)+' 0 0 '+(d<0?1:0)+' '+f(-d*R)+' '+f(-R)+'H'+f(mid);
  /* ...and the ward's, which STOP short of the mouth on both sides: the gap is
     the whole argument of the mark and the clasp is what closes it */
  const arc = (d) => 'M'+f(mid + d*SEAL_MOUTH)+' 0H'+f(d<0 ? R : w-R)
    + 'a'+f(R)+' '+f(R)+' 0 0 '+(d<0?0:1)+' '+f(d*R)+' '+f(R)
    + 'V'+f(h-R)+'a'+f(R)+' '+f(R)+' 0 0 '+(d<0?0:1)+' '+f(-d*R)+' '+f(R)+'H'+f(mid);
  return '<svg class="seal" data-n="'+n+'" viewBox="0 0 '+f(w)+' '+f(h)+'" preserveAspectRatio="none" aria-hidden="true">'
  + '<g class="sgold">'                                   /* SHIELD: closed, seamless, no end */
    + '<g class="sset">'
      + '<path class="sl" d="' + loop + '"/>'
      + '<path class="sb" pathLength="480" d="' + loop + '"/>'
    + '</g>'
    + '<path class="sd" pathLength="240" d="' + half(-1) + '"/>'
    + '<path class="sd" pathLength="240" d="' + half(1) + '"/>'
    + '<circle class="sj" cx="'+f(mid)+'" cy="0" r="3.5"/>'
  + '</g>'
  /* THE WARD IS NEVER MERGED — it is one charge on one column, and a line
     drawn round two of them would say something false — so it is only ever
     built at span 1. A merged seal carries no clasp group at all rather than a
     stretched one the stylesheet happens to hide. */
  + (n === 1
    ? '<g class="smint">'                                 /* WARD: thinner, and ONE clasp */
      + '<path class="sa sal" pathLength="240" d="' + arc(-1) + '"/>'
      + '<path class="sa sar" pathLength="240" d="' + arc(1) + '"/>'
      + '<g class="sclasp">'
        + '<path class="sp spl" d="M'+f(mid)+' -3.4 '+f(mid-4.6)+' 0 '+f(mid)+' 3.4"/>'
        + '<path class="sp spr" d="M'+f(mid)+' -3.4 '+f(mid+4.6)+' 0 '+f(mid)+' 3.4"/>'
        + '<circle class="sv" cx="'+f(mid)+'" cy="0" r="1.5"/>'
      + '</g></g>'
    : '')
  + '</svg>';
}
/* THE SEAL IS CUT TO THE COLUMN IT DRESSES, so it is re-cut when that column
   changes size — and only then. Watching the column itself, rather than
   listening for a window resize, keeps the rule where it belongs and catches
   every way the cell can move: ui/layout.ts fit() re-picks it on resize, on
   rotation, on every screen that opens or closes, and when the tutorial's
   preview lane appears. This is a REDRAW, not a state change: each seal keeps
   its span, no engage beat fires, and updateScores is not consulted. */
let sealRO = null;
function reseal(){
  for(const seal of document.querySelectorAll('.col>.seal')) seal.outerHTML = sealFor(+seal.dataset.n || 1);
}
function watchCells(){
  if(typeof ResizeObserver === 'undefined') return;   // no observer, no re-cut: the boot size still fits
  if(!sealRO) sealRO = new ResizeObserver(()=>{ SEALM = null; reseal(); });
  document.querySelectorAll('.col').forEach(c=>sealRO.observe(c));
}
/* Grow (or shrink) the seal this column carries to the run it must enclose.
   Returns whether it CHANGED — the caller turns that into the engage beat, so
   two neighbours becoming one mark draw themselves shut again instead of one
   of them silently vanishing. Rebuilt rather than re-`setAttribute`d because
   the whole shape changes together, and the only moment it changes is the
   moment the mark is about to be redrawn anyway. */
function sealSpan(col,n){
  const seal = col && col.querySelector('.seal');
  if(!seal || +seal.dataset.n === n) return false;
  seal.outerHTML = sealFor(n);
  col.style.setProperty('--seal-span', n);
  return true;
}
/* The column whose seal encloses this one. A merged run draws ONE mark and it
   hangs on the run's first column, so a beat aimed at a column inside the run
   has to travel to the head or it plays on a `display:none` element. Read off
   the DOM rather than recomputed from the boards: updateScores is the one place
   that decides a run, and this must not become a second opinion. */
function sealHost(col){
  let h = col;
  while(h && h.classList.contains('sealmerged')) h = h.previousElementSibling;
  return h && h.classList.contains('col') ? h : col;
}
/* Every seal beat is ONE SHOT: the class goes on for exactly as long as the
   animation main.css gives it and then comes off again, so a column at rest
   wears no animation but the bead. That is the whole defence against the
   strobe — renderSide runs on every placement, and a draw-on keyed to a class
   that merely PERSISTS would restart wherever the element was rebuilt.
   THE LENGTHS ARE ASKED FOR, NOT MIRRORED: main.css owns each beat
   (--seal-engage / --seal-strike / --seal-snap, read by sealMetrics) and this
   adds a little slack so the class never disappears out from under its own last
   frame. Three numbers typed here beside three typed there is exactly the kind
   of pair that parts on the first tuning pass — and did, the moment the beats
   were slowed. */
const SEAL_SLACK = 60;
/* PER CLASS, not per element. Two different one-shots can land on one column
   inside one window — a run that grows wears .sealon on the same beat a strike
   can be hardening it — and a single timer per element meant the second beat
   cancelled the first one's REMOVAL and left its class on forever. */
const beatOff = new WeakMap();
function oneShot(el,cls,ms){
  if(!el) return;
  let t = beatOff.get(el); if(!t) beatOff.set(el, t = {});
  clearTimeout(t[cls]);
  // remove/reflow/add: the same restart idiom the chip marks have always used,
  // so a second strike inside the first beat replays instead of being eaten
  el.classList.remove(cls); void el.offsetWidth; el.classList.add(cls);
  t[cls] = setTimeout(()=>el.classList.remove(cls), ms);
}
function restart(el,cls){ if(!el) return; el.classList.remove(cls); void el.offsetWidth; el.classList.add(cls); }
/* A STRIKE MEETS A PROTECTION — one beat, said once, for both drivers. The
   chip's mark flares exactly as it always has and the column's seal answers in
   its own kind: the shield HARDENS and is unchanged, the ward's clasp SNAPS and
   the line unwinds off the column. These two lines used to be copy-pasted into
   flow/game.ts and online/play.ts, which is precisely how a shared view grows
   five differences. */
export function shieldBlocked(who,col){
  const chip=chipEl(who,col);
  restart(chip && chip.querySelector('.sh'),'block');
  // the CHIP's mark belongs to the struck column; the seal belongs to whatever
  // run encloses it, which may be a neighbour's
  oneShot(sealHost(colEl(who,col)),'sealhit',sealM().strike + SEAL_SLACK);
}
export function wardBurned(who,col){
  const chip=chipEl(who,col);
  restart(chip && chip.querySelector('.wd'),'block');
  /* .sealsnap outlives the repaint that clears .warded on purpose: the charge
     is spent the instant the strike lands, and the mark still has to be seen
     leaving. main.css keeps the seal drawn for as long as this class is on.
     No sealHost() here: a ward is never merged, so its seal is always its own. */
  oneShot(colEl(who,col),'sealsnap',sealM().snap + SEAL_SLACK);
}
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
      col.insertAdjacentHTML('beforeend',sealFor(1));   // the column's dress, after its slots
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
  watchCells();   // ...and from here the seals answer to the column's size
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
  /* WHICH COLUMNS ARE SEALED — asked for the whole board before any of them is
     dressed, because a column's mark now depends on its NEIGHBOURS: adjacent
     shielded columns share ONE enclosure. Two seals 6px apart were never two
     marks a player could tell apart (at the 88px cap their painted strokes
     leave 0.46px of gutter — main.css, --seal-out), so the honest drawing is
     one loop around the whole run.
     SAFE BECAUSE A SHIELD NEVER LIFTS, and that is the load-bearing fact: a
     COLUMN SHIELD column is full, victimsOf() gives a full column no victims,
     PILFER refuses to rob one and WARD refuses to mark one (core/rules,
     core/spells) — so a run can only ever GROW, and no seal ever has to come
     apart mid-game. If any of those three ever stops being true, this needs an
     un-merge beat before it needs anything else.
     Decided HERE, once: flow/game.ts and online/play.ts repaint through this
     one function and neither learns the word. */
  const sealed=[];
  for(let c=0;c<SPEC.cols;c++) sealed.push(isShielded(b[c],S.scoring));
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
    const colE=colEl(who,c);
    // COLUMN SHIELD: a full column wears its shield (pops in the first time)
    const sh=chip.querySelector('.sh');
    const shielded=isShielded(b[c],S.scoring);
    const shieldNew=shielded && !sh.firstChild;
    if(shieldNew){ sh.innerHTML=modeIcon('colshield',13); sh.classList.add('pop'); }
    else if(!shielded && sh.firstChild){ sh.innerHTML=''; sh.classList.remove('pop'); }
    colE.classList.toggle('shielded',shielded);
    // WARD: a warded column wears its rune until the mark burns (flow/spells).
    // Painted from S.charm — the same state destruction consults, so the chip
    // can never outlive or precede the protection it announces.
    const wd=chip.querySelector('.wd');
    const warded=S.charm.wards[who][c]>0;
    const wardNew=warded && !wd.firstChild;
    if(wardNew){ wd.innerHTML=spellIcon('ward',13); wd.classList.add('pop'); }
    else if(!warded && wd.firstChild){ wd.innerHTML=''; wd.classList.remove('pop','block'); }
    colE.classList.toggle('warded',warded);
    /* THE RUN THIS COLUMN IS IN. A shielded column that FOLLOWS another draws
       nothing of its own — its neighbour's seal already encloses it — and the
       column that leads the run wears a seal grown to the run's full length.
       The chip keeps its own shield mark either way: every column in the run
       really is shielded, and the chips are what say so column by column. */
    const merged=shielded&&!!sealed[c-1];
    colE.classList.toggle('sealmerged',merged);
    let span=1; if(shielded&&!merged) while(sealed[c+span]) span++;
    const regrown=sealSpan(colE,span);
    /* AND THE SEAL DRAWS ITSELF SHUT — on exactly the beat the chip's mark pops
       in, never a frame of its own. "First time only" is the same condition the
       mark above uses, so the line and the mark arrive together and a repaint
       (this function runs on every placement) finds nothing left to restart.
       A run that GREW is the same event one step later: the mark that has to
       arrive is the longer one, and it arrives the same way. A column inside a
       run is skipped — its own seal is not on screen to draw. */
    if(!merged&&(shieldNew||wardNew||regrown)) oneShot(colE,'sealon',sealM().engage + SEAL_SLACK);
    // and describe it for screen readers, reusing the score we just computed
    const free=SPEC.rows-b[c].length;
    colE.setAttribute('aria-label',
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
