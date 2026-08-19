// The reference library: one scrolling sheet of cards, used for every roster
// the game has. Game modes and spells are the same screen wearing different
// clothes — an icon, a name, a one-liner and the full rule — so they are ONE
// component with a spec, not two views that drift apart.
//
// Offline module by design: both registries live in core, so nothing here
// needs the online chunk.
import { MODES } from '../core/modes.ts';
import { SPELLS } from '../core/spells.ts';
import { modeIcon, modeHue } from './modeicons.ts';
import { spellIcon, spellHue } from './spellicons.ts';
import { $, show, hide } from './dom.ts';
import { Sfx } from './audio.ts';

export interface LibraryItem { id: string; name: string; blurb: string; detail: string; hue: string; icon: string }
export interface LibrarySpec { id: string; title: string; items: LibraryItem[] }

/* the two rosters, each a spec of the one library */
const MODE_LIB: LibrarySpec = {
  id: 'ovModes', title: 'GAME MODES',
  items: MODES.map((m) => ({ id: m.id, name: m.name, blurb: m.blurb, detail: m.detail,
                             hue: modeHue(m.id), icon: modeIcon(m.id, 22) })),
};
const SPELL_LIB: LibrarySpec = {
  id: 'ovSpells', title: 'SPELLS',
  items: SPELLS.map((s) => ({ id: s.id, name: s.name, blurb: s.blurb, detail: s.detail,
                              hue: spellHue(s.id), icon: spellIcon(s.id, 22) })),
};

const built = new Set<string>();
function build(spec: LibrarySpec): void {
  if (built.has(spec.id)) return;
  built.add(spec.id);
  const cards = spec.items.map((it) => `
    <div class="modecard" data-mode="${it.id}" style="--mh:${it.hue}">
      <div class="mchead">${it.icon}<span class="mcname">${it.name}</span></div>
      <div class="mcblurb">${it.blurb}</div>
      <div class="mcdetail">${it.detail}</div>
    </div>`).join('');
  document.body.insertAdjacentHTML('beforeend', `
<div class="ov paged scrollview" id="${spec.id}">
  <div class="shead"><span class="pad"></span><span class="ttl">${spec.title}</span>
    <button class="ico" data-close="${spec.id}" aria-label="Close">✕</button></div>
  <div class="pbody neonscroll">
    <div class="modelist">${cards}</div>
  </div>
</div>`);
  $(`[data-close="${spec.id}"]`).addEventListener('click', () => { Sfx.tap(); hide('#' + spec.id); });
}

/* open a roster; a highlight id rings the entry currently in play */
function openLibrary(spec: LibrarySpec, highlight?: string): void {
  build(spec);
  document.querySelectorAll(`#${spec.id} .modecard`).forEach((el) =>
    el.classList.toggle('now', (el as HTMLElement).dataset.mode === highlight));
  show('#' + spec.id);
  document.querySelector(`#${spec.id} .modecard.now`)?.scrollIntoView({ block: 'center' });
}

export const openModes = (highlight?: string): void => openLibrary(MODE_LIB, highlight);
export const openSpells = (highlight?: string): void => openLibrary(SPELL_LIB, highlight);
