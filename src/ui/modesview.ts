// The game-modes library: every wheel slice with its icon, odds and full rule.
// Reached from the home footer and by tapping the in-match badge (which
// highlights the mode being played). Offline module — the registry is core,
// so the list needs nothing from the online chunk.
import { MODES } from '../core/modes.ts';
import { modeIcon, modeHue } from './modeicons.ts';
import { $, show, hide } from './dom.ts';
import { Sfx } from './audio.ts';

let built = false;
function build(): void {
  if (built) return;
  built = true;
  const cards = MODES.map((m) => `
    <div class="modecard" data-mode="${m.id}" style="--mh:${modeHue(m.id)}">
      <div class="mchead">${modeIcon(m.id, 22)}<span class="mcname">${m.name}</span></div>
      <div class="mcblurb">${m.blurb}</div>
      <div class="mcdetail">${m.detail}</div>
    </div>`).join('');
  document.body.insertAdjacentHTML('beforeend', `
<div class="ov paged scrollview" id="ovModes">
  <div class="shead"><span class="pad"></span><span class="ttl">GAME MODES</span>
    <button class="ico" id="btnCloseModes" aria-label="Close">✕</button></div>
  <div class="pbody">
    <div class="tiny">Every ranked match spins the wheel — these are the slices</div>
    <div class="modelist">${cards}</div>
  </div>
</div>`);
  $('#btnCloseModes').addEventListener('click', () => { Sfx.tap(); hide('#ovModes'); });
}

/* open the library; a highlight id rings the mode currently being played */
export function openModes(highlight?: string): void {
  build();
  document.querySelectorAll('#ovModes .modecard').forEach((el) =>
    el.classList.toggle('now', (el as HTMLElement).dataset.mode === highlight));
  show('#ovModes');
  document.querySelector('#ovModes .modecard.now')?.scrollIntoView({ block: 'center' });
}
