import { SPELLS } from '../core/spells.ts';
import { formatNumber, spellCopy, t } from '../i18n/index.ts';
import { $ } from '../ui/dom.ts';
import { spellHue, spellIcon } from '../ui/spellicons.ts';
import { esc } from './format.ts';

export function accountRunesMarkup(
  collected: readonly string[],
  idPrefix = 'acc',
): string {
  const owned = new Set(collected);
  const count = `${formatNumber(owned.size)} / ${formatNumber(SPELLS.length)}`;
  const gridLabel = t('online', 'profile.runesCollected', {
    count: owned.size,
    total: formatNumber(SPELLS.length),
  });
  const slots = SPELLS.map((rune) => {
    const unlocked = owned.has(rune.id);
    const copy = spellCopy(rune.id);
    const label = unlocked ? copy.name : `${copy.name} — ${t('common', 'states.unavailable')}`;
    return `<div class="accrune${unlocked ? ' collected' : ' locked'}"`
      + ` style="--rh:${esc(spellHue(rune.id))}" aria-label="${esc(label)}"`
      + `${unlocked ? '' : ' aria-disabled="true"'}>${spellIcon(rune.id, 19)}`
      + `<span>${esc(copy.compactName)}</span></div>`;
  }).join('');
  const titleId = `${idPrefix}RunesTitle`;
  return `<section class="accrunes" aria-labelledby="${titleId}">`
    + `<div class="accrunes-head"><b id="${titleId}">${esc(t('online', 'profile.runes'))}</b>`
    + `<span id="${idPrefix}RuneCount">${esc(count)}</span></div>`
    + `<div class="accrunes-grid" id="${idPrefix}RuneGrid" aria-label="${esc(gridLabel)}">`
    + `${slots}</div></section>`;
}

export function paintAccountRunes(collected: readonly string[]): void {
  $('#accRunes').innerHTML = accountRunesMarkup(collected);
}
