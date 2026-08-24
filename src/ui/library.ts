// The reference library: one scrolling sheet of cards, used for every roster
// the game has. Game modes and spells are the same screen wearing different
// clothes — an icon, a name, a one-liner and the full rule — so they are ONE
// component with a spec, not two views that drift apart.
//
// Offline module by design: both registries live in core, so nothing here
// needs the online chunk.
import { MODES, RANDOM } from '../core/modes.ts';
import { SPELLS, RANDOM_SPELL } from '../core/spells.ts';
import { modeIcon, modeHue } from './modeicons.ts';
import { spellIcon, spellHue } from './spellicons.ts';
import { $, show } from './dom.ts';
import { showSheet } from './sheet.ts';
import { appRoot } from './embed.ts';
import { bindLearnPageBack, learnPageMarkup } from './learn-page.ts';

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
  id: 'ovSpells', title: 'RUNES',
  items: SPELLS.map((s) => ({ id: s.id, name: s.name, blurb: s.blurb, detail: s.detail,
                              hue: spellHue(s.id), icon: spellIcon(s.id, 22) })),
};

/* ONE ENTRY, AS MARKUP — the three lines every roster entry is made of. It is
   its own function because it has two homes now: the scrolling roster below,
   and the sheet the in-game badge deals for the single mode or rune in play
   (openEntry). A card that re-typed a blurb for the sheet would be the fifth
   copy of the registry; a sheet that styled its own heading would be the
   second voice. Both take this. */
export const libraryBody = (it: LibraryItem): string =>
  `<div class="mchead">${it.icon}<span class="mcname">${it.name}</span></div>
      <div class="mcblurb">${it.blurb}</div>
      <div class="mcdetail">${it.detail}</div>`;

/* A roster as markup. Pure, so the design build renders the real thing rather
   than a transcription of it; `now` is the entry currently in play, which the
   app toggles live and a still has to bake in. */
export const libraryCards = (spec: LibrarySpec, now?: string): string =>
  spec.items.map((it) => `
    <div class="modecard${it.id === now ? ' now' : ''}" data-mode="${it.id}" style="--mh:${it.hue}">
      ${libraryBody(it)}
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
  { v: '', id: 'none', name: 'NONE', blurb: 'No rune — the pure game.', hue: spellHue('none'), icon: spellIcon('none', 16) },
  ...SPELLS.map((s) => ({ v: s.id, id: s.id, name: s.name, blurb: s.blurb, hue: spellHue(s.id), icon: spellIcon(s.id, 16) })),
  /* last slice, exactly like the mode row's: a promise to draw, not a rune */
  { v: RANDOM_SPELL, id: 'random', name: 'RANDOM', hue: spellHue('random'), icon: spellIcon('random', 16),
    blurb: 'A rune drawn at the table — both players get the same one.' },
];
/* one button shape for both rows — and for the cards that picture them */
export const pickerButtons = (items: PickItem[], now?: string): string => items.map((it) =>
  `<button type="button"${it.v === now ? ' class="on"' : ''} data-v="${it.v}"`
  + ` style="--mh:${it.hue}" aria-label="${it.name}">${it.icon}</button>`).join('');

/* The sentence below either picker. Pure because product cards and runtime
   must resolve missing/current choices with the same fallback. */
export const pickInfo = (items: PickItem[], now?: string): string => {
  const item = items.find((candidate) => candidate.v === (now ?? '')) ?? items[0];
  return `${item.name} — ${item.blurb}`;
};

const built = new Set<string>();
function build(spec: LibrarySpec): void {
  if (built.has(spec.id)) return;
  built.add(spec.id);
  const cards = libraryCards(spec);
  appRoot().insertAdjacentHTML('beforeend', learnPageMarkup({
    id: spec.id,
    title: spec.title,
    body: `<div class="modelist">${cards}</div>`,
  }));
  bindLearnPageBack(spec.id);
}

/* open a roster; a highlight id rings the entry currently in play */
function openLibrary(spec: LibrarySpec, highlight?: string): void {
  build(spec);
  appRoot().querySelectorAll(`#${spec.id} .modecard`).forEach((el) =>
    el.classList.toggle('now', (el as HTMLElement).dataset.mode === highlight));
  show('#' + spec.id);
  appRoot().querySelector(`#${spec.id} .modecard.now`)?.scrollIntoView({ block: 'center' });
}

export const openModes = (highlight?: string): void => openLibrary(MODE_LIB, highlight);
export const openSpells = (highlight?: string): void => openLibrary(SPELL_LIB, highlight);

/* ---- ONE ENTRY, AS A SHEET (user call 2026-08-23) ----
   The in-game badge names what is in play; tapping a chip used to throw the
   WHOLE roster up as a full-screen overlay and leave the player to find the
   line they asked about. It deals that one entry instead, on the sheet the
   ladder's face-off rides in (ui/sheet), tinted in the mode's or the rune's
   own hue — the same --mh the roster card and the picker slice wear, so a new
   registry entry needs no code here at all. The rosters keep their overlay:
   HOW TO PLAY is where you go to read them ALL. */
const LIBS: Record<string, LibrarySpec> = { modes: MODE_LIB, spells: SPELL_LIB };
export function openEntry(lib: string, id: string): boolean {
  const it = LIBS[lib]?.items.find((i) => i.id === id);
  if (!it) return false;   // a chip naming something the registry retired opens nothing
  showSheet({ cls: 'libsheet', label: it.name, tint: it.hue, body: libraryBody(it) });
  return true;
}
