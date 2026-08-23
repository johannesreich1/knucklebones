// The in-game badge names what is being played. Each named mode/spell is the
// same typed chip and opens the registry that explains it.
import { ME } from '../../core/rules.ts';
import { modeByEnum, type ModeSpec } from '../../core/modes.ts';
import { dealtOf, spellById, type SpellSpec } from '../../core/spells.ts';
import { S } from '../../state.ts';
import { $ } from '../query.ts';
import { modeIcon } from '../modeicons.ts';
import { spellIcon } from '../spellicons.ts';

export type BadgeChip =
  | { html: string; lib: 'modes' | 'spells'; id: string }
  | { html: string; lib?: undefined; id?: undefined };

function paintBadge(chips: readonly BadgeChip[]): void {
  $('#rec').innerHTML = chips.map((chip) => chip.lib
    ? `<button type="button" class="rchip tapmode" data-lib="${chip.lib}" data-id="${chip.id}">`
      + `${chip.html}<span class="mi">ⓘ</span></button>`
    : `<span class="rchip">${chip.html}</span>`).join('');
}

export function modeChip(mode: Pick<ModeSpec, 'id' | 'name'>): BadgeChip {
  return { html: modeIcon(mode.id, 12) + ' ' + mode.name, lib: 'modes', id: mode.id };
}

export function spellChip(spell: Pick<SpellSpec, 'id' | 'name'>): BadgeChip {
  return { html: spellIcon(spell.id, 12) + ' ' + spell.name, lib: 'spells', id: spell.id };
}

let badgeClaimed = false;

export function claimBadge(chips: readonly BadgeChip[]): void {
  badgeClaimed = true;
  paintBadge(chips);
}

export function releaseBadge(): void {
  badgeClaimed = false;
  updateRecord();
}

export function updateRecord(): void {
  if (badgeClaimed) return;
  const chips: BadgeChip[] = [modeChip(modeByEnum(S.scoring))];
  const dealt = spellById(dealtOf(S.spellCharges[ME]));
  if (dealt) chips.push(spellChip(dealt));
  paintBadge(chips);
}
