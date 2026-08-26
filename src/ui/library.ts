// The reference library: one scrolling sheet of cards, used for every roster
// the game has. Game modes and spells are the same screen wearing different
// clothes — an icon, a name, a one-liner and the full rule — so they are ONE
// component with a spec, not two views that drift apart.
//
// Offline module by design: both registries live in core, so nothing here
// needs the online chunk.
import { MODES, RANDOM } from '../core/modes.ts';
import { SPELLS, RANDOM_DUAL_SPELL, RANDOM_SPELL } from '../core/spells.ts';
import { RUNE_TRIAL_FORMAT, RUNE_TRIAL_PICK } from '../local-options.ts';
import { modeCopy, runeTrialCopy, spellCopy, subscribeLocale, t } from '../i18n/index.ts';
import { modeIcon, modeHue } from './modeicons.ts';
import { spellIcon, spellHue } from './spellicons.ts';
import { show } from './dom.ts';
import { showSheet } from './sheet.ts';
import { appRoot } from './embed.ts';
import { bindLearnPageBack, learnPageMarkup } from './learn-page.ts';

export interface LibraryItem { id: string; name: string; blurb: string; detail: string; hue: string; icon: string }
export interface LibrarySpec { id: string; title: string; items: LibraryItem[] }

/* the two rosters, each a spec of the one library. Exported because the design
   cards render them through this very function (design/build.mjs, {{library}}):
   a card that re-typed a mode's blurb would be a fifth copy of the registry. */
const modeItems = (): LibraryItem[] => [...MODES.map((mode) => {
  const copy = modeCopy(mode.id);
  return { id: mode.id, name: copy.name, blurb: copy.blurb, detail: copy.detail,
    hue: modeHue(mode.id), icon: modeIcon(mode.id, 22) };
}), {
  id: RUNE_TRIAL_FORMAT,
  ...runeTrialCopy(),
  hue: modeHue(RUNE_TRIAL_FORMAT),
  icon: modeIcon(RUNE_TRIAL_FORMAT, 22),
}];
const spellItems = (): LibraryItem[] => SPELLS.map((spell) => {
  const copy = spellCopy(spell.id);
  return { id: spell.id, name: copy.name, blurb: copy.blurb, detail: copy.detail,
    hue: spellHue(spell.id), icon: spellIcon(spell.id, 22) };
});

export const MODE_LIB: LibrarySpec = {
  id: 'ovModes', title: t('learn', 'library.gameModes'), items: modeItems(),
};
export const SPELL_LIB: LibrarySpec = {
  id: 'ovSpells', title: t('learn', 'library.runes'), items: spellItems(),
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
const modePicks = (): PickItem[] => [
  ...MODES.map((mode) => {
    const copy = modeCopy(mode.id);
    return { v: String(mode.mode), id: mode.id, name: copy.name, blurb: copy.blurb,
      hue: modeHue(mode.id), icon: modeIcon(mode.id, 16) };
  }),
  { v: String(RUNE_TRIAL_PICK), id: RUNE_TRIAL_FORMAT,
    name: runeTrialCopy().name, blurb: runeTrialCopy().blurb,
    hue: modeHue(RUNE_TRIAL_FORMAT), icon: modeIcon(RUNE_TRIAL_FORMAT, 16) },
  { v: String(RANDOM), id: 'random', ...modeCopy('random'), hue: modeHue('random'), icon: modeIcon('random', 16) },
];
const spellPicks = (): PickItem[] => [
  { v: '', id: 'none', ...spellCopy('none'), hue: spellHue('none'), icon: spellIcon('none', 16) },
  ...SPELLS.map((spell) => {
    const copy = spellCopy(spell.id);
    return { v: spell.id, id: spell.id, name: copy.name, blurb: copy.blurb,
      hue: spellHue(spell.id), icon: spellIcon(spell.id, 16) };
  }),
  /* last slice, exactly like the mode row's: a promise to draw, not a rune */
  { v: RANDOM_SPELL, id: 'random', ...spellCopy('random'), hue: spellHue('random'), icon: spellIcon('random', 16) },
  /* an opt-in chaos deal: two distinct answers, marked ×2 rather than
     overloading the persisted shared RANDOM choice */
  { v: RANDOM_DUAL_SPELL, id: 'random2', ...spellCopy('random2'),
    hue: spellHue('random2'), icon: spellIcon('random2', 16) },
];
export const MODE_PICKS: PickItem[] = modePicks();
export const SPELL_PICKS: PickItem[] = spellPicks();
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
function refreshLibraryCopy(): void {
  MODE_LIB.title = t('learn', 'library.gameModes');
  MODE_LIB.items = modeItems();
  SPELL_LIB.title = t('learn', 'library.runes');
  SPELL_LIB.items = spellItems();
  MODE_PICKS.splice(0, MODE_PICKS.length, ...modePicks());
  SPELL_PICKS.splice(0, SPELL_PICKS.length, ...spellPicks());
  /* A system language can change while a roster is already open. Repaint its
     existing cards in place so scroll position and the active highlight stay
     intact. */
  for (const spec of [MODE_LIB, SPELL_LIB]) {
    if (!built.has(spec.id)) continue;
    const page = appRoot().querySelector<HTMLElement>('#' + spec.id);
    if (!page) continue;
    const title = page.querySelector<HTMLElement>('.ttl');
    if (title) title.textContent = spec.title;
    for (const item of spec.items) {
      const card = page.querySelector<HTMLElement>(`.modecard[data-mode="${item.id}"]`);
      if (!card) continue;
      card.querySelector<HTMLElement>('.mcname')!.textContent = item.name;
      card.querySelector<HTMLElement>('.mcblurb')!.textContent = item.blurb;
      card.querySelector<HTMLElement>('.mcdetail')!.textContent = item.detail;
    }
  }
}
subscribeLocale(refreshLibraryCopy);

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
  const current = (): LibraryItem | undefined => LIBS[lib]?.items.find((i) => i.id === id);
  const it = current();
  if (!it) return false;   // a chip naming something the registry retired opens nothing
  showSheet({
    cls: 'libsheet',
    label: () => current()?.name ?? it.name,
    tint: it.hue,
    body: libraryBody(it),
    repaintLocale: (card) => {
      const copy = current();
      if (!copy) return;
      card.querySelector<HTMLElement>('.mcname')!.textContent = copy.name;
      card.querySelector<HTMLElement>('.mcblurb')!.textContent = copy.blurb;
      card.querySelector<HTMLElement>('.mcdetail')!.textContent = copy.detail;
    },
  });
  return true;
}
