import { SPELLS } from '../../core/spells.ts';
import { formatDate, formatNumber, runeTrialCopy, spellCopy, t } from '../../i18n/index.ts';
import { Sfx } from '../../ui/audio.ts';
import { $ } from '../../ui/dom.ts';
import { openEntry } from '../../ui/library.ts';
import { spellHue, spellIcon } from '../../ui/spellicons.ts';
import { tap } from '../../ui/tap.ts';
import { esc } from './format.ts';
import type { PlayerRuneRow } from '../runes/rune-collection.ts';

export function accountRunesMarkup(
  collected: readonly string[],
  idPrefix = 'acc',
  rows: readonly PlayerRuneRow[] = [],
): string {
  const owned = new Set(collected);
  const collectedAt = new Map(rows.map((row) => [row.rune_id, row.collected_at]));
  const count = `${formatNumber(owned.size)} / ${formatNumber(SPELLS.length)}`;
  const gridLabel = t('online', 'profile.runesCollected', {
    count: owned.size,
    total: formatNumber(SPELLS.length),
  });
  const slots = SPELLS.map((rune) => {
    const unlocked = owned.has(rune.id);
    const copy = spellCopy(rune.id);
    const label = unlocked ? copy.name : `${copy.name} — ${t('online', 'profile.runeLocked')}`;
    const timestamp = unlocked ? collectedAt.get(rune.id) : null;
    return `<button type="button" class="accrune${unlocked ? ' collected' : ' locked'}"`
      + ` style="--rh:${esc(spellHue(rune.id))}" aria-label="${esc(label)}"`
      + ` data-rune="${esc(rune.id)}"${timestamp ? ` data-collected-at="${esc(timestamp)}"` : ''}`
      + ` aria-haspopup="dialog">${spellIcon(rune.id, 19)}`
      + `<span>${esc(copy.compactName)}</span></button>`;
  }).join('');
  const titleId = `${idPrefix}RunesTitle`;
  return `<section class="accsec" aria-labelledby="${titleId}">`
    + `<div class="acchead"><b id="${titleId}">${esc(t('online', 'profile.runes'))}</b>`
    + `<span id="${idPrefix}RuneCount">${esc(count)}</span></div>`
    + `<div class="accrunes-grid" id="${idPrefix}RuneGrid" aria-label="${esc(gridLabel)}">`
    + `${slots}</div></section>`;
}

export function paintAccountRunes(
  collected: readonly string[],
  rows: readonly PlayerRuneRow[] = [],
): void {
  $('#accRunes').innerHTML = accountRunesMarkup(collected, 'acc', rows);
}

function unlockedAt(value: string | undefined): string | null {
  if (!value) return null;
  const date = new Date(value);
  if (!Number.isFinite(date.getTime())) return null;
  return t('online', 'profile.runeUnlockedAt', {
    date: formatDate(date, { dateStyle: 'medium', timeStyle: 'short' }),
  });
}

/** Profile context for the shared in-game rune sheet. */
export function bindAccountRuneSheets(): void {
  const host = $('#accRunes');
  tap(host, (event) => {
    const button = event.target instanceof Element
      ? event.target.closest<HTMLButtonElement>('.accrune[data-rune]')
      : null;
    if (!button || !host.contains(button) || !button.dataset.rune) return;
    const runeId = button.dataset.rune;
    const collectedAt = button.dataset.collectedAt;
    const locked = button.classList.contains('locked');
    const opened = openEntry('spells', runeId, {
      restoreFocus: () => [...host.querySelectorAll<HTMLButtonElement>('.accrune[data-rune]')]
        .find((candidate) => candidate.dataset.rune === runeId) ?? null,
      presentation: () => locked ? {
        blurb: t('online', 'profile.runeLocked'),
        detail: t('online', 'profile.runeLockedDetail', { mode: runeTrialCopy().name }),
      } : {
        meta: unlockedAt(collectedAt),
      },
    });
    if (opened) Sfx.tap();
  });
}
