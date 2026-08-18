// @ts-nocheck -- moved verbatim from the monolith; typed in the milestone-D
// strictness ratchet. New code goes in typed modules, not here.
// Wire the DOM to the game: one boot per entry point.
export function refreshHomeChip(): void {
  const chip = document.getElementById('homeChip');
  if (!chip) return;
  try {
    const p = JSON.parse(localStorage.getItem('knucklebones.online.profile') || 'null');
    if (p && p.nickname) {
      chip.classList.remove('anon');
      chip.innerHTML = 'PLAYING AS <b></b> · <span class="rt"></span>';
      (chip.querySelector('b') as HTMLElement).textContent = p.nickname;
      (chip.querySelector('.rt') as HTMLElement).textContent = String(p.rating ?? '');
      return;
    }
  } catch { /* fall through to anon */ }
  chip.classList.add('anon');
  chip.textContent = 'NOT SIGNED IN';
}
import { SPEC } from './core/rules.ts';
import { AI, ME, S } from './state.ts';
import { loadStats, saveStats } from './persist.ts';
import { Sfx } from './ui/audio.ts';
import { setEmbed, isEmbed, kbroot } from './ui/embed.ts';
import { $, show, hide, colEl } from './ui/dom.ts';
import { makeDie } from './ui/die.ts';
import { buildBoards, applySides, updateRecord } from './ui/render.ts';
import { fit } from './ui/layout.ts';
import { tap, boardDown, boardUp, clearPress, commitColumn } from './ui/input.ts';
import { initInstall } from './ui/install.ts';
import { coachTap } from './flow/tutorial.ts';
import { newGame, passTap } from './flow/game.ts';
import { resumeGame, toMenu, syncSettingsUI, updateResumeButton, updateStatLine } from './flow/menu.ts';
import { requestLeave } from './flow/leave.ts';
import { openModes } from './ui/modesview.ts';
/* ===================== BOOT ===================== */
export function boot(embed){
  setEmbed(!!embed);
  loadStats();
  // the deploy-truth tag: stamped on <html> by build.mjs (stays "dev" in dev
  // and in the widget, which deliberately has no data-build)
  $('#buildTag').textContent = 'build ' + (document.documentElement.dataset.build || 'dev');
  buildBoards();
  fit();
  applySides();
  updateRecord();
  syncSettingsUI();
  updateStatLine();
  updateResumeButton();
  // the hero duel: you (cyan) vs them (magenta), gold VS between
  const duel=$('#homeDuel');
  duel.insertBefore(makeDie(5,ME), duel.firstChild);
  duel.appendChild(makeDie(3,AI));
  // decorative dice on the Practice tutorial tease and the install sheet's tile
  const tutDie=makeDie(4,ME); tutDie.classList.add('m2');
  $('#btnTut').insertBefore(tutDie, $('#btnTut').firstChild);
  $('#installFace').appendChild(makeDie(5,ME));
  refreshHomeChip();

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

  tap($('#ovPass'),passTap);
  tap($('#passQuit'),()=>{ Sfx.tap(); toMenu(); });
  tap($('#btnResume'),()=>{ Sfx.unlock(); Sfx.tap(); resumeGame(); });
  tap($('#btnTut'),()=>{ Sfx.unlock(); Sfx.tap(); newGame({tutorial:true}); });
  const openPractice=(mode)=>{ if(mode) S.mode=mode; saveStats(); syncSettingsUI();
    updateStatLine(); updateResumeButton(); hide('#ovStart'); show('#ovPractice'); };
  tap($('#btnVsCpu'),()=>{ Sfx.unlock(); Sfx.tap(); openPractice('cpu'); });
  tap($('#btnDuoHome'),()=>{ Sfx.unlock(); Sfx.tap(); openPractice('duo'); });
  tap($('#btnTutHome'),()=>{ Sfx.unlock(); Sfx.tap(); newGame({tutorial:true}); });
  tap($('#btnPracticeBack'),()=>{ Sfx.tap(); hide('#ovPractice'); show('#ovStart'); });
  tap($('#btnSettings'),()=>{ Sfx.tap(); show('#ovSettings'); });
  tap($('#btnCloseSettings'),()=>{ Sfx.tap(); hide('#ovSettings'); });
  tap($('#btnHow2'),()=>{ Sfx.tap(); hide('#ovSettings'); show('#ovRules'); });
  tap($('#coach'),coachTap);


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
  tap($('#btnMenu2'),()=>{ Sfx.tap(); hide('#ovEnd'); updateResumeButton(); show('#ovPractice'); });
  tap($('#btnEndHome'),()=>{ Sfx.tap(); hide('#ovEnd'); toMenu(); });
  // the HUD's ✕: an online match intercepts to arm its two-tap forfeit confirm
  tap($('#btnMenu'),()=>{ Sfx.tap(); if(requestLeave()) return; toMenu(); });
  tap($('#btnHow'),()=>{ Sfx.tap(); show('#ovRules'); });
  tap($('#btnModes'),()=>{ Sfx.tap(); openModes(); });
  // online module (auth, ladder, account) is lazy: the offline game's boot
  // path must never load supabase-js or anything that talks to a backend
  tap($('#btnOnline'),()=>{ Sfx.unlock(); Sfx.tap();
    import('./online/ui.ts').then(m=>m.openOnline('play')); });
  tap($('#btnBoardHome'),()=>{ Sfx.unlock(); Sfx.tap();
    import('./online/ui.ts').then(m=>m.openOnline('board')); });
  tap($('#btnAccountHome'),()=>{ Sfx.unlock(); Sfx.tap();
    import('./online/ui.ts').then(m=>m.openOnline('account')); });
  tap($('#btnCloseRules'),()=>{ Sfx.tap(); hide('#ovRules'); });
  tap($('#btnRulesOk'),()=>{ Sfx.tap(); hide('#ovRules'); });

  // desktop: 1/2/3 place, Enter starts / replays
  document.addEventListener('keydown',e=>{
    if(isEmbed() && !kbroot()) return;   // widget removed from the host page
    const colKey=+e.key;
    if(colKey>=1 && colKey<=SPEC.cols){
      const c=colKey-1, who=S.turn;
      if(S.phase==='choose' && !S.busy && (S.mode==='duo' || who===ME)){
        commitColumn(colEl(who,c));          // same gate as touch: full, restriction, sfx
      }
    }else if(e.key==='Enter'||e.key===' '){
      if($('#ovPass').classList.contains('on')) $('#ovPass').click();
      else if($('#ovStart').classList.contains('on')||$('#ovEnd').classList.contains('on')){ Sfx.unlock(); newGame(); }
    }else if(e.key==='Escape'){ hide('#ovRules'); hide('#ovSettings'); hide('#ovInstall');
      if(document.getElementById('ovModes')) hide('#ovModes'); }
  });

  window.addEventListener('resize',fit);
  window.addEventListener('orientationchange',()=>setTimeout(fit,120));
  if(window.ResizeObserver) new ResizeObserver(fit).observe($('#app'));
  if(isEmbed()) kbroot().addEventListener('contextmenu',e=>e.preventDefault());
  else {
    // iOS Safari ignores user-scalable=no: kill pinch at the gesture AND touch
    // layers, and double-tap at the dblclick layer (CSS manipulation is the
    // first line; this is the belt). Multi-finger preventDefault only —
    // single-finger scrolling (leaderboard) lives.
    document.addEventListener('gesturestart',e=>e.preventDefault());
    document.addEventListener('gesturechange',e=>e.preventDefault());
    document.addEventListener('touchmove',e=>{ if(e.touches.length>1) e.preventDefault(); },{passive:false});
    document.addEventListener('dblclick',e=>e.preventDefault(),{passive:false});
  }

  initInstall();

  // Offline support. Only registers from http(s); opening the file directly
  // still plays, it just can't install. NEVER on the Vite dev server — a
  // registered SW intercepts /src/ module fetches and serves stale code.
  if(!isEmbed() && 'serviceWorker' in navigator && location.protocol.indexOf('http')===0 && !import.meta.env.DEV){
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
