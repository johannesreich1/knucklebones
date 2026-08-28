import { SPELLS, spellById } from '../../core/spells.ts';
import { formatDate, formatNumber, runeTrialCopy, spellCopy, t } from '../../i18n/index.ts';
import { Sfx } from '../../ui/audio.ts';
import { $ } from '../../ui/dom.ts';
import { openEntry } from '../../ui/library.ts';
import { spellHue, spellIcon } from '../../ui/spellicons.ts';
import { tap } from '../../ui/tap.ts';
import { esc } from './format.ts';
import { equipRune } from '../runes/rune-equip.ts';
import {
  collectedRuneIds,
  equippedRuneId,
  readRuneCollectionSnapshot,
} from '../../rune-collection-cache.ts';
import { showSheet } from '../../ui/sheet.ts';
import type { PlayerRuneRow } from '../runes/rune-collection.ts';

/* THE SEAT IN THE RING'S MOUTH (design 52d, EQ4) — three states and no more.
   A fourth that an earlier draft carried is not a state at all: a rune the
   account does not own can never be seated, which is the GRID's veiled slot.
   An empty seat is a legitimate answer and stays reachable — winning a first
   rune no longer seats it (removed 2026-08-28, owner call: the behaviour is
   to be solved differently), so 'none' is where every new collection starts. */
export type SeatState = 'none' | 'live' | 'waiting';

/* The rune enters play from SILVER up. Below it the choice is made, saved and
   simply waiting — never "locked", which would name a deficit where there is
   only a threshold. */
const SEAT_LIVE_GROUPS = new Set(['silver', 'gold', 'obsidian', 'neon']);

export function seatStateFor(equipped: string | null, group: string | null): SeatState {
  if (!equipped) return 'none';
  return group && SEAT_LIVE_GROUPS.has(group.toLowerCase()) ? 'live' : 'waiting';
}

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

/**
 * The seat wears the rune's own registry hue and one of three states. It is
 * hidden entirely for an account with nothing collected: a seat offered before
 * there is anything to put in it is a promise the profile cannot keep yet.
 */
export function paintEquippedSeat(group: string | null): void {
  const seat = $('#accSeat');
  const equipped = equippedRuneId();
  const owned = collectedRuneIds();
  seat.hidden = owned.length === 0;
  if (seat.hidden) return;
  const state = seatStateFor(equipped, group);
  seat.classList.toggle('none', state === 'none');
  seat.classList.toggle('waiting', state === 'waiting');
  const spell = equipped ? spellById(equipped) : null;
  seat.style.setProperty('--rh', spell ? spellHue(spell.id) : '');
  seat.innerHTML = spell ? spellIcon(spell.id, 19) : '';
  seat.setAttribute('aria-label', spell
    ? `${spellCopy(spell.id).name} — ${t('online', state === 'live'
      ? 'profile.equippedMeta' : 'profile.equippedWaiting')}`
    : t('online', 'profile.seatEmpty'));
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
export function bindAccountRuneSheets(onRuneEquipped?: () => void): void {
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
      /* EQUIPPING LIVES ON THE SHEET THAT ALREADY EXPLAINS THE RUNE, so the
         grid keeps meaning collection and gains no second meaning. A locked
         rune offers nothing — there is nothing to carry — and the one already
         seated offers nothing here either, because its own seat is where you
         put it down. */
      action: locked || runeId === equippedRuneId() ? undefined : {
        label: () => t('online', 'profile.equipThis'),
        run: async () => { await equipForAccount(runeId); onRuneEquipped?.(); },
      },
    });
    if (opened) Sfx.tap();
  });
}

/**
 * THE SEAT IS A DOOR, and every door on this screen opens the SAME sheet.
 * A collected rune's sheet gains one action — carry it, or stop carrying the
 * one already seated — so NONE stays reachable without inventing a second
 * control, and the collection grid keeps meaning exactly what it meant.
 *
 * `openEntry` cannot serve the empty seat: SPELL_LIB is built from the six
 * registry runes, so there is no NONE entry and it returns false on an id the
 * roster does not hold. That one case goes through showSheet directly, wearing
 * the same libsheet dress. It is the only new seam this feature needs, and it
 * is worth stating rather than hiding behind a pseudo-entry nobody expects.
 */
/* The account id belongs to the session, not to the sheet. Reading it at the
   moment of the write means a sign-out or an account switch between opening
   the sheet and pressing the button writes nothing, instead of writing to
   whoever the screen was painted for. */
async function equipForAccount(runeId: string | null): Promise<void> {
  const accountId = readRuneCollectionSnapshot()?.accountId ?? null;
  if (accountId) await equipRune(accountId, runeId);
}

export function bindEquippedSeat(onChanged: () => void): void {
  tap($('#accSeat'), () => {
    const equipped = equippedRuneId();
    Sfx.tap();
    if (!equipped) {
      showSheet({
        cls: 'libsheet',
        label: () => t('online', 'profile.seatEmpty'),
        body: `<div class="mchead"><span class="mcname">`
          + `${esc(t('online', 'profile.seatEmpty'))}</span></div>`
          + `<div class="mcdetail">${esc(t('online', 'profile.seatEmptyDetail'))}</div>`,
        restoreFocus: $('#accSeat'),
      });
      return;
    }
    openEntry('spells', equipped, {
      restoreFocus: () => $('#accSeat'),
      presentation: () => ({ meta: t('online', 'profile.equippedMeta') }),
      action: {
        label: () => t('online', 'profile.unequipThis'),
        run: async () => { await equipForAccount(null); onChanged(); },
      },
    });
  });
}
