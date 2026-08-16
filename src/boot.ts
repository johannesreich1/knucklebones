// @ts-nocheck -- moved verbatim from the monolith; typed in the milestone-D
// strictness ratchet. New code goes in typed modules, not here.
// Wire the DOM to the game: one boot per entry point.
import { SPEC } from './core/rules';
import { AI, ME, S } from './state';
import { loadStats, saveStats } from './persist';
import { Sfx } from './ui/audio';
import { setEmbed, isEmbed, kbroot } from './ui/embed';
import { $, show, hide, colEl } from './ui/dom';
import { makeDie } from './ui/die';
import { buildBoards, applySides, updateRecord } from './ui/render';
import { fit } from './ui/layout';
import { tap, boardDown, boardUp, clearPress, commitColumn } from './ui/input';
import { coachTap } from './flow/tutorial';
import { newGame, passTap } from './flow/game';
import { resumeGame, toMenu, syncSettingsUI, updateResumeButton, updateStatLine } from './flow/menu';
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

  tap($('#ovPass'),passTap);
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
  tap($('#btnMenu2'),()=>{ Sfx.tap(); hide('#ovEnd'); updateResumeButton(); show('#ovStart'); });
  tap($('#btnMenu'),()=>{ Sfx.tap(); toMenu(); });
  tap($('#btnHow'),()=>{ Sfx.tap(); show('#ovRules'); });
  tap($('#btnCloseRules'),()=>{ Sfx.tap(); hide('#ovRules'); });

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
    }else if(e.key==='Escape'){ hide('#ovRules'); hide('#ovSettings'); }
  });

  window.addEventListener('resize',fit);
  window.addEventListener('orientationchange',()=>setTimeout(fit,120));
  if(window.ResizeObserver) new ResizeObserver(fit).observe($('#app'));
  if(isEmbed()) kbroot().addEventListener('contextmenu',e=>e.preventDefault());
  else document.addEventListener('gesturestart',e=>e.preventDefault());

  // Offline support. Only registers from http(s); opening the file directly
  // still plays, it just can't install.
  if(!isEmbed() && 'serviceWorker' in navigator && location.protocol.indexOf('http')===0){
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
