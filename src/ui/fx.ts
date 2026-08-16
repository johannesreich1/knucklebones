// Juice: particles, floating score numbers, shake, flash. All of it honours
// prefers-reduced-motion (informative feedback degrades to a plain fade;
// decoration is skipped outright).
import { SPEC, type Player } from '../core/rules';
import { S } from '../state';
import { $, colEl, slotEl, slotIdx, faceRotated } from './dom';
import { isEmbed, rootRect } from './embed';

export const REDUCED: boolean = (() => {
  try { return window.matchMedia('(prefers-reduced-motion: reduce)').matches; }
  catch { return false; }
})();

export function burst(x: number, y: number, color: string, n?: number): void {
  if (REDUCED) return;
  const fx = $('#fx');
  if (isEmbed()) { const rr = rootRect(); x -= rr.left; y -= rr.top; }
  n = n || 16;
  for (let i = 0; i < n; i++) {
    const p = document.createElement('i');
    p.className = 'particle';
    p.style.left = x + 'px'; p.style.top = y + 'px';
    p.style.background = color;
    p.style.boxShadow = '0 0 10px ' + color;
    const sz = 4 + Math.random() * 6;
    p.style.width = sz + 'px'; p.style.height = sz + 'px';
    fx.appendChild(p);
    const a = Math.random() * Math.PI * 2, dist = 34 + Math.random() * 84;
    const an = p.animate([
      { transform: 'translate(-50%,-50%) scale(1)', opacity: 1 },
      { transform: 'translate(calc(-50% + ' + (Math.cos(a) * dist) + 'px), calc(-50% + ' + (Math.sin(a) * dist) + 'px)) scale(0)', opacity: 0 }
    ], { duration: 400 + Math.random() * 380, easing: 'cubic-bezier(.15,.75,.3,1)' });
    an.onfinish = () => p.remove();
  }
}

/* Floating score feedback. Anchored inside the column element itself (which is
   position:relative), so it needs no viewport maths and works unchanged in the
   standalone page, the widget iframe, portrait and landscape. */
export function floatPts(who: Player, col: number, text: string, color: string): void {
  const colE = colEl(who, col); if (!colE) return;
  const idx = Math.max(0, Math.min(SPEC.rows - 1, S.boards[who][col].length - 1));
  const slot = slotEl(who, col, slotIdx(who, idx)) || colE;
  const p = document.createElement('b');
  p.className = 'pts'; p.textContent = text; p.style.color = color;
  p.style.left = (slot.offsetLeft + slot.offsetWidth / 2) + 'px';
  p.style.top = (slot.offsetTop + slot.offsetHeight * 0.30) + 'px';
  colE.appendChild(p);
  /* informative, so reduced motion gets a plain fade instead of nothing */
  const rot = faceRotated(who) ? ' rotate(180deg)' : '';
  if (REDUCED) p.style.transform = 'translate(-50%,0)' + rot;
  const anim = REDUCED
    ? p.animate([{ opacity: 0 }, { opacity: 1, offset: .25 }, { opacity: 1, offset: .75 }, { opacity: 0 }], { duration: 750 })
    : p.animate([
        { transform: 'translate(-50%,0) scale(.6)' + rot, opacity: 0 },
        { transform: 'translate(-50%,-16px) scale(1.18)' + rot, opacity: 1, offset: .28 },
        { transform: 'translate(-50%,-44px) scale(1)' + rot, opacity: 0 }
      ], { duration: 900, easing: 'cubic-bezier(.2,.7,.3,1)' });
  anim.onfinish = () => p.remove();
}

export function shake(power?: number): void {
  if (REDUCED) return;
  const el = $('#app'); power = power || 6;
  el.animate([
    { transform: 'translate(0,0)' }, { transform: 'translate(' + power + 'px,' + (-power * 0.6) + 'px)' },
    { transform: 'translate(' + (-power) + 'px,' + (power * 0.5) + 'px)' }, { transform: 'translate(' + (power * 0.6) + 'px,' + (power * 0.4) + 'px)' },
    { transform: 'translate(0,0)' }
  ], { duration: 260, easing: 'ease-out' });
}

export function flash(alpha?: number): void {
  if (REDUCED) return;
  const f = $('#flash');
  f.animate([{ opacity: 0 }, { opacity: alpha || 0.28 }, { opacity: 0 }], { duration: 220, easing: 'ease-out' });
}
