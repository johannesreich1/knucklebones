import { RANDOM_SPELL, SPELLS, spellById } from '../../core/spells.ts';
import { formatDate, formatNumber, runeTrialCopy, spellCopy, t } from '../../i18n/index.ts';
import { Sfx } from '../../ui/audio.ts';
import { $ } from '../../ui/dom.ts';
import { openEntry } from '../../ui/library.ts';
import { spellHue, spellIcon } from '../../ui/spellicons.ts';
import { tap } from '../../ui/tap.ts';
import { esc } from './format.ts';
import type { EquippedRuneSelection } from '../runes/rune-equip.ts';
import { collectedRuneIds } from '../../rune-collection-cache.ts';
import { showSheet } from '../../ui/sheet.ts';
import { completeAccountRuneSeatGuide } from './account-rune-guide.ts';
import { runeSeatPickerMarkup } from './account-rune-seat-markup.ts';
import type { PlayerRuneRow } from '../runes/rune-collection.ts';

/* THE SEAT IN THE RING'S MOUTH (design 52d, EQ4) — three states and no more.
   A fourth that an earlier draft carried is not a state at all: a rune the
   account does not own can never be seated, which is the GRID's veiled slot.
   An empty seat is a legitimate answer and stays reachable — winning a first
   rune no longer seats it (removed 2026-08-28, owner call: the behaviour is
   to be solved differently), so 'none' is where every new collection starts. */
export type SeatState = 'none' | 'live' | 'waiting';
export interface PersistedRuneEquipment {
  readonly accountId: string;
  readonly selection: EquippedRuneSelection;
}
export type RuneEquipmentPersistence = PersistedRuneEquipment & { readonly kind: 'confirmed' }
  | { readonly kind: 'refused' }
  | { readonly kind: 'account-mismatch'; readonly accountId: string };

/**
 * The profile owns the interaction, while the rune data owner decides how a
 * fixed/random/empty answer is stored. Keeping that as one semantic port is
 * what lets RANDOM remain a mode even though its backwards-compatible row
 * also carries a concrete fallback rune.
 */
export interface RuneEquipmentPort {
  accountId(): string | null;
  current(): EquippedRuneSelection;
  persist(
    accountId: string,
    selection: EquippedRuneSelection,
  ): Promise<RuneEquipmentPersistence>;
  changed(result: PersistedRuneEquipment): boolean;
  mismatched(accountId: string): void;
  settled(): void;
}

/* Reaching SILVER once makes the rune seat live permanently. The caller passes
   SILVER (or a higher live group) from its all-season achievement read, not
   from the current ladder group: below a first SILVER peak the choice is saved
   and waiting, while demotion or rollover cannot put an earned seat to sleep. */
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
    + `<div class="accpick" id="${idPrefix}RunePick" role="status" hidden>`
    + `<div><b>${esc(t('online', 'profile.chooseRune'))}</b>`
    + `<span id="${idPrefix}RunePickText">${esc(t('online', 'profile.chooseRuneDetail'))}</span></div>`
    + `<button type="button" class="linkbtn" id="${idPrefix}RunePickCancel">`
    + `${esc(t('common', 'actions.cancel'))}</button></div>`
    + `<div class="accrunes-grid" id="${idPrefix}RuneGrid" aria-label="${esc(gridLabel)}">`
    + `${slots}</div></section>`;
}

export function paintAccountRunes(
  collected: readonly string[],
  rows: readonly PlayerRuneRow[] = [],
): void {
  if (!collected.length && activeRuneSelection) leaveRuneSelection(false);
  $('#accRunes').innerHTML = accountRunesMarkup(collected, 'acc', rows);
  if (activeRuneSelection) paintRuneSelectionState();
}

/**
 * The seat wears the rune's own registry hue and one of three states. It is
 * hidden entirely for an account with nothing collected: a seat offered before
 * there is anything to put in it is a promise the profile cannot keep yet.
 */
/* The outer seat already IS the socket. The empty mark is therefore only the
   plus, centred in that circle — a second dotted circle inside it made the
   invitation look like two nested controls. */
const EMPTY_SEAT_ICON = '<svg class="sico seatnone" viewBox="0 0 20 20" width="19" height="19"'
  + ' aria-hidden="true" fill="none" stroke="currentColor" stroke-width="1.4">'
  + '<path d="M10 6.9v6.2M6.9 10h6.2" stroke-linecap="round"/></svg>';

export function paintEquippedSeat(
  group: string | null,
  equipment: EquippedRuneSelection,
  owned: readonly string[],
): void {
  const seat = $('#accSeat');
  const equipped = equipment.kind === 'fixed' ? equipment.runeId : null;
  seat.hidden = owned.length === 0;
  if (seat.hidden) return;
  const state = equipment.kind === 'none'
    ? 'none'
    : group && SEAT_LIVE_GROUPS.has(group.toLowerCase()) ? 'live' : 'waiting';
  seat.classList.toggle('none', state === 'none');
  seat.classList.toggle('waiting', state === 'waiting');
  seat.classList.toggle('random', equipment.kind === 'random');
  const spell = equipped ? spellById(equipped) : null;
  seat.style.setProperty('--rh', spell
    ? spellHue(spell.id)
    : equipment.kind === 'random' ? spellHue(RANDOM_SPELL) : '');
  /* AN EMPTY SEAT STILL SHOWS SOMETHING. A bare socket reads as a rendering
     fault rather than an invitation, and the seat is a door in every state —
     so the empty one wears the ring the design draws around a rune, with no
     rune in it. */
  seat.innerHTML = spell
    ? spellIcon(spell.id, 19)
    : equipment.kind === 'random' ? spellIcon(RANDOM_SPELL, 19) : EMPTY_SEAT_ICON;
  seat.setAttribute('aria-label', equipment.kind === 'random'
    ? t('online', state === 'live'
      ? 'profile.randomEquipped' : 'profile.randomEquippedWaiting')
    : spell
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

let activeRuneSelection: { port: RuneEquipmentPort; accountId: string } | null = null;
let selectionInert: Array<{ element: HTMLElement; inert: boolean }> = [];
let equipmentWritePending = false;

/* One equipment answer owns the seat until persistence settles. Both pickers
   dismiss first, so disabling the still-visible door keeps answers ordered. */
function setEquipmentWritePending(pending: boolean): void {
  equipmentWritePending = pending;
  const seat = $('#accSeat') as HTMLButtonElement;
  if (pending) {
    seat.disabled = true;
    seat.setAttribute('aria-busy', 'true');
  }
  else seat.removeAttribute('aria-busy');
}

function leaveRuneSelection(restoreSeat = true): void {
  if (!activeRuneSelection) return;
  activeRuneSelection = null;
  document.removeEventListener('keydown', cancelRuneSelectionOnEscape);
  const host = $('#accRunes');
  host.classList.remove('choosing');
  $('#onAccount').classList.remove('rune-picking');
  selectionInert.forEach(({ element, inert }) => { element.inert = inert; });
  selectionInert = [];
  const prompt = host.querySelector<HTMLElement>('#accRunePick');
  if (prompt) prompt.hidden = true;
  host.querySelectorAll<HTMLButtonElement>('.accrune').forEach((button) => {
    button.disabled = false;
    button.removeAttribute('aria-disabled');
    button.removeAttribute('aria-describedby');
    button.setAttribute('aria-haspopup', 'dialog');
    button.tabIndex = 0;
  });
  if (restoreSeat) requestAnimationFrame(() => $('#accSeat').focus({ preventScroll: true }));
}

function cancelRuneSelectionOnEscape(event: KeyboardEvent): void {
  if (event.key !== 'Escape' || event.defaultPrevented) return;
  event.preventDefault();
  leaveRuneSelection();
}

function paintRuneSelectionState(): void {
  const host = $('#accRunes');
  const prompt = host.querySelector<HTMLElement>('#accRunePick');
  host.classList.add('choosing');
  $('#onAccount').classList.add('rune-picking');
  if (prompt) prompt.hidden = false;
  host.querySelectorAll<HTMLButtonElement>('.accrune').forEach((button) => {
    const owned = button.classList.contains('collected');
    button.disabled = !owned;
    if (owned) button.removeAttribute('aria-disabled');
    else button.setAttribute('aria-disabled', 'true');
    button.tabIndex = owned ? 0 : -1;
    button.setAttribute('aria-describedby', 'accRunePickText');
    button.removeAttribute('aria-haspopup');
  });
}

function enterRuneSelection(port: RuneEquipmentPort, accountId: string): void {
  leaveRuneSelection(false);
  activeRuneSelection = { port, accountId };
  const panel = $('#onAccount');
  const host = $('#accRunes');
  const onlineHead = $('#ovOnline').querySelector<HTMLElement>('.shead');
  const blocks = [onlineHead,
    ...[...panel.children]
      .filter((element): element is HTMLElement => element instanceof HTMLElement && element !== host)];
  selectionInert = blocks.filter((element): element is HTMLElement => !!element)
    .map((element) => ({ element, inert: element.inert }));
  selectionInert.forEach(({ element }) => { element.inert = true; });
  paintRuneSelectionState();
  document.addEventListener('keydown', cancelRuneSelectionOnEscape);
  host.scrollIntoView({ block: 'center' });
  requestAnimationFrame(() => host.querySelector<HTMLButtonElement>('.accrune.collected')
    ?.focus({ preventScroll: true }));
}

async function persistEquipment(
  port: RuneEquipmentPort,
  accountId: string,
  selection: EquippedRuneSelection,
): Promise<void> {
  if (equipmentWritePending) return;
  setEquipmentWritePending(true);
  let accepted = false;
  try {
    const result = await port.persist(accountId, selection);
    if (result.kind === 'confirmed') accepted = port.changed(result);
    if (result.kind === 'account-mismatch') port.mismatched(result.accountId);
  } finally {
    setEquipmentWritePending(false);
    port.settled();
    if (accepted) requestAnimationFrame(() => $('#accSeat').focus({ preventScroll: true }));
  }
}

/** Profile context for the shared in-game rune sheet and the grid's pick mode. */
export function bindAccountRuneSheets(): void {
  const host = $('#accRunes');
  tap(host, (event) => {
    const cancel = event.target instanceof Element
      ? event.target.closest<HTMLButtonElement>('#accRunePickCancel')
      : null;
    if (cancel && host.contains(cancel)) {
      Sfx.tap();
      leaveRuneSelection();
      return;
    }
    const button = event.target instanceof Element
      ? event.target.closest<HTMLButtonElement>('.accrune[data-rune]')
      : null;
    if (!button || !host.contains(button) || !button.dataset.rune) return;
    const runeId = button.dataset.rune;
    if (activeRuneSelection) {
      if (!button.classList.contains('collected')) return;
      Sfx.tap();
      const { port, accountId } = activeRuneSelection;
      leaveRuneSelection(false);
      void persistEquipment(port, accountId, { kind: 'fixed', runeId });
      return;
    }
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

/**
 * THE SEAT IS THE ONE EQUIPMENT DOOR. A collection card still means "read this
 * rune" until EQUIP turns that same grid into a temporary picker. That keeps
 * one grid and one selection implementation without making an ordinary tap
 * silently change what the player carries.
 */
export function bindEquippedSeat(equipment: RuneEquipmentPort): void {
  tap($('#accSeat'), () => {
    if (equipmentWritePending) return;
    Sfx.tap();
    const collected = collectedRuneIds();
    /* Nothing collected is the one state with no choice to offer. The seat is
       hidden then anyway (paintEquippedSeat), so this is belt and braces. */
    if (!collected.length) return;
    const accountId = equipment.accountId()?.toLowerCase() ?? null;
    if (!accountId) return;
    /* A guided SILVER arrival completes only by using this real door. The
       guide restores the profile before the canonical equipment sheet opens. */
    completeAccountRuneSeatGuide();
    const content = document.createElement('div');
    content.className = 'seatmode-content';
    content.innerHTML = runeSeatPickerMarkup(equipment.current(), collected.length);
    const sheet = showSheet({
      cls: 'libsheet',
      interactive: true,
      label: () => t('online', 'profile.seatPick'),
      content,
      restoreFocus: $('#accSeat'),
    });
    const commit = async (selection: EquippedRuneSelection): Promise<void> => {
      Sfx.tap();
      sheet.card.querySelectorAll<HTMLButtonElement>('button').forEach((button) => {
        button.disabled = true;
      });
      sheet.close(false);
      await persistEquipment(equipment, accountId, selection);
    };
    sheet.card.querySelector<HTMLButtonElement>('#accSeatEquip')
      ?.addEventListener('click', () => {
        Sfx.tap();
        sheet.close(false);
        enterRuneSelection(equipment, accountId);
      });
    sheet.card.querySelector<HTMLButtonElement>('#accSeatRandom')
      ?.addEventListener('click', () => { void commit({ kind: 'random' }); });
    sheet.card.querySelector<HTMLButtonElement>('#accSeatClear')
      ?.addEventListener('click', () => { void commit({ kind: 'none' }); });
  });
}
