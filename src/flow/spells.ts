// The spell runtime: charges, the rune rail beside the die in play, the
// gestures that aim a spell, and the cast itself. Registry and effects are pure
// and live in core/spells.
//
// ONE GATE. Drag the rune onto a column, tap it and then tap a column, or press
// 1–3 with it armed: every path ends in cast(), so legality is asked exactly
// once and a spell can never half-happen.
//
// OPTIONAL BY CONSTRUCTION. Charges are dealt in one place (resetSpells, from
// newGame) and only to a local, non-tutorial game with the preference on.
// Everywhere else — ranked matches, the tutorial, the layer switched off — both
// seats hold an empty hand, the rail is hidden and every entry point here
// no-ops. The game is then exactly the game that shipped before spells existed.
import { AI, ME, SPEC, isFull, type GameState, type Player } from '../core/rules.ts';
import { SPELLS, spellById, freshCharges, type SpellSpec } from '../core/spells.ts';
import { S } from '../state.ts';
import { $, colEl, slotEl, slotIdx, faceRotated } from '../ui/dom.ts';
import { isEmbed, rootRect } from '../ui/embed.ts';
import { Sfx, vibrate } from '../ui/audio.ts';
import { REDUCED, burst, shake, flash, pin, nope, fxRoot } from '../ui/fx.ts';
import { spellIcon, spellHue } from '../ui/spellicons.ts';
import { renderSide, setStatus, showHints } from '../ui/render.ts';
import { colorOf } from '../ui/identity.ts';
import { stopTimer } from './timer.ts';
import { armTimer, endGame, sayChoose } from './game.ts';

/* ===================== WHO HOLDS WHAT ===================== */
/* The rail speaks for ONE seat. Against the machine that is always you — the
   CPU does not cast (v1), so a rail that changed hands every turn would only
   flicker. Two humans share the phone, so it follows whoever is to move. */
function holder(): Player { return S.mode === 'cpu' ? ME : (S.turn as Player); }

/* the player who may cast RIGHT NOW, or null — the same gate placement uses:
   their turn, their choice to make, nothing else in flight */
function caster(): Player | null {
  if (S.phase !== 'choose' || S.busy) return null;
  const who = S.turn as Player;
  if (S.mode === 'cpu' && who !== ME) return null;
  return who;
}

export function chargesOf(who: Player, id: string): number {
  return S.spellsOn ? (S.spellCharges[who][id] ?? 0) : 0;
}
/* was this seat dealt spells at all this game? (an empty hand hides the rail) */
function dealt(who: Player): boolean {
  return S.spellsOn && Object.keys(S.spellCharges[who]).length > 0;
}

/* A new local game deals both seats their charges. The tutorial deals none: it
   is a scripted lesson about the base game, and a spell would break its script. */
export function resetSpells(): void {
  const hand = () => (S.tut ? {} : freshCharges());
  S.spellCharges = [hand(), hand()];
  disarm();
  renderSpells();
}
/* Ranked play holds no spells (see core/spells) — online entry calls this. */
export function clearSpells(): void {
  S.spellCharges = [{}, {}];
  disarm();
  renderSpells();
}

/* ===================== THE RAIL ===================== */
export function renderSpells(): void {
  const bar = $('#spellBar') as HTMLElement | null;
  if (!bar) return;
  if (!bar.childElementCount) build(bar);
  const who = holder();
  bar.hidden = !dealt(who);
  const live = caster() !== null;
  for (const s of SPELLS) {
    const b = bar.querySelector<HTMLButtonElement>('[data-spell="' + s.id + '"]');
    if (!b) continue;
    const left = chargesOf(who, s.id);
    b.classList.toggle('spent', left <= 0);
    b.classList.toggle('ready', left > 0 && live);
    b.classList.toggle('armed', S.spellArmed === s.id);
    b.disabled = left <= 0;
    const n = b.querySelector('.n');
    if (n) n.textContent = left > 1 ? String(left) : '';   // a single charge needs no number
    b.setAttribute('aria-label', s.name + ' — ' + s.blurb
      + (left > 0 ? ' ' + left + ' cast left.' : ' Spent.'));
  }
  document.documentElement.classList.toggle('casting', S.spellArmed !== null);
}

function build(bar: HTMLElement): void {
  for (const s of SPELLS) {
    const b = document.createElement('button');
    b.type = 'button';
    b.className = 'rune';
    b.dataset.spell = s.id;
    b.style.setProperty('--sh', spellHue(s.id));
    b.innerHTML = spellIcon(s.id, 22) + '<b class="n"></b>';
    bind(b, s.id);
    bar.appendChild(b);
  }
}

/* ===================== AIMING ===================== */
export function arm(id: string): void {
  if (S.spellArmed === id) return;
  S.spellArmed = id;
  renderSpells();
  setStatus('Drop it on a column', S.turn as Player, false);
}
export function disarm(): void {
  if (!S.spellArmed) return;
  S.spellArmed = null;
  setHot(null);
  renderSpells();
  if (S.phase === 'choose') sayChoose();
}
/* the armed spell takes a column tap (or a 1–3 key) before placement does.
   null = the tap landed nowhere useful, which simply cancels. */
export function castArmed(col: number | null): boolean {
  const id = S.spellArmed;
  if (!id) return false;
  if (col === null) { Sfx.tap(); disarm(); return true; }
  void cast(id, col);
  return true;
}

/* ===================== THE CAST ===================== */
export async function cast(id: string, col: number): Promise<boolean> {
  const spell = spellById(id);
  const who = caster();
  if (!spell || who === null || chargesOf(who, id) <= 0
      || !spell.legal(S.boards as GameState, who, col)) {
    Sfx.tap();
    nope(colEl(S.turn as Player, col));
    return false;
  }
  disarm();
  S.spellCharges[who][id] = chargesOf(who, id) - 1;
  // the board is mid-effect: no taps, no auto-place, no CPU reply
  S.busy = true;
  S.phase = 'anim';
  stopTimer();
  setStatus(spell.name, who, false);
  const gen = S.gen;
  await perform(spell, who, col);
  if (S.gen !== gen) return true;                  // abandoned mid-cast
  renderSpells();
  // "when EITHER grid is full the game ends". A placement can only fill the
  // mover's own board, which is why place() checks just that one — a spell can
  // fill either, so both are asked here.
  if (isFull(S.boards[ME]) || isFull(S.boards[AI])) { endGame(); return true; }
  S.busy = false;
  S.phase = 'choose';
  showHints();
  sayChoose();
  armTimer();                                      // the board changed: fresh clock
  return true;
}

/* The two stacks physically change places: clones fly while the originals wait
   hidden, so a swap READS as an exchange instead of appearing as a repaint. */
async function perform(spell: SpellSpec, who: Player, col: number): Promise<void> {
  const foe = (1 - who) as Player;
  const flights = REDUCED ? [] : [...lift(who, foe, col), ...lift(foe, who, col)];
  Sfx.spell();
  vibrate([10, 30, 14]);
  await Promise.all(flights.map((f) => f.done));
  spell.apply(S.boards as GameState, who, col);
  renderSide(who, true);
  renderSide(foe, true);
  // renderSide REUSES a die element whose face already matches, inline styles
  // and all — the same trap that once left `.dying` survivors invisible
  // (tests/test13). Clear the hiding after the repaint, never before it.
  reveal(who, col); reveal(foe, col);
  for (const f of flights) f.ghost.remove();
  for (const p of [who, foe] as Player[]) {
    const r = colEl(p, col)?.getBoundingClientRect();
    if (r) burst(r.left + r.width / 2, r.top + r.height / 2, colorOf(p), 14);
  }
  Sfx.mult(); shake(6); flash(0.2);
}

interface Flight { ghost: HTMLElement; done: Promise<unknown>; }

/* lift one column's dice out of the layout and send them to the facing slots */
function lift(from: Player, to: Player, col: number): Flight[] {
  const out: Flight[] = [];
  const n = S.boards[from][col].length;
  for (let i = 0; i < n; i++) {
    const src = slotEl(from, col, slotIdx(from, i))?.firstElementChild as HTMLElement | null;
    const dst = slotEl(to, col, slotIdx(to, i));
    if (!src || !dst) continue;
    const a = src.getBoundingClientRect(), b = dst.getBoundingClientRect();
    const ghost = src.cloneNode(true) as HTMLElement;
    // numerals are drawn upside-down on a face-to-face opponent's half; the
    // flight leaves that half, so the copy wears the DESTINATION's orientation
    ghost.classList.toggle('p2flip', faceRotated(to));
    pin(ghost, a);
    fxRoot().appendChild(ghost);
    src.style.visibility = 'hidden';
    // the two streams bow apart so they visibly pass each other rather than
    // sliding through the same line
    const bow = from === S.bottom ? -1 : 1;
    const anim = ghost.animate([
      { transform: 'translate(0,0) scale(1)' },
      { transform: 'translate(' + (b.left - a.left) / 2 + 'px,' + (b.top - a.top) / 2 + 'px)'
                 + ' translateX(' + (bow * 30) + 'px) scale(1.07) rotate(' + (bow * 9) + 'deg)', offset: .5 },
      { transform: 'translate(' + (b.left - a.left) + 'px,' + (b.top - a.top) + 'px) scale(1) rotate(0deg)' },
    ], { duration: 480, delay: i * 30, easing: 'cubic-bezier(.55,.05,.25,1)', fill: 'both' });
    out.push({ ghost, done: anim.finished.catch(() => {}) });
  }
  return out;
}
/* undo lift()'s hiding across a whole column, whatever survived the repaint */
function reveal(who: Player, col: number): void {
  for (let i = 0; i < SPEC.rows; i++) {
    const d = slotEl(who, col, slotIdx(who, i))?.firstElementChild as HTMLElement | null;
    if (d) d.style.visibility = '';
  }
}

/* ===================== GESTURES =====================
   Press the rune and drag it onto a column, or tap it and tap a column. Both
   are the same aim-then-confirm; the drag is just the one that shows you what
   you are about to do. */
const SLOP = 8;                      // px before a press becomes a drag

/* The rune's gesture is the RUNE'S. Every one of its pointer events is stopped
   here: the whole rail sits inside #tableEl, whose own pointerup means "you
   pointed at the board" — and a tap that lands nowhere on the board cancels
   aiming. Left to bubble, arming the rune instantly disarmed it. */
function bind(b: HTMLButtonElement, id: string): void {
  if (!window.PointerEvent) {        // hosts without pointer events: arm on click
    b.addEventListener('click', (e) => {
      e.stopPropagation();
      S.spellArmed === id ? disarm() : tryArm(b, id);
    });
    return;
  }
  b.addEventListener('click', (e) => e.stopPropagation());   // the trailing synthetic one
  b.addEventListener('pointerdown', (e: PointerEvent) => {
    e.preventDefault();
    e.stopPropagation();
    const wasArmed = S.spellArmed === id;
    if (!tryArm(b, id)) return;
    const x0 = e.clientX, y0 = e.clientY;
    let dragging = false;
    const move = (m: PointerEvent) => {
      if (!dragging && Math.hypot(m.clientX - x0, m.clientY - y0) > SLOP) {
        dragging = true;
        showGhost(id);
      }
      if (dragging) moveGhost(m.clientX, m.clientY);
    };
    const up = (u: PointerEvent) => {
      u.stopPropagation();
      b.removeEventListener('pointermove', move);
      b.removeEventListener('pointerup', up);
      b.removeEventListener('pointercancel', up);
      if (!dragging) {
        if (wasArmed) { Sfx.tap(); disarm(); }   // a second tap puts it away
        return;
      }
      const col = columnAt(u.clientX, u.clientY);
      hideGhost();
      if (col === null) { Sfx.tap(); disarm(); return; }
      void cast(id, col);
    };
    b.setPointerCapture(e.pointerId);
    b.addEventListener('pointermove', move);
    b.addEventListener('pointerup', up);
    b.addEventListener('pointercancel', up);
  });
}

function tryArm(b: HTMLButtonElement, id: string): boolean {
  if (caster() === null || chargesOf(holder(), id) <= 0) { Sfx.tap(); bump(b); return false; }
  Sfx.tap();
  arm(id);
  return true;
}
/* the rune's own refusal — the column shake would be pointing at nothing */
function bump(b: HTMLElement): void {
  b.classList.remove('bump'); void b.offsetWidth; b.classList.add('bump');
}

/* ---- the dragged rune, and the column under it ---- */
let ghostEl: HTMLElement | null = null;
function showGhost(id: string): void {
  hideGhost();
  const g = document.createElement('div');
  g.className = 'runeghost';
  g.style.setProperty('--sh', spellHue(id));
  g.style.position = isEmbed() ? 'absolute' : 'fixed';
  g.innerHTML = spellIcon(id, 26);
  fxRoot().appendChild(g);
  ghostEl = g;
}
function moveGhost(x: number, y: number): void {
  if (!ghostEl) return;
  const off = isEmbed() ? rootRect() : { left: 0, top: 0 };
  ghostEl.style.left = (x - off.left) + 'px';
  ghostEl.style.top = (y - off.top) + 'px';
  setHot(columnAt(x, y));
}
function hideGhost(): void {
  ghostEl?.remove();
  ghostEl = null;
}
function columnAt(x: number, y: number): number | null {
  const el = document.elementFromPoint(x, y);
  const col = el && (el as HTMLElement).closest ? (el as HTMLElement).closest('.col') : null;
  if (!col) return null;
  const c = Number((col as HTMLElement).dataset.col);
  return Number.isInteger(c) ? c : null;
}
/* Highlight BOTH facing columns, not just the one under the finger: a swap
   always takes two, and showing the pair before the drop is the explanation. */
function setHot(col: number | null): void {
  document.querySelectorAll('.col.hot').forEach((c) => c.classList.remove('hot'));
  if (col === null) return;
  for (const p of [ME, AI] as Player[]) colEl(p, col)?.classList.add('hot');
}
