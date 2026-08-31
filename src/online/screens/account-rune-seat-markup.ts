// Presentation for the equipped-rune seat sheet. Selection state and writes
// remain with account-runes; this module only renders the three canonical
// choices into the shared sheet.
import { RANDOM_SPELL } from '../../core/spells.ts';
import { t } from '../../i18n/index.ts';
import { spellIcon } from '../../ui/spellicons.ts';
import type { EquippedRuneSelection } from '../runes/rune-equip.ts';
import { esc } from './format.ts';

export function runeSeatPickerMarkup(
  selection: EquippedRuneSelection,
  collectedCount: number,
): string {
  const random = selection.kind === 'random';
  const randomAvailable = collectedCount >= 2;
  const randomDetail = t('online', randomAvailable
    ? 'profile.randomRuneModeDetail' : 'profile.randomRuneModeLocked');
  return `<div class="mchead"><span class="mcname">`
    + `${esc(t('online', 'profile.seatPick'))}</span></div>`
    + `<div class="mcdetail">${esc(t('online', 'profile.seatPickDetail'))}</div>`
    + `<div class="seatmode-actions">`
    + `<button type="button" class="btn primary" id="accSeatEquip">`
    + `${esc(t('online', 'profile.equipRune'))}</button>`
    + `<div class="seatmode-random">`
    + `<button type="button" class="btn soft${random ? ' on' : ''}" id="accSeatRandom"`
    + ` data-equipment-kind="random" aria-pressed="${random ? 'true' : 'false'}"`
    + ` aria-describedby="accSeatRandomDetail"${randomAvailable ? '' : ' disabled aria-disabled="true"'}>`
    + `${spellIcon(RANDOM_SPELL, 19)}<span>${esc(t('online', 'profile.randomRuneMode'))}</span></button>`
    + `<span class="seatmode-detail" id="accSeatRandomDetail">${esc(randomDetail)}</span></div>`
    + (selection.kind !== 'none'
      ? `<button type="button" class="btn soft small" id="accSeatClear">`
        + `${esc(t('online', 'profile.unequipThis'))}</button>` : '')
    + `</div>`;
}
