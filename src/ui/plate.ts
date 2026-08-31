// The identity plate: ring-avatar, name, group, points — one slim row.
//
// ONE painter for every place a player appears as a row: the home chip fills
// it with yourself (design 13d), the result screen deals it twice (design
// 36f) — you with the match's delta beside the number it changed, the
// opponent with their ring in their magenta. What differs between those
// contexts is DATA in the spec, never a second markup.
//
// Lives in ui/ because home paints it at boot, before any online code loads.
import { groupRingFill, boardGroup } from '../core/ladder.ts';
import { formatNumber, ladderGroupCompactName } from '../i18n/index.ts';
import { paintAvatar } from './avatar.ts';
import { ladderRingLayersMarkup } from './ladder-ring.ts';

export interface PlateSpec {
  name: string;
  avatar: string | null;
  points: number | null;   // ladder points — fill the ring, name the group
  rank?: number | null;    // ladder position, in the group pill: "BONE · #13"
  apex?: boolean;          // NEON is a position — only a resolved flag grants it
  delta?: number | null;   // what this match paid, shown beside the points
  theirs?: boolean;        // the opponent's plate: their ring in their magenta
  won?: boolean;           // gold edge — this row took the match
  lost?: boolean;          // dimmed — this row did not
  stamp?: string;          // 'BEATEN' / 'FORFEIT' — angled across the row (design 36d)
  chev?: boolean;          // reads as a door
  rankTap?: () => void;    // the group pill is its own door (result screen)
  large?: boolean;         // the result screen's roomier cut; the chip stays slim
}

/** Repaint locale-owned text and formatting without replacing a live plate. */
export function repaintPlateLocale(el: HTMLElement, p: PlateSpec): void {
  const pts = p.points ?? 0;
  const name = el.querySelector<HTMLElement>('.nm2');
  if (name) name.textContent = p.name;
  const stamp = el.querySelector<HTMLElement>('.pstamp');
  if (stamp) stamp.textContent = p.stamp ?? '';
  const delta = el.querySelector<HTMLElement>('.pdelta');
  if (delta && p.delta != null) {
    delta.textContent = (p.delta >= 0 ? '+' : '') + formatNumber(p.delta);
    delta.classList.toggle('down', p.delta < 0);
  }
  const group = el.querySelector<HTMLElement>('.gpill');
  if (group) {
    /* A SECOND DOOR INSIDE THE ROW. The plate itself is a <button> when it has a
       tap, so the pill cannot be one too — a button inside a button is not a
       tree the HTML parser will keep. role="button" + tabindex is what the rest
       of the app already treats as interactive (boot/input-bindings.ts,
       ui/sheet-drag.ts), so the pill announces and focuses like a control while
       staying phrasing content. Opt-in: a plate with no rankTap (the home chip)
       renders exactly the inert span it always did. */
    if (p.rankTap) {
      group.setAttribute('role', 'button');
      group.tabIndex = 0;
    }
    group.hidden = p.points == null;
    if (p.points != null) {
      const resolved = boardGroup(pts, !!p.apex);
      group.style.setProperty('--gc', `var(--g-${resolved.id})`);
      group.textContent = ladderGroupCompactName(resolved.id)
        + (p.rank != null ? ` · #${formatNumber(p.rank)}` : '');
    }
  }
  const points = el.querySelector<HTMLElement>('.meta2 b');
  if (points) points.textContent = p.points != null ? formatNumber(pts) : '';
}

/* `el` keeps its tag — a <button> where the plate is a door, a <div> where it
   is a fact. This owns only the contents and the state classes. */
export function fillPlate(el: HTMLElement, p: PlateSpec): void {
  el.classList.add('pplate');
  el.classList.remove('anon');
  el.classList.toggle('theirs', !!p.theirs);
  el.classList.toggle('wonp', !!p.won);
  el.classList.toggle('lostp', !!p.lost);
  el.classList.toggle('lg', !!p.large);
  el.classList.toggle('stamped', !!p.stamp);   // the jolt targets the hit row
  const pts = p.points ?? 0;
  el.innerHTML = `<span class="ringwrap mini">${ladderRingLayersMarkup()}<span class="pav"></span></span>`
    + '<span class="nm2"></span>'
    + (p.stamp ? '<span class="pstamp"></span>' : '')
    + '<span class="meta2">'
    + '<span class="mrow">'
    + (p.delta != null ? '<span class="pdelta"></span>' : '')
    + '<b></b></span>'
    + '<span class="gpill"></span></span>'
    + (p.chev ? '<span class="chev">›</span>' : '');
  (el.querySelector('.ringwrap') as HTMLElement).style.setProperty(
    '--p', String(groupRingFill(pts, !!p.apex)),
  );
  paintAvatar(el.querySelector('.pav') as HTMLElement, p.avatar, 18);
  /* The group pill, points, delta, name, and stamp all share the locale-only
     painter used by a live result repaint. */
  repaintPlateLocale(el, p);
}
