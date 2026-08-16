// @ts-nocheck — moved verbatim from knucklebones.html (milestone A).
// Milestone B dissolves this file into typed modules; the ts-nocheck ratchets
// away with it. Do not add new code here.
/* ===================== CONSTANTS ===================== */
const AI = 0, ME = 1;
const PIPS = {1:[4],2:[0,8],3:[0,4,8],4:[0,2,6,8],5:[0,2,4,6,8],6:[0,2,3,5,6,8]};
const $ = s => document.querySelector(s);

/* ===================== EMBED MODE =====================
   false: the page owns the viewport (standalone / PWA / native).
   true : the game lives inside #kbroot on someone else's page (widget build).
   Every difference between the two ships as a branch here or a CSS override in
   widget-embed.css — never as a post-build text transformation. */
let EMBED = false;
const kbroot = () => document.getElementById('kbroot');
function rootRect(){ return kbroot().getBoundingClientRect(); }

/* ===================== STATE ===================== */
/* Player indices are fixed identities: 1 = cyan (you / Player 1), 0 = magenta
   (CPU / Player 2). Which HALF OF THE SCREEN each one occupies is S.bottom,
   which swaps on hand-off so the active player is always nearest their thumbs. */
const S = {
  boards:[[[],[],[]],[[],[],[]]],
  turn: ME,
  die: 0,
  phase:'menu',          // menu | roll | choose | pass | anim | over
  mode:'cpu',            // cpu | duo
  bottom: ME,            // which player is rendered in the lower half
  diff:'hard',
  wins:0, losses:0, draws:0,
  p1:0, p2:0, ties:0,    // duo-mode session record
  best:0,                // highest single-game score, persisted
  numerals:false,        // show numbers on dice instead of pips
  timer:10,              // two-player turn clock in seconds; 0 = off
  seat:'pass',           // duo seating: pass the phone, or sit facing each other
  tut:null,              // tutorial script state while the guided game runs
  tutDone:false,         // persisted: has the tutorial ever been finished
  starter: ME,
  sound:true,
  busy:false,
  gen:0            // bumped whenever a game is abandoned/restarted; async work checks it
};

/* ===================== AUDIO ===================== */
const Sfx = (()=>{
  let ctx=null;
  function ac(){
    if(!ctx){ const C=window.AudioContext||window.webkitAudioContext; if(!C) return null; ctx=new C(); }
    if(ctx.state==='suspended') ctx.resume();
    return ctx;
  }
  function tone(f,dur,type,gain,slideTo,delay){
    if(!S.sound) return; const c=ac(); if(!c) return;
    const t=c.currentTime+(delay||0);
    const o=c.createOscillator(), g=c.createGain();
    o.type=type||'sine'; o.frequency.setValueAtTime(f,t);
    if(slideTo) o.frequency.exponentialRampToValueAtTime(Math.max(40,slideTo),t+dur);
    g.gain.setValueAtTime(0.0001,t);
    g.gain.exponentialRampToValueAtTime(gain||0.07,t+0.012);
    g.gain.exponentialRampToValueAtTime(0.0001,t+dur);
    o.connect(g); g.connect(c.destination); o.start(t); o.stop(t+dur+0.03);
  }
  function noise(dur,gain,hz){
    if(!S.sound) return; const c=ac(); if(!c) return;
    const n=Math.floor(c.sampleRate*dur);
    const buf=c.createBuffer(1,n,c.sampleRate), d=buf.getChannelData(0);
    for(let i=0;i<n;i++) d[i]=(Math.random()*2-1)*Math.pow(1-i/n,2.2);
    const src=c.createBufferSource(); src.buffer=buf;
    const f=c.createBiquadFilter(); f.type='bandpass'; f.frequency.value=hz||1400; f.Q.value=.9;
    const g=c.createGain(); g.gain.value=gain||0.05;
    src.connect(f); f.connect(g); g.connect(c.destination); src.start();
  }
  return {
    unlock(){ ac(); },
    tick(){ tone(520+Math.random()*380,0.035,'square',0.022); },
    roll(){ noise(0.16,0.045,2200); },
    place(){ tone(180,0.12,'triangle',0.09,90); noise(0.07,0.04,900); },
    kill(){ tone(720,0.28,'sawtooth',0.075,110); noise(0.3,0.07,600); },
    mult(){ tone(880,0.1,'triangle',0.06); tone(1320,0.12,'triangle',0.05,null,0.07); },
    pass(){ tone(392,0.16,'triangle',0.05); tone(587,0.2,'triangle',0.045,null,0.11); },
    win(){ [523,659,784,1046].forEach((f,i)=>tone(f,0.32,'triangle',0.075,null,i*0.1)); },
    lose(){ [440,349,262].forEach((f,i)=>tone(f,0.4,'sine',0.075,null,i*0.13)); },
    tap(){ tone(1200,0.04,'square',0.03); }
  };
})();
function vibrate(ms){ try{ if(navigator.vibrate && S.sound) navigator.vibrate(ms); }catch(e){} }

/* ===================== PERSISTENCE =====================
   Storage is unavailable in some embeds (sandboxed iframes, private modes).
   Every access is guarded: the game simply forgets between sessions there. */
const DIFFS=['easy','medium','hard'], MODES=['cpu','duo'], TIMERS=[0,10,20], SEATS=['pass','face'];
const DIFF_LABEL={easy:'EASY',medium:'NORMAL',hard:'HARD'};
/* accept a stored value only if it is one we recognise, else keep the current one */
function oneOf(list,val,fallback){ return list.indexOf(val)>=0 ? val : fallback; }

const Store = {
  KEY:'knucklebones.v1',
  read(){ try{ return JSON.parse(localStorage.getItem(Store.KEY)) || {}; }catch(e){ return {}; } },
  write(o){ try{ localStorage.setItem(Store.KEY, JSON.stringify(o)); }catch(e){} }
};
function saveStats(){
  Store.write({ wins:S.wins, losses:S.losses, draws:S.draws,
                p1:S.p1, p2:S.p2, ties:S.ties,
                best:S.best, diff:S.diff, mode:S.mode, sound:S.sound,
                numerals:S.numerals, timer:S.timer, seat:S.seat, tutDone:S.tutDone });
}
function loadStats(){
  const d=Store.read();
  S.wins=d.wins|0; S.losses=d.losses|0; S.draws=d.draws|0;
  S.p1=d.p1|0; S.p2=d.p2|0; S.ties=d.ties|0; S.best=d.best|0;
  S.diff  = oneOf(DIFFS, d.diff, S.diff);
  S.mode  = oneOf(MODES, d.mode, S.mode);
  S.timer = oneOf(TIMERS, d.timer, S.timer);
  S.seat  = oneOf(SEATS, d.seat, S.seat);
  if(typeof d.sound==='boolean') S.sound=d.sound;
  if(typeof d.numerals==='boolean') S.numerals=d.numerals;
  if(typeof d.tutDone==='boolean') S.tutDone=d.tutDone;
}
const REDUCED = (()=>{ try{ return window.matchMedia('(prefers-reduced-motion: reduce)').matches; }
                       catch(e){ return false; } })();
/* ---- in-progress game, so closing the app doesn't lose it ----
   The rolled die is saved too: quitting after seeing a bad roll gives you the
   same one back rather than a free reroll. */
const GKEY='knucklebones.game.v1';
function saveGame(){
  if(S.tut) return;                 // tutorials are throwaway; leave any real save alone
  if(S.phase==='over'||S.phase==='menu'){ clearGame(); return; }
  const placed=S.boards[0].flat().length+S.boards[1].flat().length;
  if(!placed){ clearGame(); return; }   // nothing on the board = nothing to resume
  try{
    localStorage.setItem(GKEY, JSON.stringify({
      boards:S.boards, turn:S.turn, die:S.die, mode:S.mode, diff:S.diff,
      bottom:S.bottom, starter:S.starter, seat:S.seat
    }));
  }catch(e){}
}
function clearGame(){ try{ localStorage.removeItem(GKEY); }catch(e){} }
function loadGame(){
  let g; try{ g=JSON.parse(localStorage.getItem(GKEY)); }catch(e){ return null; }
  if(!g) return null;
  // validate hard: a corrupt or hand-edited blob must not boot the game
  const okBoard = b => Array.isArray(b) && b.length===3 && b.every(c =>
    Array.isArray(c) && c.length<=3 && c.every(v => Number.isInteger(v) && v>=1 && v<=6));
  if(!Array.isArray(g.boards) || g.boards.length!==2 || !g.boards.every(okBoard)) return null;
  if(g.turn!==0 && g.turn!==1) return null;
  if(g.bottom!==0 && g.bottom!==1) return null;
  if(g.mode!=='cpu' && g.mode!=='duo') return null;
  if(isFull(g.boards[0]) || isFull(g.boards[1])) return null;   // that game was over
  const placed = g.boards[0].flat().length + g.boards[1].flat().length;
  if(placed===0) return null;                                   // nothing worth resuming
  if(!(Number.isInteger(g.die) && g.die>=0 && g.die<=6)) g.die=0;
  return g;
}
function resumeGame(){
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
  hide('#ovEnd'); hide('#ovStart'); hide('#ovRules'); hide('#ovPass');
  const human = S.mode==='duo' || S.turn===ME;
  if(human && g.die){
    // hand the same die back
    S.die=g.die; S.phase='choose';
    setStageDie(S.die,S.turn);
    setStatus(S.mode==='duo' ? nameOf(S.turn)+' — tap a column' : 'Tap a column', S.turn);
    setActivePlate(); showHints(); startTimer();
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
function syncSettingsUI(){
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
function toMenu(){
  S.gen++; S.phase='over';
  stopTimer(); clearTut(); clearHints();
  passResolve=null; hide('#ovPass');
  updateResumeButton(); show('#ovStart');
}
function updateResumeButton(){
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
function updateStatLine(){
  const el=$('#statLine');
  const played=S.wins+S.losses+S.draws;
  if(!played && !S.best){ el.hidden=true; return; }
  el.hidden=false;
  el.innerHTML = 'Best <b>'+S.best+'</b>' + (played? '  ·  Record '+S.wins+'–'+S.losses+(S.draws?('–'+S.draws):'') : '');
}

/* ===================== SCORING ===================== */
/* countOf stays a plain loop rather than an object tally: colScore runs millions
   of times inside the search, and building a map per call costs far more. */
function countOf(col,v){
  let k=0;
  for(let i=0;i<col.length;i++) if(col[i]===v) k++;
  return k;
}
function legalCols(board){
  const out=[];
  for(let c=0;c<3;c++) if(board[c].length<3) out.push(c);
  return out;
}
function colScore(col){
  let s=0;
  for(let v=1;v<=6;v++){
    const k=countOf(col,v);
    if(k) s += v*k*k;
  }
  return s;
}
function boardTotal(b){ return colScore(b[0])+colScore(b[1])+colScore(b[2]); }
function isFull(b){ return b[0].length+b[1].length+b[2].length >= 9; }
function counts(col){ const m={}; for(const v of col) m[v]=(m[v]||0)+1; return m; }

/* ===================== AI (expectimax) ===================== */
let NODES=0; const BUDGET=500000;
let RISK_W=1.5;                       /* tuned by self-play: 55.3% vs risk-blind over 500 games */
function cloneSt(st){ return [ [st[0][0].slice(),st[0][1].slice(),st[0][2].slice()],
                               [st[1][0].slice(),st[1][1].slice(),st[1][2].slice()] ]; }
function applyMove(st,who,col,die){
  st[who][col].push(die);
  const o=1-who, oc=st[o][col];
  let hit=false; for(let i=0;i<oc.length;i++) if(oc[i]===die){hit=true;break;}
  if(hit) st[o][col]=oc.filter(v=>v!==die);
}
/* expected value a player stands to lose to one enemy placement in a facing column */
function riskOf(st,p){
  const o=1-p, mine=st[p], theirs=st[o];
  let r=0;
  for(let c=0;c<3;c++){
    if(theirs[c].length>=3) continue;          // they can't play into this column any more
    const col=mine[c];
    for(let v=1;v<=6;v++){
      const k=countOf(col,v);
      if(k) r += (v*k*k)/6;                     // 1-in-6 chance they roll exactly this value
    }
  }
  return r;
}
function evalSt(st){
  let s = boardTotal(st[AI]) - boardTotal(st[ME]);
  if(RISK_W) s += RISK_W*(riskOf(st,ME) - riskOf(st,AI));
  return s;
}
function searchRoot(st,who,die,depth){ NODES=0; return search(st,who,die,depth); }
function search(st,who,die,depth){
  NODES++;
  const legal=legalCols(st[who]);
  let bestV = who===AI ? -1e9 : 1e9, bestC = legal[0];
  for(const c of legal){
    const ns=cloneSt(st);
    applyMove(ns,who,c,die);
    let v;
    if(isFull(ns[who])){
      const d = boardTotal(ns[AI]) - boardTotal(ns[ME]);   // game over: material only
      v = d + (d>0?14:d<0?-14:0);
    } else if(depth<=1 || NODES>BUDGET){
      v = evalSt(ns);
    } else {
      let sum=0;
      for(let d=1;d<=6;d++) sum += search(ns,1-who,d,depth-1).v;
      v = sum/6;
    }
    v += (Math.random()-0.5)*1e-4;                 // tie-break jitter
    if(who===AI ? v>bestV : v<bestV){ bestV=v; bestC=c; }
  }
  return {v:bestV,c:bestC};
}
function aiChoose(){
  const st=[ S.boards[AI].map(c=>c.slice()), S.boards[ME].map(c=>c.slice()) ];
  const legal=legalCols(st[AI]);
  if(legal.length===1) return legal[0];
  if(S.tut){
    if(S.tut.cmoves.length) return S.tut.cmoves.shift();   // lesson setup
    const w1=RISK_W; RISK_W=0;                              // then a beatable greedy
    const c1=searchRoot(st,AI,S.die,1).c; RISK_W=w1; return c1;
  }
  const filled = st[AI].flat().length + st[ME].flat().length;
  const w0=RISK_W;
  let c;
  if(S.diff==='easy'){
    if(Math.random()<0.5) return legal[(Math.random()*legal.length)|0];
    RISK_W=0;                                     // easy is blind to danger
    c=searchRoot(st,AI,S.die,1).c;
  }else if(S.diff==='medium'){
    RISK_W=0.9;                                   // 59.9% vs greedy over 400 games
    c=searchRoot(st,AI,S.die,2).c;
  }else{
    RISK_W=1.5;
    /* Time-boxed deepening: always search 4 plies, and only go to 5 if this
       device did 4 fast enough that 5 (~10-18x the nodes) stays responsive.
       Keeps a slow phone at ~30ms/move instead of ~850ms. */
    const t0=performance.now();
    c=searchRoot(st,AI,S.die,4).c;
    if(performance.now()-t0 < 18 && filled<16) c=searchRoot(st,AI,S.die,5).c;
  }
  RISK_W=w0;
  return c;
}

/* ===================== DOM BUILD ===================== */
function makeDie(v,who){
  const d=document.createElement('div');
  d.className='die '+(who===ME?'p1':'p2');
  d.dataset.v=v;
  d.setAttribute('role','img');
  d.setAttribute('aria-label', v+', '+nameOf(who).toLowerCase());
  const on=PIPS[v]||[];
  for(let i=0;i<9;i++){
    const p=document.createElement('span');
    p.className='pip'+(on.indexOf(i)>=0?' on':'');
    p.setAttribute('aria-hidden','true');
    d.appendChild(p);
  }
  const n=document.createElement('b');
  n.className='num'; n.textContent=v; n.setAttribute('aria-hidden','true');
  d.appendChild(n);
  return d;
}
function setStageDie(v,who){
  const st=$('#dieStage'); st.innerHTML='';
  st.setAttribute('aria-label', v ? ('Rolled '+v+' for '+nameOf(who).toLowerCase()) : 'No die rolled yet');
  if(v){ const d=makeDie(v,who); d.removeAttribute('role'); d.removeAttribute('aria-label'); st.appendChild(d); }
}
function buildBoards(){
  for(const side of ['top','bot']){
    const b=$('#'+side+'Board'); b.innerHTML='';
    const cs=$('#'+side+'Cols'); cs.innerHTML='';
    for(let c=0;c<3;c++){
      const col=document.createElement('div');
      col.className='col'; col.dataset.col=c;
      col.setAttribute('role','button');
      col.setAttribute('tabindex','-1');
      for(let r=0;r<3;r++){
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
function sideKey(who){ return who===S.bottom ? 'bot' : 'top'; }
function ownerOf(sideEl){ return +sideEl.dataset.owner; }
function slotEl(who,col,slot){
  return document.querySelector('#'+sideKey(who)+'Board .col[data-col="'+col+'"] .slot[data-slot="'+slot+'"]');
}
/* dice stack toward the centre line, so it depends on the half, not the player */
function slotIdx(who,i){ return sideKey(who)==='bot' ? i : 2-i; }
function colEl(who,c){
  return document.querySelector('#'+sideKey(who)+'Board .col[data-col="'+c+'"]');
}
function chipEl(who,c){
  return document.querySelectorAll('#'+sideKey(who)+'Cols .chip')[c];
}

/* ===================== RENDER ===================== */
function renderSide(who,animate){
  const b=S.boards[who];
  for(let c=0;c<3;c++){
    const cm=counts(b[c]);
    for(let i=0;i<3;i++){
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
  for(let c=0;c<3;c++){
    const sc=colScore(b[c]);
    const chip=chipEl(who,c);
    chip.querySelector('.cs').textContent=sc;
    chip.classList.toggle('has',sc>0);
    const cm=counts(b[c]); let mx='';
    for(const v in cm){ if(cm[v]===3) mx='×3'; else if(cm[v]===2 && mx!=='×3') mx='×2'; }
    chip.querySelector('.mx').textContent=mx;
    // and describe it for screen readers, reusing the score we just computed
    const free=3-b[c].length;
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
function renderAll(anim){ renderSide(AI,anim); renderSide(ME,anim); }

function nameOf(who){
  if(S.mode==='duo') return who===ME?'PLAYER 1':'PLAYER 2';
  return who===ME?'YOU':'CPU';
}
function colorOf(who){ return who===ME?'var(--cy)':'var(--mg)'; }
/* Point each half of the screen at its current owner and repaint from scratch.
   Called on new game and after every hand-off swap. */
function applySides(){
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
function updateRecord(){
  $('#rec').innerHTML = S.mode==='duo'
    ? 'P1 <b>'+S.p1+'</b> · P2 <i>'+S.p2+'</i>'
    : 'W <b>'+S.wins+'</b> · L <i>'+S.losses+'</i>';
}

/* ===================== PREVIEW HINTS ===================== */
function clearHints(){
  document.querySelectorAll('.col').forEach(c=>c.classList.remove('legal','danger'));
  document.querySelectorAll('.chip .dl').forEach(d=>{ d.classList.remove('show','gain','kill'); d.textContent=''; });
}
function showHints(){
  clearHints();
  if(S.phase!=='choose') return;
  if(S.mode==='cpu' && S.turn!==ME) return;
  const me=S.turn, foe=1-S.turn, die=S.die;
  /* Normal play shows only the dashed "you may play here" affordance. The point
     previews and destruction warnings do the strategic thinking for the player,
     so they are a tutorial aid — reading the board IS the game. */
  const teach = !!S.tut;
  const restrict = S.tut ? S.tut.restrict : null;
  for(let c=0;c<3;c++){
    if(S.boards[me][c].length>=3) continue;
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

/* ===================== FX ===================== */
function burst(x,y,color,n){
  if(REDUCED) return;
  const fx=$('#fx');
  if(EMBED){ const rr=rootRect(); x-=rr.left; y-=rr.top; }
  n=n||16;
  for(let i=0;i<n;i++){
    const p=document.createElement('i');
    p.className='particle';
    p.style.left=x+'px'; p.style.top=y+'px';
    p.style.background=color;
    p.style.boxShadow='0 0 10px '+color;
    const sz=4+Math.random()*6;
    p.style.width=sz+'px'; p.style.height=sz+'px';
    fx.appendChild(p);
    const a=Math.random()*Math.PI*2, dist=34+Math.random()*84;
    const an=p.animate([
      {transform:'translate(-50%,-50%) scale(1)',opacity:1},
      {transform:'translate(calc(-50% + '+(Math.cos(a)*dist)+'px), calc(-50% + '+(Math.sin(a)*dist)+'px)) scale(0)',opacity:0}
    ],{duration:400+Math.random()*380,easing:'cubic-bezier(.15,.75,.3,1)'});
    an.onfinish=()=>p.remove();
  }
}
/* Floating score feedback. Anchored inside the column element itself (which is
   position:relative), so it needs no viewport maths and works unchanged in the
   standalone page, the widget iframe, portrait and landscape. */
function floatPts(who,col,text,color){
  const colE=colEl(who,col); if(!colE) return;
  const idx=Math.max(0, Math.min(2, S.boards[who][col].length-1));
  const slot=slotEl(who,col,slotIdx(who,idx)) || colE;
  const p=document.createElement('b');
  p.className='pts'; p.textContent=text; p.style.color=color;
  p.style.left=(slot.offsetLeft+slot.offsetWidth/2)+'px';
  p.style.top =(slot.offsetTop +slot.offsetHeight*0.30)+'px';
  colE.appendChild(p);
  /* informative, so reduced motion gets a plain fade instead of nothing */
  const rot = faceRotated(who) ? ' rotate(180deg)' : '';
  if(REDUCED) p.style.transform='translate(-50%,0)'+rot;
  const anim = REDUCED
    ? p.animate([{opacity:0},{opacity:1,offset:.25},{opacity:1,offset:.75},{opacity:0}],{duration:750})
    : p.animate([
        {transform:'translate(-50%,0) scale(.6)'+rot,opacity:0},
        {transform:'translate(-50%,-16px) scale(1.18)'+rot,opacity:1,offset:.28},
        {transform:'translate(-50%,-44px) scale(1)'+rot,opacity:0}
      ],{duration:900,easing:'cubic-bezier(.2,.7,.3,1)'});
  anim.onfinish=()=>p.remove();
}

function shake(power){
  if(REDUCED) return;
  const el=$('#app'); power=power||6;
  el.animate([
    {transform:'translate(0,0)'},{transform:'translate('+power+'px,'+(-power*0.6)+'px)'},
    {transform:'translate('+(-power)+'px,'+(power*0.5)+'px)'},{transform:'translate('+(power*0.6)+'px,'+(power*0.4)+'px)'},
    {transform:'translate(0,0)'}
  ],{duration:260,easing:'ease-out'});
}
function flash(alpha){
  if(REDUCED) return;
  const f=$('#flash');
  f.animate([{opacity:0},{opacity:alpha||0.28},{opacity:0}],{duration:220,easing:'ease-out'});
}
function wait(ms){ return new Promise(r=>setTimeout(r,ms)); }

/* ===================== TURN FLOW ===================== */
function setStatus(text,who,dots){
  const s=$('#status');
  s.textContent=text;
  s.className='status'+(who===ME?' me':who===AI?' ai':'')+(dots?' dots':'');
}
function setActivePlate(){
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
/* is this player's half displayed upside-down right now? (portrait face mode) */
function faceRotated(who){
  return who===AI && S.mode==='duo' && S.seat==='face' &&
         !document.documentElement.classList.contains('land');
}

/* ===================== TURN CLOCK (two-player only) =====================
   Runs only while a human is choosing, never during the hand-off card. On
   expiry it drops the die into a random legal column so a walk-away can't
   stall the game. */
let timerId=null;
function stopTimer(){
  if(timerId){ clearInterval(timerId); timerId=null; }
  const w=$('#timerWrap');
  if(w){ w.classList.remove('on','warn'); $('#timerNum').textContent=''; }
}
function startTimer(){
  stopTimer();
  if(S.mode!=='duo' || !S.timer || S.phase!=='choose') return;
  const gen=S.gen, total=S.timer*1000, end=performance.now()+total;
  const wrap=$('#timerWrap'), bar=$('#timerBar'), num=$('#timerNum');
  wrap.style.setProperty('--tcbase', colorOf(S.turn));   // clock wears the mover's colour
  wrap.classList.add('on');
  bar.style.width='100%';
  let warned=false;
  timerId=setInterval(()=>{
    if(S.gen!==gen || S.phase!=='choose'){ stopTimer(); return; }
    const left=Math.max(0,end-performance.now());
    bar.style.width=(left/total*100)+'%';
    const secs=Math.ceil(left/1000);
    num.textContent = secs<=5 ? secs : '';
    if(left<=5000 && !warned){ warned=true; wrap.classList.add('warn'); }
    if(left<=0){ stopTimer(); autoPlace(gen); }
  },100);
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

/* ===================== TUTORIAL =====================
   A guided first game. Rolls and CPU moves are scripted so every lesson is
   guaranteed to happen: the player always draws a second 4 for the multiplier
   lesson, and the CPU always has a 5 in its middle column for the destruction
   lesson — wherever the player put their earlier dice. Deterministic, so the
   whole flow is testable. */
let coachResolve=null;
function coachShow(msg,needTap){
  $('#coachMsg').textContent=msg;
  $('#coachHint').hidden=!needTap;
  $('#coach').hidden=false;
  return new Promise(res=>{ if(needTap) coachResolve=res; else res(); });
}
function coachHide(){ $('#coach').hidden=true; coachResolve=null; }
function clearTut(){
  S.tut=null;
  document.documentElement.classList.remove('tut');
  coachHide();
}
/* next scripted roll for whoever is rolling; 0 (falsy) once the script runs dry */
function tutNextRoll(){
  const q = S.turn===ME ? S.tut.prolls : S.tut.crolls;
  return q.length ? q.shift() : 0;
}
/* one lesson per player turn, keyed by turn number (board counts shift when
   dice get destroyed, so placements are the wrong key) */
function tutOnChoose(){
  const t=S.tut; t.turnNo++; t.restrict=null;
  if(t.turnNo===0){
    coachShow('You rolled a 4. The +pills preview what each column would score — tap any column to drop it in.');
  }else if(t.turnNo===1){
    t.restrict=t.firstCol;
    coachShow('Another 4! Matching dice in one column multiply: two 4s score 16, not 8. Stack it on your first 4.');
  }else if(t.turnNo===2){
    t.restrict=1;
    coachShow('You rolled a 5 — and the CPU has a 5 in their middle column. Place yours in YOUR middle column to destroy theirs!');
  }else if(t.turnNo===3){
    coachShow('Boom. That is the whole game: stack matches, smash theirs. Finish the round — highest total wins.');
  }else{
    coachHide();
  }
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

async function nextTurn(){
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
    startTimer();
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

async function flyDie(who,col,die){
  const stage=$('#dieStage');
  const src=stage.firstElementChild;
  if(!src) return;
  const from=src.getBoundingClientRect();
  const idx=S.boards[who][col].length;
  const target=slotEl(who,col,slotIdx(who,idx));
  const to=target.getBoundingClientRect();
  const ghost=makeDie(die,who);
  if(faceRotated(who)) ghost.classList.add('p2flip');
  ghost.style.position=EMBED?'absolute':'fixed';
  const gx=EMBED?rootRect():{left:0,top:0};
  ghost.style.left=(from.left-gx.left)+'px';
  ghost.style.top=(from.top-gx.top)+'px';
  ghost.style.width=from.width+'px';
  ghost.style.height=from.height+'px';
  ghost.style.setProperty('--cell',from.width+'px');
  ghost.style.zIndex='60';
  (EMBED?kbroot():document.body).appendChild(ghost);
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

async function destroyAt(who,col,die){
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

async function place(who,col){
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
function newGame(opts){
  const tutorial = !!(opts && opts.tutorial);
  S.gen++;
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
  S.boards=[[[],[],[]],[[],[],[]]];
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
  hide('#ovEnd'); hide('#ovStart'); hide('#ovRules'); hide('#ovPass');
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

/* ===================== OVERLAYS ===================== */
function show(sel){ $(sel).classList.add('on'); }
function hide(sel){ $(sel).classList.remove('on'); }

/* ===================== LAYOUT FIT ===================== */
function fit(){
  const app=EMBED?kbroot():$('#app');
  const w=app.clientWidth, h=app.clientHeight;
  const land = w>h && h<560;                 // short and wide: phone on its side
  document.documentElement.classList.toggle('land', land);
  let cell;
  if(land){
    // one board tall: hud + plate + 3 cells; one board wide: 6 cells + 2 chip
    // strips + the centre stage
    const byH = Math.floor((h - 28 - 20 - 2*6 - 14) / 3);
    const byW = Math.floor((w - 2*30 - 116 - 40) / 6);
    cell = Math.max(34, Math.min(byH, byW, 84));   // capped so it isn't edge-to-edge
  }else{
    const lane = S.tut ? 15 : 4;               // preview-pill lane is tutorial-only
    const fixed = 34 + 2*24 + 2*20 + 4*5 + 94 + 26 + 2*lane + 12;
    const byH = Math.floor((h - fixed - 4*6) / 6);
    const byW = Math.floor((Math.min(w,430) - 20 - 2*6) / 3);
    cell = Math.max(38, Math.min(byH, byW, 88));
  }
  document.documentElement.style.setProperty('--cell', cell+'px');
}

/* ===================== INPUT ===================== */
/* ===================== INPUT BINDING =====================
   Embedded webviews are inconsistent about synthesising `click` from a touch.
   Bind pointerdown / touchstart / click and de-duplicate, so a tap registers
   on whichever of the three the host actually delivers. */
function tap(el,fn){
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
function clearPress(){
  if(pressedCol) pressedCol.classList.remove('press');
  pressedCol=null;
}
function boardDown(e){
  const col=e.target.closest && e.target.closest('.col');
  clearPress();
  if(!playableCol(col)) return;
  pressedCol=col;
  col.classList.add('press');
}
function boardUp(e){
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
function commitColumn(col){
  if(!col) return;
  const who=ownerOf(col.closest('.side'));
  if(S.phase!=='choose' || S.busy || who!==S.turn) return;
  if(S.mode==='cpu' && who!==ME) return;
  const c=+col.dataset.col;
  if(S.tut && S.tut.restrict!=null && c!==S.tut.restrict){
    col.classList.add('nope'); setTimeout(()=>col.classList.remove('nope'),340);
    Sfx.tap(); return;                       // the lesson wants a specific column
  }
  if(S.boards[who][c].length>=3){
    col.classList.add('nope'); setTimeout(()=>col.classList.remove('nope'),340); Sfx.tap(); return;
  }
  Sfx.tap();
  place(who,c);
}

/* ===================== BOOT ===================== */
export function boot(embed){
  EMBED=!!embed;
  loadStats();
  buildBoards();
  fit();
  applySides();
  updateRecord();
  syncSettingsUI();
  updateStatLine();
  updateResumeButton();
  // decorative dice on start screen
  const row=$('#startDice');
  [6,3,5].forEach((v,i)=>{ const d=makeDie(v,i===1?AI:ME); row.appendChild(d); });

  const table=$('#tableEl');
  let sawPointer=false;
  if(window.PointerEvent){
    table.addEventListener('pointerdown',e=>{ sawPointer=true; boardDown(e); });
    table.addEventListener('pointerup',boardUp);
    table.addEventListener('pointercancel',clearPress);
  }else if('ontouchstart' in window){
    table.addEventListener('touchstart',e=>{ sawPointer=true; boardDown({target:e.target}); },{passive:true});
    table.addEventListener('touchend',e=>{
      const t=e.changedTouches && e.changedTouches[0];
      boardUp(t?{clientX:t.clientX,clientY:t.clientY,target:e.target}:{target:e.target});
    });
    table.addEventListener('touchcancel',clearPress);
  }
  // only used where neither pointer nor touch events arrive at all
  // only used where neither pointer nor touch events arrive at all
  table.addEventListener('click',e=>{
    if(sawPointer) return;
    commitColumn(e.target.closest && e.target.closest('.col'));
  });

  tap($('#ovPass'),e=>{
    if(e && e.target && e.target.closest && e.target.closest('#passQuit')) return;
    if(passResolve){ const f=passResolve; passResolve=null; f(); }
  });
  tap($('#passQuit'),()=>{ Sfx.tap(); toMenu(); });
  tap($('#btnResume'),()=>{ Sfx.unlock(); Sfx.tap(); resumeGame(); });
  tap($('#btnTut'),()=>{ Sfx.unlock(); Sfx.tap(); newGame({tutorial:true}); });
  tap($('#btnSettings'),()=>{ Sfx.tap(); show('#ovSettings'); });
  tap($('#btnCloseSettings'),()=>{ Sfx.tap(); hide('#ovSettings'); });
  tap($('#btnHow2'),()=>{ Sfx.tap(); hide('#ovSettings'); show('#ovRules'); });
  let resetArmed=0;
  tap($('#btnResetStats'),()=>{
    const b=$('#btnResetStats');
    if(Date.now()-resetArmed<3000){                    // second tap: actually wipe
      S.wins=S.losses=S.draws=S.p1=S.p2=S.ties=S.best=0;
      saveStats(); updateRecord(); updateStatLine(); syncSettingsUI();
      resetArmed=0; b.textContent='Record cleared';
      setTimeout(()=>{ b.textContent='Reset record'; },1500);
    }else{
      resetArmed=Date.now(); b.textContent='Tap again to confirm';
      setTimeout(()=>{ if(resetArmed && Date.now()-resetArmed>=2900){
        b.textContent='Reset record'; resetArmed=0; } },3000);
    }
    Sfx.tap();
  });
  tap($('#coach'),()=>{
    if(coachResolve){ const f=coachResolve; coachResolve=null; coachHide(); Sfx.tap(); f(); }
  });


  const bindSeg=(sel,key,apply)=>tap($(sel),e=>{
    const b=e.target.closest && e.target.closest('button'); if(!b) return;
    apply(b.dataset[key]);
    syncSettingsUI(); updateRecord(); saveStats();
    Sfx.unlock(); Sfx.tap();
  });
  bindSeg('#modeSeg','m', v=>{ S.mode=v; });
  bindSeg('#diffSeg','d', v=>{ S.diff=v; });
  bindSeg('#timerSeg','t',v=>{ S.timer=+v; });
  bindSeg('#seatSeg','seat',v=>{ S.seat=v; });
  bindSeg('#sndSeg','s',  v=>{ S.sound=v==='1'; });
  bindSeg('#faceSeg','f', v=>{ S.numerals=v==='nums'; });
  tap($('#btnPlay'),()=>{ Sfx.unlock(); Sfx.tap(); newGame(); });
  tap($('#btnAgain'),()=>{ Sfx.tap(); newGame(); });
  tap($('#btnMenu2'),()=>{ Sfx.tap(); hide('#ovEnd'); updateResumeButton(); show('#ovStart'); });
  tap($('#btnMenu'),()=>{ Sfx.tap(); toMenu(); });
  tap($('#btnHow'),()=>{ Sfx.tap(); show('#ovRules'); });
  tap($('#btnCloseRules'),()=>{ Sfx.tap(); hide('#ovRules'); });

  // desktop: 1/2/3 place, Enter starts / replays
  document.addEventListener('keydown',e=>{
    if(EMBED && !kbroot()) return;   // widget removed from the host page
    if(e.key==='1'||e.key==='2'||e.key==='3'){
      const c=+e.key-1, who=S.turn;
      if(S.phase==='choose' && !S.busy && (S.mode==='duo' || who===ME)){
        commitColumn(colEl(who,c));          // same gate as touch: full, restriction, sfx
      }
    }else if(e.key==='Enter'||e.key===' '){
      if($('#ovPass').classList.contains('on')) $('#ovPass').click();
      else if($('#ovStart').classList.contains('on')||$('#ovEnd').classList.contains('on')){ Sfx.unlock(); newGame(); }
    }else if(e.key==='Escape'){ hide('#ovRules'); hide('#ovSettings'); }
  });

  window.addEventListener('resize',fit);
  window.addEventListener('orientationchange',()=>setTimeout(fit,120));
  if(window.ResizeObserver) new ResizeObserver(fit).observe($('#app'));
  if(EMBED) kbroot().addEventListener('contextmenu',e=>e.preventDefault());
  else document.addEventListener('gesturestart',e=>e.preventDefault());

  // Offline support. Only registers from http(s); opening the file directly
  // still plays, it just can't install.
  if(!EMBED && 'serviceWorker' in navigator && location.protocol.indexOf('http')===0){
    window.addEventListener('load',()=>{
      navigator.serviceWorker.register('sw.js').then(reg=>{
        // nudge iOS to look for a fresh version whenever the app comes back
        document.addEventListener('visibilitychange',()=>{
          if(document.visibilityState==='visible') reg.update().catch(()=>{});
        });
      }).catch(()=>{});
    });
  }
}

/* ---- test hooks (harmless in normal play) ---- */
/* ---- test hooks (harmless in normal play; suites drive the game through these) ---- */
export function hooks(){
  return { S, colScore, boardTotal, search, searchRoot, aiChoose, newGame, place, isFull,
                applyMove, cloneSt, riskOf, getW:()=>RISK_W, setW:w=>{RISK_W=w}, nodes:()=>NODES,
                sideKey, applySides, renderAll, showHints, setStageDie, setStatus, setActivePlate, nameOf,
                loadGame, saveGame, clearGame, resumeGame, burst, reduced:REDUCED, fit };
}
