// Juice: particles, floating score numbers, shake, flash. All of it honours
// prefers-reduced-motion (informative feedback degrades to a plain fade;
// decoration is skipped outright).
import { SPEC, type Player } from '../core/rules.ts';
import { S } from '../state.ts';
import { $, colEl, slotEl, slotIdx, faceRotated } from './dom.ts';
import { appRoot, isEmbed, rootRect } from './embed.ts';
import { setReducedMotionPresentation } from './game/root-state.ts';

const SYSTEM_REDUCED: boolean = (() => {
  try { return window.matchMedia('(prefers-reduced-motion: reduce)').matches; }
  catch { return false; }
})();

/* A live binding: every effect module reads the effective preference at the
   moment it acts. null follows the OS default; an explicit in-app choice wins
   thereafter. The root class gives CSS the same live answer. */
export let REDUCED = SYSTEM_REDUCED;
export function setReducedMotion(override: boolean | null): void {
  REDUCED = override ?? SYSTEM_REDUCED;
  setReducedMotionPresentation(REDUCED);
}

/* ---- flying copies ----
   Animating something FROM where the player can see it means lifting a copy out
   of the layout and pinning it over the original. Two callers do it (a die
   flying to its slot, a spell swapping two stacks) and both need the same
   embed dance: fixed on the standalone page, absolute inside the widget's root,
   which is its own containing block. One definition, so that difference is
   handled once. */
export function fxRoot(): HTMLElement { return appRoot(); }

export function pin(el: HTMLElement, r: DOMRect, z = 60): void {
  const off = isEmbed() ? rootRect() : { left: 0, top: 0 };
  el.style.position = isEmbed() ? 'absolute' : 'fixed';
  el.style.left = (r.left - off.left) + 'px';
  el.style.top = (r.top - off.top) + 'px';
  el.style.width = r.width + 'px';
  el.style.height = r.height + 'px';
  el.style.setProperty('--cell', r.width + 'px');
  el.style.zIndex = String(z);
}

/* "not there" — the one refusal gesture, shared by every input path that can
   point at a column it may not have (a full column, the wrong column in a
   lesson, an illegal spell target). */
export function nope(el: HTMLElement | null): void {
  if (!el) return;
  el.classList.add('nope');
  setTimeout(() => el.classList.remove('nope'), 340);
}

/* opts exist for the ONE caller that needs a different scale — a firework is
   the same burst, thrown further and drawn bigger. A second particle engine
   would only drift from this one. */
export interface BurstOpts { host?: HTMLElement | null; size?: number; dist?: number }
export function burst(x: number, y: number, color: string, n?: number, opts?: BurstOpts): void {
  if (REDUCED) return;
  const fx = opts?.host ?? $('#fx');
  const size = opts?.size ?? 1, reach = opts?.dist ?? 1;
  if (isEmbed()) { const rr = rootRect(); x -= rr.left; y -= rr.top; }
  n = n || 16;
  for (let i = 0; i < n; i++) {
    const p = document.createElement('i');
    p.className = 'particle';
    p.style.left = x + 'px'; p.style.top = y + 'px';
    p.style.background = color;
    p.style.boxShadow = '0 0 ' + (10 * size) + 'px ' + color + ',0 0 ' + (26 * size) + 'px ' + color;
    const sz = (4 + Math.random() * 6) * size;
    p.style.width = sz + 'px'; p.style.height = sz + 'px';
    fx.appendChild(p);
    const a = Math.random() * Math.PI * 2, dist = (34 + Math.random() * 84) * reach;
    const an = p.animate([
      { transform: 'translate(-50%,-50%) scale(1)', opacity: 1 },
      { transform: 'translate(calc(-50% + ' + (Math.cos(a) * dist) + 'px), calc(-50% + ' + (Math.sin(a) * dist) + 'px)) scale(0)', opacity: 0 }
    ], { duration: 400 + Math.random() * 380, easing: 'cubic-bezier(.15,.75,.3,1)' });
    an.onfinish = () => p.remove();
  }
}

/* Floating score feedback. Pip feedback belongs to the relative column;
   numeral feedback belongs to its actual die. Both avoid viewport maths, so
   standalone, widget, portrait and landscape share this one path. */
export function floatPts(who: Player, col: number, text: string, color: string, anchorIndex?: number): void {
  const colE = colEl(who, col); if (!colE) return;
  const idx = Math.max(0, Math.min(SPEC.rows - 1,
    anchorIndex ?? S.boards[who][col].length - 1));
  const slot = slotEl(who, col, slotIdx(who, idx)) || colE;
  const p = document.createElement('b');
  p.className = 'pts'; p.textContent = text; p.style.color = color;
  const die = slot.querySelector<HTMLElement>(':scope > .die.game-die');
  const numeral = die?.querySelector<HTMLElement>(':scope > .num');
  const numeralFace = !!numeral && getComputedStyle(numeral).display !== 'none';
  if (numeralFace) {
    p.classList.add('numeral-pts');
    /* BOUNTY can report placement and bounty on the same die before the first
       fade ends. The newer, more specific total replaces that header instead
       of drawing two unreadable labels in the same band. */
    colE.querySelectorAll<HTMLElement>('.pts.numeral-pts').forEach((old) => {
      old.getAnimations().forEach((animation) => animation.cancel());
      old.remove();
    });
  }
  p.style.left = numeralFace && die
    ? '50%'
    : (slot.offsetLeft + slot.offsetWidth / 2) + 'px';
  (numeralFace && die ? die : colE).appendChild(p);
  /* A pip face leaves its middle free, so the existing rise can begin there.
     A numeral owns that centre: its smaller score label stays inside the die's
     reading-top band. The far face-to-face seat reads from the physical bottom.
     Keeping the label in the die also makes destruction transforms carry both
     together, so a visible minus cannot drift outside its shrinking victim. */
  const flippedNumeral = numeralFace && faceRotated(who);
  if (numeralFace && die) {
    /* Hold the compact header a few pixels inside its reading edge. Anchoring
       with top/bottom keeps the same inset for both seats without measuring
       the label or accumulating a fractional rotated offset. */
    p.style.top = flippedNumeral ? 'auto' : '3px';
    if (flippedNumeral) p.style.bottom = '3px';
  } else {
    p.style.top = (slot.offsetTop + slot.offsetHeight * .30) + 'px';
  }
  /* informative, so reduced motion gets a plain fade instead of nothing */
  const rot = faceRotated(who) ? ' rotate(180deg)' : '';
  const base = 'translate(-50%,0)' + rot;
  p.style.transform = base;
  const anim = REDUCED
    ? p.animate([{ opacity: 0 }, { opacity: 1, offset: .25 }, { opacity: 1, offset: .75 }, { opacity: 0 }], { duration: 750 })
    : numeralFace
      ? p.animate([
          { transform: 'translate(-50%,0) scale(.72)' + rot, opacity: 0 },
          { transform: 'translate(-50%,0) scale(1)' + rot, opacity: 1, offset: .28 },
          { transform: base, opacity: 0 }
        ], { duration: 900, easing: 'cubic-bezier(.2,.7,.3,1)' })
      : p.animate([
          { transform: 'translate(-50%,0) scale(.6)' + rot, opacity: 0 },
          { transform: 'translate(-50%,-16px) scale(1.18)' + rot, opacity: 1, offset: .28 },
          { transform: 'translate(-50%,-44px) scale(1)' + rot, opacity: 0 }
        ], { duration: 900, easing: 'cubic-bezier(.2,.7,.3,1)' });
  anim.onfinish = () => p.remove();
}

/* ---- fireworks ----
   A win used to get five small puffs inside the winner's half of the board,
   over in 650ms — and a RANKED win got nothing at all, because the celebration
   lived in the local flow rather than in the result screen. This is the one
   show, fired by ui/endscreen for either kind of win: shells that climb from
   the bottom of the screen, hang, and burst into sparks that fall.
   Everything is WAAPI on throwaway elements in the #fx layer, so nothing here
   can leave residue in the layout. */
const SHELLS = 6;

export function fireworks(palette: string[], into?: HTMLElement | null): void {
  if (REDUCED) return;                       // informative? no. decoration — skip it.
  const host = into ?? $('#fx');
  if (!host) return;
  const box = isEmbed() ? rootRect() : { left: 0, top: 0, width: innerWidth, height: innerHeight };
  for (let i = 0; i < SHELLS; i++) {
    // spread across the width, never dead centre where the title sits
    const x = box.width * (0.12 + 0.76 * ((i + (Math.random() * 0.6)) / SHELLS));
    const peak = box.height * (0.18 + Math.random() * 0.3);
    const color = palette[(Math.random() * palette.length) | 0];
    setTimeout(() => shell(host, x, box.height, peak, color), i * 190 + Math.random() * 120);
  }
}

/* one shell: a climbing ember, then the burst it turns into */
function shell(host: HTMLElement, x: number, fromY: number, peakY: number, color: string): void {
  const ember = document.createElement('i');
  ember.className = 'particle';
  ember.style.left = x + 'px';
  ember.style.top = fromY + 'px';
  ember.style.width = ember.style.height = '5px';
  ember.style.background = color;
  ember.style.boxShadow = '0 0 14px ' + color + ', 0 14px 22px ' + color;
  host.appendChild(ember);
  const climb = ember.animate([
    { transform: 'translate(-50%,-50%) scale(1)', opacity: 1 },
    { transform: 'translate(-50%,calc(-50% - ' + (fromY - peakY) + 'px)) scale(.7)', opacity: .9 },
  ], { duration: 520 + Math.random() * 160, easing: 'cubic-bezier(.15,.7,.4,1)' });
  climb.onfinish = () => {
    ember.remove();
    // the same particle engine as everything else, thrown twice as far
    burst(x, peakY, color, 38, { host, size: 1.7, dist: 2.1 });
    ring(host, x, peakY, color);
    flash(0.14);
  };
}

/* the shockwave a burst leaves behind — one expanding hoop, gone in 600ms */
function ring(host: HTMLElement, x: number, y: number, color: string): void {
  const r = document.createElement('i');
  r.className = 'fwring';
  r.style.left = x + 'px';
  r.style.top = y + 'px';
  r.style.borderColor = color;
  host.appendChild(r);
  const a = r.animate([
    { transform: 'translate(-50%,-50%) scale(.1)', opacity: .9 },
    { transform: 'translate(-50%,-50%) scale(2.6)', opacity: 0 },
  ], { duration: 620, easing: 'cubic-bezier(.1,.7,.3,1)' });
  a.onfinish = () => r.remove();
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
