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
/* What each level actually does, not how it feels — the numbers come straight
   from aiChoose() in flow/game.ts, and must be corrected there and here
   together. */
const DIFF_NOTE = {
  easy:   'Half its moves are random, and it never sees a threat coming',
  medium: 'Looks two moves ahead and avoids the obvious traps',
  hard:   'Searches four moves deep — five when the phone keeps up',
};
function segOn(sel,key,val){
  document.querySelectorAll(sel+' button').forEach(b=>b.classList.toggle('on', b.dataset[key]===val));
}
/* single source of truth for "what the title screen should look like right now" */
export function syncSettingsUI(){
  const duo = S.mode==='duo';
  $('#diffCard').hidden  = duo;
  $('#seatCard').hidden  = !duo;
  $('#timerCard').hidden = !duo;
  /* each note explains the control it sits under, and both cards carry one so
     the swap between them cannot change this slot's height */
  $('#duoNote').textContent = S.seat==='face'
    ? 'Phone flat between you — the top half faces Player 2'
    : 'One phone, passed back and forth';
  $('#diffNote').textContent = DIFF_NOTE[S.diff] ?? DIFF_NOTE.medium;
  segOn('#modeSeg','m',S.mode);
  segOn('#diffSeg','d',S.diff);
  segOn('#timerSeg','t',String(S.timer));
  segOn('#seatSeg','seat',S.seat);
  segOn('#sndSeg','s', S.sound?'1':'0');
  segOn('#faceSeg','f', S.numerals?'nums':'pips');
  document.documentElement.classList.toggle('numerals',S.numerals);
  renderSpells();     // the rail follows whatever hand the current game holds
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
