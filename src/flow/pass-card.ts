// The pass-the-phone hand-off: the face-down card and the behaviour behind it,
// under one owner. The turn machine asks for a hand-off and awaits the answer;
// when the card is up, what it shows, and what the single continue tap resolves
// are decided here. Its live name and scores stay locale-aware in place.
import { AI, ME, totalOf, type Player } from '../core/rules.ts';
import { formatNumber, t } from '../i18n/index.ts';
import { S } from '../state.ts';
import { Sfx, vibrate } from '../ui/audio.ts';
import { $, hide, show } from '../ui/dom.ts';
import { setStageDie } from '../ui/die.ts';
import { colorOf, nameOf } from '../ui/identity.ts';
import { clearHints } from '../ui/game/hints.ts';
import { applySides, setStatus } from '../ui/game/turn-state.ts';
import { stopTimer } from './timer.ts';

function scoreOf(player: Player): number {
  return totalOf(S.boards[player], S.bounty[player], S.scoring, S.charm.wards[player]);
}

function paint(who: Player): void {
  const color = colorOf(who);
  $('#ovPass').style.setProperty('--pc', color);
  const name = $('#passWho');
  name.textContent = nameOf(who);
  name.style.color = color;
  $('#passP1').textContent = formatNumber(scoreOf(ME));
  $('#passP2').textContent = formatNumber(scoreOf(AI));
}

function showPassCard(who: Player): void {
  paint(who);
  show('#ovPass');
}

function hidePassCard(): void {
  hide('#ovPass');
}

export function repaintPassLocale(): void {
  if (!$('#ovPass').classList.contains('on') || S.phase !== 'pass') return;
  paint(S.turn);
}

/* The pending continue: handOff arms it, passTap consumes it, cancelPass drops
   it. All three live here so there is only ever one of it. */
let passResolve: (() => void) | null = null;

/** Hold the turn until the phone changes hands; false means this game is stale. */
export function handOff(who: Player): Promise<boolean> {
  return new Promise<boolean>((resolve) => {
    const gen=S.gen;
    S.phase='pass';
    stopTimer();
    clearHints();
    setStageDie(0);
    setStatus(() => t('game', 'status.passPhone'), who);
    showPassCard(who);
    Sfx.pass();
    const go=()=>{
      hidePassCard();
      if(S.gen!==gen) { resolve(false); return; }
      S.bottom=who;
      applySides();
      const table=$('#tableEl');
      table.classList.remove('swap'); void table.offsetWidth; table.classList.add('swap');
      setTimeout(()=>table.classList.remove('swap'),480);
      Sfx.tap(); vibrate(10);
      resolve(true);
    };
    passResolve=go;      // consumed by the single listener bound in boot()
  });
}
/* the whole hand-off card is the one continue target; it has no corner control */
export function passTap(): void {
  if(passResolve){ const f=passResolve; passResolve=null; f(); }
}
/* abandoning mid-hand-off (quit to menu): drop the pending resolver */
export function cancelPass(): void { passResolve=null; }
