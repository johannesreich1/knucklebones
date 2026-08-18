// @ts-nocheck -- moved verbatim from the monolith; typed in the milestone-D
// strictness ratchet. New code goes in typed modules, not here.
// The title screen and settings panel: what they show. (Mid-game resume was
// removed by design 2026-08-18 — leaving an offline game simply ends it.)
import { S } from '../state.ts';
import { $, show, hide } from '../ui/dom.ts';
import { stopTimer } from './timer.ts';
import { clearTut } from './tutorial.ts';
import { cancelPass } from './game.ts';
import { renderSpells } from './spells.ts';
import { clearHints } from '../ui/render.ts';
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
  segOn('#spellSeg','sp', S.spellsOn?'1':'0');
  document.documentElement.classList.toggle('numerals',S.numerals);
  renderSpells();     // the rail appears/disappears the moment the toggle moves
}
/* leaving a game in progress ends it — offline games are quick by design */
export function toMenu(){
  S.gen++; S.phase='over';
  stopTimer(); clearTut(); clearHints();
  cancelPass(); hide('#ovPass');
  hide('#ovPractice'); hide('#ovSettings');
  show('#ovStart');
}
export function updateStatLine(){
  const el=$('#statLine');
  const played=S.wins+S.losses+S.draws;
  if(!played && !S.best){ el.hidden=true; return; }
  el.hidden=false;
  el.innerHTML = 'Best <b>'+S.best+'</b>' + (played? '  ·  Record '+S.wins+'–'+S.losses+(S.draws?('–'+S.draws):'') : '');
}
