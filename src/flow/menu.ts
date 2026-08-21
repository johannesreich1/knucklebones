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
  // name the game, not the verb: two players on one phone are playing a duel,
  // and the button is the last thing read before committing to one
  $('#btnPlay').textContent = duo ? 'Play duel' : 'Play vs AI';
  segOn('#modeSeg','m',S.mode);
  segOn('#diffSeg','d',S.diff);
  segOn('#timerSeg','t',String(S.timer));
  segOn('#seatSeg','seat',S.seat);
  segOn('#sndSeg','s', S.sound?'1':'0');
  segOn('#faceSeg','f', S.numerals?'nums':'pips');
  segOn('#cbSeg','b', S.colorblind?'1':'0');
  /* THE DUEL PAIR, applied. Colour blind mode overrides the display pair to
     cyan-vs-gold (the axis red-green colour vision keeps) without touching
     the stored picks; otherwise the pickers rule. The tokens land inline on
     <html>, where main.css's :root defaults yield to them. */
  const p1 = S.colorblind ? 'cy' : S.p1Hue;
  const p2 = S.colorblind ? 'gold' : S.p2Hue;
  const rs = document.documentElement.style;
  /* the heats ride along per SIDE: a ×2 wears gold and a ×3 hot orange —
     unless THIS side's player wears that hue, in which case only THEIR
     multiplied dice fall back (ice / hot red, main.css) so a doubled die
     can never pass for their plain one. The other side keeps the true
     heat — repointing both boards for one player's pick recoloured the
     whole game (user report, with screenshot). Covers colour blind mode
     too, whose pinned pair contains gold. */
  for (const [slot,h] of [['p1',p1],['p2',p2]]){
    rs.setProperty(`--${slot}`,      `var(--${h})`);
    rs.setProperty(`--${slot}-rgb`,  `var(--${h}-rgb)`);
    rs.setProperty(`--${slot}-hi`,   `var(--${h}-hi)`);
    const m2 = h==='gold'   ? 'ice' : 'gold';
    const m3 = h==='orange' ? 'red' : 'orange';
    rs.setProperty(`--${slot}-mx2`,     `var(--${m2})`);
    rs.setProperty(`--${slot}-mx2-rgb`, `var(--${m2}-rgb)`);
    rs.setProperty(`--${slot}-mx3`,     `var(--${m3})`);
    rs.setProperty(`--${slot}-mx3-rgb`, `var(--${m3}-rgb)`);
  }
  /* the pickers mirror the pair on screen: the shown pick is the EFFECTIVE
     one, the other side's colour is off the table (a colour belongs to one
     player), and colour blind mode locks both rows, the note saying why */
  const syncPick=(sel,mine,other)=>{
    document.querySelectorAll(sel+' button').forEach(b=>{
      b.classList.toggle('on', b.dataset.h===mine);
      b.disabled = S.colorblind || b.dataset.h===other;
      if (S.colorblind) b.setAttribute('aria-describedby','colNote');
      else b.removeAttribute('aria-describedby');
    });
  };
  syncPick('#p1Pick', p1, p2);
  syncPick('#p2Pick', p2, p1);
  $('#colNote').hidden = !S.colorblind;
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
