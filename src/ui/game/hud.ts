// The in-game badge names what is being played. Each named mode/spell is the
// same typed chip and opens the registry that explains it.
import { AI, ME, type Player } from '../../core/rules.ts';
import { modeByEnum, type ModeSpec } from '../../core/modes.ts';
import { dealtOf, spellById, type SpellSpec } from '../../core/spells.ts';
import { modeCopy, spellCopy } from '../../i18n/index.ts';
import { S } from '../../state.ts';
import { appRoot } from '../embed.ts';
import { $ } from '../query.ts';
import { modeIcon } from '../modeicons.ts';
import { spellIcon } from '../spellicons.ts';
import { nameOf } from '../identity.ts';
import { isLandscapeLayout, isSidePointsLayout } from './root-state.ts';

export type BadgeChip =
  | { html: string; lib: 'modes' | 'spells'; id: string; owner?: Player; ariaLabel?: string }
  | { html: string; lib?: undefined; id?: undefined };

function badgeKey(chip: BadgeChip, index: number): string {
  return chip.lib ? `${chip.lib}:${chip.id}:${chip.owner ?? 'shared'}` : `plain:${index}`;
}

function updateChip(element: HTMLElement, chip: BadgeChip): void {
  element.className = chip.lib ? 'rchip tapmode' : 'rchip';
  if (chip.lib) {
    const button = element as HTMLButtonElement;
    button.type = 'button';
    button.dataset.lib = chip.lib;
    button.dataset.id = chip.id;
    if (chip.owner === undefined) delete button.dataset.owner;
    else button.dataset.owner = String(chip.owner);
    if (chip.ariaLabel) button.setAttribute('aria-label', chip.ariaLabel);
    else button.removeAttribute('aria-label');
    const html = `${chip.html}<span class="mi">ⓘ</span>`;
    if (button.innerHTML !== html) button.innerHTML = html;
    return;
  }
  delete element.dataset.lib;
  delete element.dataset.id;
  delete element.dataset.owner;
  element.removeAttribute('aria-label');
  if (element.innerHTML !== chip.html) element.innerHTML = chip.html;
}

function badgeHosts(): HTMLElement[] {
  return [$('#rec'), $('#runeTagTop'), $('#runeTagBot')];
}

function orderIn(container: HTMLElement, elements: readonly HTMLElement[]): void {
  elements.forEach((element, index) => {
    const current = container.children[index];
    if (current !== element) container.insertBefore(element, current ?? null);
  });
}

function clearPlateRunes(): void {
  appRoot().querySelectorAll<HTMLElement>('.plate.rune-meta').forEach((plate) => {
    plate.classList.remove('rune-meta');
  });
}

/**
 * Give each asymmetric rune to its player's nameplate only when the real,
 * localized contents fit across both boards. Returning false leaves the same
 * buttons in the compact central HUD, where their owner dots disambiguate them.
 */
function placePlayerRunes(chips: readonly BadgeChip[], elements: readonly HTMLElement[]): boolean {
  if (isLandscapeLayout() || !isSidePointsLayout()) return false;
  const owned = chips.flatMap((chip, index) =>
    chip.lib === 'spells' && chip.owner !== undefined ? [{ chip, element: elements[index] }] : []);
  if (owned.length !== 2 || owned[0].chip.owner === owned[1].chip.owner) return false;

  const placements = owned.map(({ chip, element }) => {
    const side = appRoot().querySelector<HTMLElement>(`.side[data-owner="${chip.owner}"]`);
    return {
      element,
      plate: side?.querySelector<HTMLElement>('.plate') ?? null,
      host: side?.querySelector<HTMLElement>('.rune-tag') ?? null,
      identity: side?.querySelector<HTMLElement>('.player-id') ?? null,
      who: side?.querySelector<HTMLElement>('.who') ?? null,
      board: side?.querySelector<HTMLElement>('.board') ?? null,
    };
  });
  if (placements.some(({ plate, host, identity, who, board }) =>
    !plate || !host || !identity || !who || !board)) return false;

  placements.forEach(({ plate, host, element }) => {
    plate!.classList.add('rune-meta');
    host!.appendChild(element);
  });
  const fits = placements.every(({ identity, who, board, element }) => {
    const boardWidth = board!.getBoundingClientRect().width;
    const identityWidth = identity!.getBoundingClientRect().width;
    const runeWidth = element.getBoundingClientRect().width;
    const gap = parseFloat(getComputedStyle(who!).columnGap) || 0;
    return boardWidth > 0 && identityWidth + runeWidth + gap <= boardWidth + .5;
  });
  if (!fits) placements.forEach(({ plate }) => plate!.classList.remove('rune-meta'));
  return fits;
}

let lastBadgeChips: readonly BadgeChip[] = [];

function paintBadge(chips: readonly BadgeChip[]): void {
  lastBadgeChips = [...chips];
  const badge = $('#rec');
  const hosts = badgeHosts();
  const focused = document.activeElement instanceof HTMLElement
    && appRoot().contains(document.activeElement) ? document.activeElement : null;
  /* Count the full fallback while reconciling. At <=359px this lets CSS reduce
     owner chips to their icon before we decide whether the central row fits. */
  badge.dataset.count = String(chips.length);
  delete badge.dataset.compactOwners;
  const currentElements = hosts.flatMap((host) => Array.from(host.children) as HTMLElement[]);
  const existing = new Map(currentElements.map((child, index) => [
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
     focused buttons survive both the repaint and a HUD/plate relocation. */
  clearPlateRunes();
  orderIn(badge, desired);
  const keep = new Set(desired);
  currentElements.forEach((child) => {
    if (!keep.has(child as HTMLElement)) child.remove();
  });
  const split = placePlayerRunes(chips, desired);
  if (!split) orderIn(badge, desired);
  badge.dataset.count = String(badge.children.length);
  /* A localized three-chip fallback can be wider than a nominally roomy phone.
     Read the painted row against the real Leave control and compact only its
     already owner-marked rune labels when the two would collide. */
  if (!split && !isLandscapeLayout() && badge.children.length === 3
      && badge.getBoundingClientRect().right > $('#btnLeave').getBoundingClientRect().left - 4) {
    badge.dataset.compactOwners = '';
  }
  /* Reparenting a focused button makes browsers focus <body>. Put keyboard
     focus back on the same surviving control without scrolling the board. */
  if (focused && keep.has(focused) && document.activeElement !== focused) {
    focused.focus({ preventScroll: true });
  }
}

/** Re-evaluate the measured portrait placement after resize or seat changes. */
export function reflowBadge(): void {
  if (lastBadgeChips.length) paintBadge(lastBadgeChips);
}

export function modeChip(mode: Pick<ModeSpec, 'id'>): BadgeChip {
  return {
    html: `${modeIcon(mode.id, 12)}<span class="rlab">${modeCopy(mode.id).compactName}</span>`,
    lib: 'modes',
    id: mode.id,
  };
}

export function spellChip(spell: Pick<SpellSpec, 'id'>, owner?: Player): BadgeChip {
  const copy = spellCopy(spell.id);
  return {
    html: `${spellIcon(spell.id, 12)}<span class="rlab">${copy.compactName}</span>`,
    lib: 'spells',
    id: spell.id,
    owner,
    ariaLabel: owner === undefined ? undefined : `${nameOf(owner)}: ${copy.name}`,
  };
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
  const mine = spellById(dealtOf(S.spellCharges[ME]));
  const theirs = spellById(dealtOf(S.spellCharges[AI]));
  if (mine && theirs && mine.id !== theirs.id) {
    chips.push(spellChip(mine, ME), spellChip(theirs, AI));
  } else if (mine) {
    chips.push(spellChip(mine));
  }
  paintBadge(chips);
}
