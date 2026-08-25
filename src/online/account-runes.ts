import { SPELLS } from '../core/spells.ts';
import { formatNumber, spellCopy, t } from '../i18n/index.ts';
import { $ } from '../ui/dom.ts';
import { spellHue, spellIcon } from '../ui/spellicons.ts';

export function paintAccountRunes(collected: readonly string[]): void {
  const owned = new Set(collected);
  const grid = $('#accRuneGrid');
  grid.innerHTML = '';
  for (const rune of SPELLS) {
    const unlocked = owned.has(rune.id);
    const slot = document.createElement('div');
    slot.className = `accrune${unlocked ? ' collected' : ' locked'}`;
    slot.style.setProperty('--rh', spellHue(rune.id));
    slot.setAttribute('aria-label', unlocked
      ? spellCopy(rune.id).name
      : `${spellCopy(rune.id).name} — ${t('common', 'states.unavailable')}`);
    if (!unlocked) slot.setAttribute('aria-disabled', 'true');
    slot.innerHTML = spellIcon(rune.id, 19);
    const label = document.createElement('span');
    label.textContent = spellCopy(rune.id).compactName;
    slot.appendChild(label);
    grid.appendChild(slot);
  }
  $('#accRuneCount').textContent = `${formatNumber(owned.size)} / ${formatNumber(SPELLS.length)}`;
  grid.setAttribute('aria-label', t('online', 'profile.runesCollected', {
    count: owned.size,
    total: formatNumber(SPELLS.length),
  }));
}
