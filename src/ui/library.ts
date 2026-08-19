// The reference library: one scrolling sheet of cards, used for every roster
// the game has. Game modes and spells are the same screen wearing different
// clothes — an icon, a name, a one-liner and the full rule — so they are ONE
// component with a spec, not two views that drift apart.
//
// Offline module by design: both registries live in core, so nothing here
// needs the online chunk.
import { MODES, RANDOM } from '../core/modes.ts';
import { SPELLS } from '../core/spells.ts';
import { modeIcon, modeHue } from './modeicons.ts';
import { spellIcon, spellHue } from './spellicons.ts';
import { $, show, hide } from './dom.ts';
import { Sfx } from './audio.ts';

export interface LibraryItem { id: string; name: string; blurb: string; detail: string; hue: string; icon: string }
export interface LibrarySpec { id: string; title: string; items: LibraryItem[] }

/* the two rosters, each a spec of the one library. Exported because the design
   cards render them through this very function (design/build.mjs, {{library}}):
   a card that re-typed a mode's blurb would be a fifth copy of the registry. */
export const MODE_LIB: LibrarySpec = {
  id: 'ovModes', title: 'GAME MODES',
  items: MODES.map((m) => ({ id: m.id, name: m.name, blurb: m.blurb, detail: m.detail,
                             hue: modeHue(m.id), icon: modeIcon(m.id, 22) })),
};
export const SPELL_LIB: LibrarySpec = {
  id: 'ovSpells', title: 'SPELLS',
  items: SPELLS.map((s) => ({ id: s.id, name: s.name, blurb: s.blurb, detail: s.detail,
                              hue: spellHue(s.id), icon: spellIcon(s.id, 22) })),
};

/* A roster as markup. Pure, so the design build renders the real thing rather
   than a transcription of it; `now` is the entry currently in play, which the
   app toggles live and a still has to bake in. */
export const libraryCards = (spec: LibrarySpec, now?: string): string =>
  spec.items.map((it) => `
    <div class="modecard${it.id === now ? ' now' : ''}" data-mode="${it.id}" style="--mh:${it.hue}">
      <div class="mchead">${it.icon}<span class="mcname">${it.name}</span></div>
      <div class="mcblurb">${it.blurb}</div>
      <div class="mcdetail">${it.detail}</div>
    </div>`).join('');

/* The two PICK rows, as data. Same roster knowledge as the library above, at a
   smaller icon size, plus the entries that exist only as a choice: RANDOM,
   which is not a mode but a promise to spin for one, and NONE, the pure game.
   `v` is what the caller stores — the numeric mode, or the spell's id.
   Exported for the design cards too ({{picker}}), so a card cannot offer a
   roster the game does not. */
export interface PickItem { v: string; id: string; name: string; blurb: string; hue: string; icon: string }
export const MODE_PICKS: PickItem[] = [
  ...MODES.map((m) => ({ v: String(m.mode), id: m.id, name: m.name, blurb: m.blurb, hue: modeHue(m.id), icon: modeIcon(m.id, 16) })),
  { v: String(RANDOM), id: 'random', name: 'RANDOM', hue: modeHue('random'), icon: modeIcon('random', 16),
    blurb: 'The dial decides — ranked\u2019s odds, spun in front of you.' },
];
export const SPELL_PICKS: PickItem[] = [
  { v: '', id: 'none', name: 'NONE', blurb: 'No spells — the pure game.', hue: spellHue('none'), icon: spellIcon('none', 16) },
  ...SPELLS.map((s) => ({ v: s.id, id: s.id, name: s.name, blurb: s.blurb, hue: spellHue(s.id), icon: spellIcon(s.id, 16) })),
];
/* one button shape for both rows — and for the cards that picture them */
export const pickerButtons = (items: PickItem[], now?: string): string => items.map((it) =>
  `<button type="button"${it.v === now ? ' class="on"' : ''} data-v="${it.v}"`
  + ` style="--mh:${it.hue}" aria-label="${it.name}">${it.icon}</button>`).join('');

const built = new Set<string>();
function build(spec: LibrarySpec): void {
  if (built.has(spec.id)) return;
  built.add(spec.id);
  const cards = libraryCards(spec);
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
