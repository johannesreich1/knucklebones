// The identity plate: ring-avatar, name, group, points — one slim row.
//
// ONE painter for every place a player appears as a row: the home chip fills
// it with yourself (design 13d), the result screen deals it twice (design
// 36f) — you with the match's delta beside the number it changed, the
// opponent with their ring in their magenta. What differs between those
// contexts is DATA in the spec, never a second markup.
//
// Lives in ui/ because home paints it at boot, before any online code loads.
import { groupFill, rankName } from '../core/ladder.ts';
import { paintAvatar } from './avatar.ts';

export interface PlateSpec {
  name: string;
  avatar: string | null;
  points: number | null;   // ladder points — fill the ring, name the group
  delta?: number | null;   // what this match paid, shown beside the points
  theirs?: boolean;        // the opponent's plate: their ring in their magenta
  won?: boolean;           // gold edge — this row took the match
  lost?: boolean;          // dimmed — this row did not
  stamp?: string;          // 'BEATEN' — angled across the row (design 36d)
  chev?: boolean;          // reads as a door
}

/* `el` keeps its tag — a <button> where the plate is a door, a <div> where it
   is a fact. This owns only the contents and the state classes. */
export function fillPlate(el: HTMLElement, p: PlateSpec): void {
  el.classList.add('pplate');
  el.classList.remove('anon');
  el.classList.toggle('theirs', !!p.theirs);
  el.classList.toggle('wonp', !!p.won);
  el.classList.toggle('lostp', !!p.lost);
  const pts = p.points ?? 0;
  el.innerHTML = '<span class="ringwrap mini"><i class="lring"></i><span class="pav"></span></span>'
    + '<span class="nm2"></span>'
    + (p.stamp ? '<span class="pstamp"></span>' : '')
    + '<span class="meta2">'
    + (p.delta != null ? '<span class="pdelta"></span>' : '')
    + '<span class="gl"></span><b></b></span>'
    + (p.chev ? '<span class="chev">›</span>' : '');
  (el.querySelector('.ringwrap') as HTMLElement).style.setProperty('--p', String(groupFill(pts)));
  paintAvatar(el.querySelector('.pav') as HTMLElement, p.avatar, 18);
  (el.querySelector('.nm2') as HTMLElement).textContent = p.name;
  if (p.stamp) (el.querySelector('.pstamp') as HTMLElement).textContent = p.stamp;
  if (p.delta != null) {
    const d = el.querySelector('.pdelta') as HTMLElement;
    d.textContent = (p.delta >= 0 ? '+' : '') + p.delta;
    d.classList.toggle('down', p.delta < 0);
  }
  (el.querySelector('.gl') as HTMLElement).textContent = p.points != null ? rankName(pts) : '';
  (el.querySelector('.meta2 b') as HTMLElement).textContent =
    p.points != null ? pts.toLocaleString('en') : '';
}
