// The in-game badge names what is being played. Each named mode/spell is the
// same typed chip and opens the registry that explains it.
import { ME } from '../../core/rules.ts';
import { modeByEnum, type ModeSpec } from '../../core/modes.ts';
import { dealtOf, spellById, type SpellSpec } from '../../core/spells.ts';
import { modeCopy, spellCopy } from '../../i18n/index.ts';
import { S } from '../../state.ts';
import { $ } from '../query.ts';
import { modeIcon } from '../modeicons.ts';
import { spellIcon } from '../spellicons.ts';

export type BadgeChip =
  | { html: string; lib: 'modes' | 'spells'; id: string }
  | { html: string; lib?: undefined; id?: undefined };

function badgeKey(chip: BadgeChip, index: number): string {
  return chip.lib ? `${chip.lib}:${chip.id}` : `plain:${index}`;
}

function updateChip(element: HTMLElement, chip: BadgeChip): void {
  element.className = chip.lib ? 'rchip tapmode' : 'rchip';
  if (chip.lib) {
    const button = element as HTMLButtonElement;
    button.type = 'button';
    button.dataset.lib = chip.lib;
    button.dataset.id = chip.id;
    const html = `${chip.html}<span class="mi">ⓘ</span>`;
    if (button.innerHTML !== html) button.innerHTML = html;
    return;
  }
  delete element.dataset.lib;
  delete element.dataset.id;
  if (element.innerHTML !== chip.html) element.innerHTML = chip.html;
}

function paintBadge(chips: readonly BadgeChip[]): void {
  const badge = $('#rec');
  const existing = new Map(Array.from(badge.children, (child, index) => [
    (child as HTMLElement).dataset.badgeKey ?? `legacy:${index}`,
    child as HTMLElement,
  ]));
  const desired: HTMLElement[] = [];

  chips.forEach((chip, index) => {
    const key = badgeKey(chip, index);
    const tag = chip.lib ? 'BUTTON' : 'SPAN';
    let element = existing.get(key);
    if (!element || element.tagName !== tag) element = document.createElement(tag.toLowerCase());
    element.dataset.badgeKey = key;
    updateChip(element, chip);
    desired.push(element);
  });

  /* Locale changes only alter chip copy. Reconcile by stable mode/rune key so
     focused buttons and any listeners attached to them survive the repaint. */
  desired.forEach((element, index) => {
    const current = badge.children[index];
    if (current !== element) badge.insertBefore(element, current ?? null);
  });
  const keep = new Set(desired);
  Array.from(badge.children).forEach((child) => {
    if (!keep.has(child as HTMLElement)) child.remove();
  });
}

export function modeChip(mode: Pick<ModeSpec, 'id'>): BadgeChip {
  return { html: modeIcon(mode.id, 12) + ' ' + modeCopy(mode.id).compactName, lib: 'modes', id: mode.id };
}

export function spellChip(spell: Pick<SpellSpec, 'id'>): BadgeChip {
  return { html: spellIcon(spell.id, 12) + ' ' + spellCopy(spell.id).compactName, lib: 'spells', id: spell.id };
}

let badgeClaim: (() => readonly BadgeChip[]) | null = null;

export function claimBadge(chips: readonly BadgeChip[] | (() => readonly BadgeChip[])): void {
  badgeClaim = typeof chips === 'function' ? chips : () => chips;
  paintBadge(badgeClaim());
}

export function releaseBadge(): void {
  badgeClaim = null;
  updateRecord();
}

export function updateRecord(): void {
  if (badgeClaim) {
    paintBadge(badgeClaim());
    return;
  }
  const chips: BadgeChip[] = [modeChip(modeByEnum(S.scoring))];
  const dealt = spellById(dealtOf(S.spellCharges[ME]));
  if (dealt) chips.push(spellChip(dealt));
  paintBadge(chips);
}
