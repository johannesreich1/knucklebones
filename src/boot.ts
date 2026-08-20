// @ts-nocheck -- moved verbatim from the monolith; typed in the milestone-D
// strictness ratchet. New code goes in typed modules, not here.
// Wire the DOM to the game: one boot per entry point.
export function refreshHomeChip(): void {
  const chip = document.getElementById('homeChip');
  if (!chip) return;
  try {
    const p = JSON.parse(localStorage.getItem('knucklebones.online.profile') || 'null');
    if (p && p.nickname) {
      // the identity plate: the profile's ring at chip size, filled to the same
      // groupFill the account screen shows large — one ladder, two zoom levels
      const pts = p.rating ?? 0;
      chip.classList.remove('anon');
      chip.innerHTML = '<span class="ringwrap mini"><i class="lring"></i><span class="pav"></span></span>'
        + '<span class="nm2"></span><span class="meta2"><span class="gl"></span><b></b></span>'
        + '<span class="chev">›</span>';
      (chip.querySelector('.ringwrap') as HTMLElement).style.setProperty('--p', String(groupFill(pts)));
      paintAvatar(chip.querySelector('.pav') as HTMLElement, p.avatar, 18);
      (chip.querySelector('.nm2') as HTMLElement).textContent = p.nickname;
      (chip.querySelector('.gl') as HTMLElement).textContent = rankName(pts);
      (chip.querySelector('.meta2 b') as HTMLElement).textContent = Number(pts).toLocaleString('en');
      return;
    }
  } catch { /* fall through to anon */ }
  chip.classList.add('anon');
  chip.innerHTML = '<span class="ringwrap mini"><i class="lring"></i></span>NOT SIGNED IN';
}
import { SPEC } from './core/rules.ts';
import { groupFill, rankName } from './core/ladder.ts';
import { paintAvatar } from './ui/avatar.ts';
import { AI, ME, S } from './state.ts';
import { loadStats, saveStats } from './persist.ts';
import { Sfx } from './ui/audio.ts';
import { setEmbed, isEmbed, kbroot } from './ui/embed.ts';
import { $, show, hide, colEl } from './ui/dom.ts';
import { makeDie } from './ui/die.ts';
import { buildBoards, applySides, updateRecord } from './ui/render.ts';
import { fit } from './ui/layout.ts';
import { tap, boardDown, boardUp, clearPress, commitColumn } from './ui/input.ts';
import { coachTap } from './flow/tutorial.ts';
import { newGame, startLocal, passTap } from './flow/game.ts';
import { stampBuild } from './ui/dom.ts';
import { castArmed, disarm, renderSpells } from './flow/spells.ts';
import { bindEnd } from './ui/endscreen.ts';
import { toMenu, syncSettingsUI, updateStatLine } from './flow/menu.ts';
import { requestLeave, leavingForfeits } from './flow/leave.ts';
import { openModes, openSpells, pickerButtons, MODE_PICKS, SPELL_PICKS } from './ui/library.ts';
import { isNewcomer } from './ui/firstrun.ts';
import { ask, dismissAsk } from './ui/askcard.ts';
/* ===================== BOOT ===================== */
export function boot(embed){
  setEmbed(!!embed);
  loadStats();
  // the deploy-truth tag: stamped on <html> by build.mjs (stays "dev" in dev
  // and in the widget, which deliberately has no data-build)
  stampBuild();
  buildBoards();
  fit();
  applySides();
  updateRecord();
  syncSettingsUI();
  updateStatLine();
  // the hero duel: you (cyan) vs them (magenta), gold VS between
  const duel=$('#homeDuel');
  duel.insertBefore(makeDie(5,ME), duel.firstChild);
  duel.appendChild(makeDie(3,AI));
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
  const openPractice=(mode)=>{ if(mode) S.mode=mode; saveStats(); syncSettingsUI();
    updateStatLine(); hide('#ovStart'); show('#ovPractice'); };
  tap($('#btnVsCpu'),()=>{ Sfx.unlock(); Sfx.tap(); openPractice('cpu'); });
  tap($('#btnDuoHome'),()=>{ Sfx.unlock(); Sfx.tap(); openPractice('duo'); });
  /* HOW TO PLAY is a hub, not a link: the tutorial, the rules, the modes and
     the spells were four entry points scattered across home and settings. */
  tap($('#btnLearn'),()=>{ Sfx.unlock(); Sfx.tap();
    // the tutorial is only the headline act until a game has been played
    $('#ovLearn').classList.toggle('fresh', isNewcomer());
    hide('#ovStart'); show('#ovLearn'); });
  tap($('#btnLearnBack'),()=>{ Sfx.tap(); hide('#ovLearn'); show('#ovStart'); });
  tap($('#btnLearnTut'),()=>{ Sfx.unlock(); Sfx.tap(); newGame({tutorial:true}); });
  tap($('#btnLearnRules'),()=>{ Sfx.tap(); show('#ovRules'); });
  tap($('#btnLearnModes'),()=>{ Sfx.tap(); openModes(); });
  tap($('#btnLearnSpells'),()=>{ Sfx.tap(); openSpells(); });
  /* the two the law requires — reachable, never in the way */
  tap($('#btnImprint'),()=>{ Sfx.tap(); show('#ovImprint'); });
  tap($('#btnPrivacy'),()=>{ Sfx.tap(); show('#ovPrivacy'); });
  for(const id of ['Imprint','Privacy']){
    tap($('#btnClose'+id),()=>{ Sfx.tap(); hide('#ov'+id); });
    tap($('#btnClose'+id+'2'),()=>{ Sfx.tap(); hide('#ov'+id); });
  }
  tap($('#btnPracticeBack'),()=>{ Sfx.tap(); hide('#ovPractice'); show('#ovStart'); });
  /* The HUD's only control, and mid-match the only thing it can usefully offer
     is the way out — asked once, plainly, with a way back. Sound and dice faces
     live on Settings, which is reachable from home where nothing is at stake. */
  tap($('#btnLeave'),async ()=>{
    Sfx.tap();
    const ranked=leavingForfeits();
    const go=await ask({
      head: ranked ? 'Forfeit this match?' : 'Quit this game?',
      body: ranked
        ? 'Leaving a ranked match loses it, and the points go with it.'
        : 'The board is lost — offline games are quick, and this one ends here.',
      confirm: ranked ? 'Forfeit' : 'Quit game',
      cancel: 'Keep playing',
    });
    if(go){ requestLeave(); toMenu(); }
  });
  tap($('#btnCloseSettings'),()=>{ Sfx.tap(); hide('#ovSettings'); });
  /* A coach bubble that is WAITING is dismissed by a tap anywhere, not only by
     a tap on the bubble — the message says "tap to continue" and the player
     reasonably taps the screen. Capture phase so it lands before anything else
     interprets the same tap; coachTap is a no-op unless something is waiting. */
  tap($('#coach'),coachTap);
  document.addEventListener('pointerdown',coachTap,true);


  const bindSeg=(sel,key,apply)=>tap($(sel),e=>{
    const b=e.target.closest && e.target.closest('button'); if(!b) return;
    apply(b.dataset[key]);
    syncSettingsUI(); updateRecord(); saveStats();
    Sfx.unlock(); Sfx.tap();
  });
  /* The OFFLINE view's icon pickers. ONE component, two rows: a strip of
     hued icon buttons plus the line under it that names the current choice.
     Items are {v, hue, icon, name, blurb}; the caller owns where the value
     lives, so game mode and spell differ by their list and nothing else. */
  const pickerRow=(sel,items,read,write)=>{
    const strip=$(sel), info=$(sel+'Info');
    strip.innerHTML=pickerButtons(items);   // one button shape, here and on the cards
    const sync=()=>{
      const cur=String(read());
      strip.querySelectorAll('button').forEach(b=>b.classList.toggle('on', b.dataset.v===cur));
      const it=items.find(i=>i.v===cur) || items[0];
      info.textContent=it.name+' — '+it.blurb;
    };
    tap(strip,e=>{
      const b=e.target.closest && e.target.closest('button'); if(!b) return;
      write(b.dataset.v); saveStats(); sync();
      Sfx.unlock(); Sfx.tap();
    });
    sync();
    return sync;
  };
  // both rosters live in ui/library.ts beside the reference sheet's — one place
  // that knows what a mode is called and what it promises, whichever screen asks
  pickerRow('#modePick', MODE_PICKS, ()=>S.localMode, v=>{ S.localMode=+v; });
  pickerRow('#spellPick', SPELL_PICKS, ()=>S.spell, v=>{ S.spell=v; disarm(); renderSpells(); });

  bindSeg('#modeSeg','m', v=>{ S.mode=v; });
  bindSeg('#diffSeg','d', v=>{ S.diff=v; });
  bindSeg('#timerSeg','t',v=>{ S.timer=+v; });
  bindSeg('#seatSeg','seat',v=>{ S.seat=v; });
  bindSeg('#sndSeg','s',  v=>{ S.sound=v==='1'; });
  bindSeg('#faceSeg','f', v=>{ S.numerals=v==='nums'; });
  tap($('#btnPlay'),()=>{ Sfx.unlock(); Sfx.tap(); void startLocal(); });
  bindEnd();       // the result screen binds its own actions, once (ui/endscreen)
  // quit lives at the bottom of the Settings sheet; an online match intercepts
  // the first tap to arm its two-tap forfeit confirm on the button itself
  // the HUD badge opens the rules of whatever mode it names. ONE binding serves
  // both flows: whoever paints the badge sets data-mode (see render.paintBadge),
  // so this affordance can never go missing on one side again.
  tap($('#rec'),()=>{ const id=$('#rec').dataset.mode; if(!id) return; Sfx.tap(); openModes(id); });
  // online module (auth, ladder, account) is lazy: the offline game's boot
  // path must never load supabase-js or anything that talks to a backend
  tap($('#btnOnline'),()=>{ Sfx.unlock(); Sfx.tap();
    import('./online/ui.ts').then(m=>m.openOnline('play')); });
  tap($('#btnBoardHome'),()=>{ Sfx.unlock(); Sfx.tap();
    import('./online/ui.ts').then(m=>m.openOnline('board')); });
  tap($('#btnSettingsHome'),()=>{ Sfx.unlock(); Sfx.tap(); show('#ovSettings'); });
  tap($('#homeChip'),()=>{ Sfx.unlock(); Sfx.tap();
    import('./online/ui.ts').then(m=>m.openOnline('account')); });
  tap($('#btnCloseRules'),()=>{ Sfx.tap(); hide('#ovRules'); });

  // desktop: 1/2/3 place, Enter starts / replays
  document.addEventListener('keydown',e=>{
    if(isEmbed() && !kbroot()) return;   // widget removed from the host page
    const colKey=+e.key;
    if(colKey>=1 && colKey<=SPEC.cols){
      const c=colKey-1, who=S.turn;
      if(castArmed(c)) return;               // an armed spell takes the key first
      if(S.phase==='choose' && !S.busy && (S.mode==='duo' || who===ME)){
        commitColumn(colEl(who,c));          // same gate as touch: full, restriction, sfx
      }
    }else if(e.key==='Enter'||e.key===' '){
      if($('#ovPass').classList.contains('on')) $('#ovPass').click();
      else if($('#ovStart').classList.contains('on')||$('#ovEnd').classList.contains('on')){ Sfx.unlock(); void startLocal(); }
    }else if(e.key==='Escape'){ disarm(); hide('#ovRules'); hide('#ovSettings'); hide('#ovLearn'); dismissAsk(); hide('#ovImprint'); hide('#ovPrivacy');
      for(const id of ['ovModes','ovSpells']) if(document.getElementById(id)) hide('#'+id); }
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

  // Stale-client self-heal: a cached page can reference hashed chunks that a
  // newer deploy deleted (bit a phone after a rapid-deploy day — the app died
  // with a loading error). Reload ONCE per session to fetch the fresh page;
  // the flag stops a reload loop if the network itself is the problem.
  window.addEventListener('vite:preloadError', (e)=>{
    e.preventDefault();
    try{
      if(sessionStorage.getItem('kb.chunkReload')) return;
      sessionStorage.setItem('kb.chunkReload','1');
    }catch{ /* forgetful host */ }
    location.reload();
  });
  setTimeout(()=>{ try{ sessionStorage.removeItem('kb.chunkReload'); }catch{} },15000);


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
