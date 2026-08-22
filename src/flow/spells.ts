// The spell runtime: charges, the rune rail beside the die in play, the
// gestures that aim a spell, and the cast itself. Registry, effects and the
// machine's policy are pure and live in core/spells.
//
// ONE GATE. Drag the rune onto its target (a column, or the die in play for a
// self spell), tap it and then tap the target, or press 1–3 with a column
// spell armed: every path ends in cast(), so legality is asked exactly once
// and a spell can never half-happen.
//
// OPTIONAL BY CONSTRUCTION. Charges are dealt in one place (resetSpells, from
// newGame) and only to a local, non-tutorial game with the preference on.
// Everywhere else — ranked matches, the tutorial, the layer switched off — both
// seats hold an empty hand, the rail is hidden and every entry point here
// no-ops. The game is then exactly the game that shipped before spells existed.
import { AI, ME, SPEC, isFull, freshCharm, cloneSt,
         type GameState, type Player } from '../core/rules.ts';
import { SPELLS, RANDOM_SPELL, spellById, freshCharges, machineCast,
         type SpellSpec, type CastCtx } from '../core/spells.ts';
import { S } from '../state.ts';
import { $, colEl, slotEl, slotIdx, sideKey, faceRotated } from '../ui/dom.ts';
import { isEmbed, rootRect } from '../ui/embed.ts';
import { Sfx, vibrate } from '../ui/audio.ts';
import { REDUCED, burst, shake, flash, pin, nope, fxRoot } from '../ui/fx.ts';
import { spellIcon, spellHue } from '../ui/spellicons.ts';
import { renderSide, setStatus, showHints } from '../ui/render.ts';
import { colorOf, nameOf } from '../ui/identity.ts';
import { setStageDie } from '../ui/die.ts';
import { renderBag } from '../ui/bag.ts';
import { stopTimer } from './timer.ts';
import { armTimer, endGame, sayChoose } from './game.ts';

/* ===================== WHO HOLDS WHAT ===================== */
/* the player who may cast RIGHT NOW, or null — the same gate placement uses:
   their turn, their choice to make, nothing else in flight */
function caster(): Player | null {
  if (S.phase !== 'choose' || S.busy) return null;
  const who = S.turn as Player;
  if (S.mode === 'cpu' && who !== ME) return null;
  return who;
}

/* THE cast context: everything a spell may reach beyond the boards, built in
   exactly one place so every caster — a gesture, the CPU — hands the effect
   the same live hand, supply and charm. Offline supply is Math.random (nobody
   replays a local game); LIMITED's finite bag is consumed for real, and the
   bag readout ticks with it. */
function castCtx(): CastCtx {
  return {
    mode: S.scoring,
    die: S.die,
    setDie: (v) => { S.die = v; setStageDie(v, S.turn as Player); },
    draw: () => {
      if (!S.pool) return 1 + ((Math.random() * 6) | 0);
      const v = S.pool.shift()!;
      renderBag(S.pool.length);
      return v;
    },
    bagLeft: S.pool ? S.pool.length : null,
    charm: S.charm,
  };
}

export function chargesOf(who: Player, id: string): number {
  return S.spellCharges[who][id] ?? 0;
}
/* A new local game deals both seats the spell the OFFLINE screen picked — NONE
   deals nothing, and so does the tutorial: it is a scripted lesson about the
   base game, and a spell would break its script. The charm resets with the
   charges: marks are a game's marks, never a session's. */
/* WHICH rune this game deals. RANDOM draws one here, because core/spells stays
   free of randomness. Drawn ONCE per game: both seats must hold the same rune,
   which is the whole reason the layer is fair.
   EXPORTED because startLocal draws it a moment EARLY — the reveal has to show
   the player the rune before the game is dealt, and a rune it drew itself
   would be a second draw and a different answer (exactly the bug the mode's
   `opts.scoring` exists to prevent). Every other door into a game reaches this
   through resetSpells' fallback, so no door can forget. */
export function drawSpell(): string {
  if (S.spell !== RANDOM_SPELL) return S.spell;
  return SPELLS[(Math.random() * SPELLS.length) | 0].id;
}
/** `dealt` is the rune the reveal already showed; without one, draw it here */
export function resetSpells(dealt?: string): void {
  const id = S.tut ? '' : (dealt ?? drawSpell());
  S.spellCharges = [freshCharges(id), freshCharges(id)];
  S.charm = freshCharm();
  S.spellUndo = null;
  disarm();
  renderSpells();
}
/* Ranked play holds no spells (see core/spells) — online entry calls this. */
export function clearSpells(): void {
  S.spellCharges = [{}, {}];
  S.charm = freshCharm();
  S.spellUndo = null;
  disarm();
  renderSpells();
}

/* ===================== THE RAIL ===================== */
/* TWO JOBS, TWO PLACES — because they are not the same object.
   The rune you can cast is a THING YOU WIELD: it belongs beside the die in
   play, full size, within a short drag of every column. The other player's is
   a READOUT — "do they still have it?" — so it sits small and inert in their
   nameplate next to their score, where it can be read at a glance and cannot
   be pressed. Making them identical implied you could cast theirs, and buried
   the one you can cast in a corner.
   Which seat holds the near rune: the player nearest the phone, except
   face-to-face, where the whole centre stage already turns to whoever is
   moving — so it follows the turn there, and turns with it. */
export function renderSpells(): void {
  const bar = $('#spellBar') as HTMLElement | null;
  if (!bar) return;
  if (!built) build();
  const face = document.documentElement.classList.contains('face');
  const near = (face ? S.turn : S.bottom) as Player;
  const now = caster();
  for (const seat of [AI, ME] as Player[]) {
    const home = seat === near ? bar
      : $('#plate' + (sideKey(seat) === 'bot' ? 'Bot' : 'Top'))?.querySelector('.runeslot');
    for (const s of SPELLS) {
      const b = runeOf(seat, s.id);
      if (!b || !home) continue;
      if (b.parentElement !== home) home.appendChild(b);
      b.hidden = !(s.id in S.spellCharges[seat]);   // you carry what you BROUGHT
      const left = chargesOf(seat, s.id);
      /* LOOK follows facts that hold for the whole game — whose rune it is and
         whether it is still loaded. INTERACTION follows the turn. Keeping those
         apart is what stops the flicker: when `ready` meant "castable right
         now" it flipped twice per turn, restarting the ring's animation from
         its first keyframe each time, and the glow visibly snapped. */
      const readout = seat !== near;                // the other player's: an indicator
      /* spent, but still takeable back: the press that cast it is also the
         press that returns it, so the rune must not read as dead yet */
      const canUndo = seat === now && undoable(s.id);
      b.style.setProperty('--sh', colorOf(seat));   // whose rune, in the game's own two colours
      b.classList.toggle('spent', left <= 0 && !canUndo);
      b.classList.toggle('undo', canUndo);
      b.classList.toggle('ready', left > 0 && !readout);
      b.classList.toggle('idle', left > 0 && readout);
      b.classList.toggle('armed', S.spellArmed === s.id && seat === now);
      b.disabled = (left <= 0 && !canUndo) || seat !== now;   // the turn decides the rest
      const n = b.querySelector('.n');
      if (n) n.textContent = left > 1 ? String(left) : '';   // a single charge needs no number
      b.setAttribute('aria-label', nameOf(seat) + ': ' + s.name + ' — ' + s.blurb
        + (canUndo ? ' Cast — press again to put it back.'
          : left > 0 ? ' ' + left + ' cast left.' : ' Spent.'));
    }
  }
  /* the plate keeps the rune's place for the WHOLE game, not just the turns
     the rune spends there. The rail and the plate trade the rune every turn
     in face-to-face play, and a slot that collapsed when it left re-centred
     the score cluster with it — the number and the rune visibly jumped 10px
     each turn. A seat that brought a spell reserves the space; a game with
     no spells reserves nothing and the nameplate is exactly what it was. */
  for (const seat of [AI, ME] as Player[]) {
    const slot = $('#plate' + (sideKey(seat) === 'bot' ? 'Bot' : 'Top'))?.querySelector('.runeslot');
    slot?.classList.toggle('live', Object.keys(S.spellCharges[seat]).length > 0);
  }
  const armed = spellById(S.spellArmed);
  document.documentElement.classList.toggle('casting', armed !== null);
  // a self spell aims at the die in play, not the board: the columns stand
  // down and the stage lights up instead (styles/main.css html.castself)
  document.documentElement.classList.toggle('castself', armed?.target === 'self');
  markAim(armed);
}

/* WHICH columns the armed spell can actually be dropped on — asked from the
   registry, never from a list kept here. The board rings exactly these, so a
   WARD advertises your three columns and a PILFER theirs; ringing all six
   (which the symmetrical COLUMN SWAP could honestly do) told the player that
   half the board was a target when it was not. */
function markAim(spell: SpellSpec | null): void {
  document.querySelectorAll('.col.aim').forEach((c) => c.classList.remove('aim'));
  const who = caster();
  if (!spell || who === null || spell.target !== 'column') return;
  const side = (spell.side === 'foe' ? 1 - who : who) as Player;
  const ctx = castCtx();
  for (let c = 0; c < SPEC.cols; c++) {
    if (spell.legal(S.boards as GameState, who, c, ctx)) colEl(side, c)?.classList.add('aim');
  }
}
/* is this column a target the rings promised? ONE question for every input
   path — drag, tap and the 1–3 keys all ask it, so they cannot disagree. */
function aimed(col: number): boolean {
  return !!document.querySelector('.col.aim[data-col="' + col + '"]');
}

/* one rune per seat per spell, made once and re-homed by the render */
let built = false;
const runes = new Map<string, HTMLButtonElement>();
const key = (seat: Player, id: string) => seat + ':' + id;
const runeOf = (seat: Player, id: string) => runes.get(key(seat, id)) ?? null;
function build(): void {
  built = true;
  for (const seat of [AI, ME] as Player[]) {
    for (const s of SPELLS) {
      const b = document.createElement('button');
      b.type = 'button';
      b.className = 'rune';
      b.dataset.spell = s.id;
      b.dataset.seat = String(seat);
      /* 16, not 15: the rune's box is an EVEN 20px in a nameplate, so an odd
         icon centres on a half pixel and the glowing mark straddles the device
         grid forever — it never rasterises the same way twice, which is the
         shimmer that reads as the icon moving (user report, three times).
         Even icon in an even box lands on whole pixels. */
      b.innerHTML = spellIcon(s.id, 16) + '<b class="n"></b>';
      bind(b, s.id);
      runes.set(key(seat, s.id), b);
    }
  }
}

/* ===================== AIMING ===================== */
export function arm(id: string): void {
  if (S.spellArmed === id) return;
  S.spellArmed = id;
  renderSpells();
  const spell = spellById(id);
  if (spell) setStatus(spell.aim, S.turn as Player);
}
export function disarm(): void {
  if (!S.spellArmed) return;
  S.spellArmed = null;
  setHot(null);
  stageHot(false);
  renderSpells();
  if (S.phase === 'choose') sayChoose();
}
/* the armed spell takes the tap before placement does. What arrives is the
   TARGET the tap landed on: a column index, −1 for the die in play, or null —
   nowhere useful, which simply cancels. A target of the wrong kind for the
   armed spell cancels too: aiming a WARD at the die means nothing, and so
   does dropping it on a column the rings never offered. */
export function castArmed(col: number | null): boolean {
  const id = S.spellArmed;
  if (!id) return false;
  const spell = spellById(id);
  const fits = col !== null && !!spell
    && (spell.target === 'self' ? col === -1 : col >= 0 && aimed(col));
  if (!fits) { Sfx.tap(); disarm(); return true; }
  void cast(id, col!);
  return true;
}

/* ===================== THE CAST =====================
   castBy() is the engine: spend, perform, and answer whether the game ended.
   It takes the caster as an argument rather than asking who is allowed to act,
   because two very different callers drive it — a player's gesture, which has
   to be gated first, and the machine on its own turn, which is already inside
   its turn. Both spend the same charge and run the same effect. */
async function castBy(who: Player, spell: SpellSpec, col: number, ctx: CastCtx): Promise<boolean> {
  /* A self spell lands on the die in hand the instant it is pressed, so the
     press is also the way back: snapshot what it is about to change. Taken
     BEFORE the effect and as a SNAPSHOT, not a per-spell inverse — a spell
     never has to know it can be undone. Two casts are never offered the
     window: board spells, whose dice have visibly flown, and the ones the
     registry marks `final` because they already paid out — asked of the
     registry, never of a spell's name (core/spells). */
  S.spellUndo = spell.target === 'self' && !spell.final ? {
    id: spell.id, who, die: S.die,
    pool: S.pool ? S.pool.slice() : null,
    charm: { wards: [S.charm.wards[0].slice(), S.charm.wards[1].slice()],
             sunder: [S.charm.sunder[0], S.charm.sunder[1]] },
  } : null;
  S.spellCharges[who][spell.id] = chargesOf(who, spell.id) - 1;
  // the board is mid-effect: no taps, no auto-place, no CPU reply
  S.busy = true;
  S.phase = 'anim';
  stopTimer();
  setStatus(S.mode === 'cpu' && who === AI ? 'AI — ' + spell.name : spell.name, who);
  const gen = S.gen;
  const fx = CAST_FX[spell.id] ?? defaultFx;
  await fx(who, col, () => spell.apply(S.boards as GameState, who, col, ctx));
  if (S.gen !== gen) return true;                  // abandoned mid-cast: nothing to hand back
  renderSpells();
  // "when EITHER grid is full the game ends". A placement can only fill the
  // mover's own board, which is why place() checks just that one — a spell can
  // fill either, so both are asked here.
  if (isFull(S.boards[ME]) || isFull(S.boards[AI])) { endGame(); return true; }
  return false;
}

/* the player's entry: gate first, then the engine, then hand the turn back —
   the die is still in hand, so a cast is not a move */
export async function cast(id: string, col: number): Promise<boolean> {
  const spell = spellById(id);
  const who = caster();
  const ctx = castCtx();
  if (!spell || who === null || chargesOf(who, id) <= 0
      || !spell.legal(S.boards as GameState, who, col, ctx)) {
    Sfx.tap();
    if (spell?.target === 'column' && col >= 0) nope(colEl(S.turn as Player, col));
    disarm();
    return false;
  }
  disarm();
  const over = await castBy(who, spell, col, ctx);
  if (over) return true;
  S.busy = false;
  S.phase = 'choose';
  showHints();
  sayChoose();
  armTimer();                                      // the board changed: fresh clock
  return true;
}

/* ===================== THE TAKE-BACK =====================
   Pressing a self rune again puts the cast back, for as long as the die it
   changed is still in hand. `place()` spends the turn for real and clears it,
   as does the turn passing, a new game or arming anything else — so the
   window is exactly "this die, still unplayed". */
export function undoable(id: string): boolean {
  const u = S.spellUndo;
  return !!u && u.id === id && u.who === caster() && S.phase === 'choose' && !S.busy;
}
export function clearUndo(): void { S.spellUndo = null; }

export function undoCast(): boolean {
  const u = S.spellUndo;
  if (!u || !undoable(u.id)) return false;
  const spell = spellById(u.id);
  S.spellUndo = null;
  S.die = u.die;
  setStageDie(u.die, u.who);
  S.charm = { wards: [u.charm.wards[0].slice(), u.charm.wards[1].slice()],
              sunder: [u.charm.sunder[0], u.charm.sunder[1]] };
  if (u.pool) { S.pool = u.pool.slice(); renderBag(S.pool.length); }   // FATE's draw goes back in the bag
  S.spellCharges[u.who][u.id] = chargesOf(u.who, u.id) + 1;
  const stage = $('#dieStage') as HTMLElement | null;
  stage?.classList.remove('sundered');            // SUNDER's mark leaves with it
  Sfx.tap();
  vibrate(12);
  renderSide(AI, true);
  renderSide(ME, true);                           // a ward chip, if one was placed
  renderSpells();
  showHints();
  setStatus((spell ? spell.name : 'Spell') + ' put back', u.who);
  return true;
}

/* ===================== THE MACHINE'S SIDE =====================
   The CPU holds the same rune the player does, so it has to spend it or the
   offline game is simply unfair. WHETHER and WHERE to cast is core/spells
   machineCast — the very policy the balance harness measured — and how
   eagerly is the difficulty: the demand it makes, in points of score
   difference, before a charge is worth spending. */
const DEMANDS: Record<string, number> = { easy: 30, medium: 16, hard: 10 };

/* Called on the machine's turn, BEFORE it chooses a column — the same moment
   in the turn the player gets. Returns whether the game ended on the cast.
   The board it then plays into is the board the cast left behind: aiChoose()
   runs afterwards and sees the new position (and, after FATE, the new die),
   with no extra plumbing. */
export async function aiSpellTurn(who: Player): Promise<boolean> {
  const id = Object.keys(S.spellCharges[who]).find((k) => chargesOf(who, k) > 0);
  const spell = spellById(id);
  if (!spell) return false;
  if (S.diff === 'easy' && Math.random() < 0.5) return false;   // easy often just misses it
  const ctx = castCtx();
  const col = machineCast(S.boards as GameState, who, spell, ctx, DEMANDS[S.diff] ?? DEMANDS.medium);
  if (col === null) return false;
  return castBy(who, spell, col, ctx);
}

/* ===================== THE CASTS, PERFORMED =====================
   One entry per spell id: the animation that makes the effect READ, around an
   apply() it calls at the beat where the state may change. Adding a spell is
   adding its entry here — castBy never learns a name. */
type Fx = (who: Player, col: number, apply: () => void) => Promise<void>;
const wait = (ms: number) => new Promise((r) => setTimeout(r, ms));

const defaultFx: Fx = async (who, col, apply) => {
  Sfx.spell();
  vibrate([10, 30, 14]);
  apply();
  renderSide(AI, true);
  renderSide(ME, true);
};

/* FATE re-rolls the die on its stage: a short rattle, then the drawn face
   pops — the same language rollDice speaks, shortened */
const fateFx: Fx = async (who, col, apply) => {
  const stage = $('#dieStage') as HTMLElement;
  Sfx.spell();
  vibrate([10, 30, 14]);
  const gen = S.gen;
  if (!REDUCED && stage) {
    stage.classList.add('rolling');
    const t0 = performance.now();
    while (performance.now() - t0 < 330) {
      if (S.gen !== gen) { stage.classList.remove('rolling'); return; }
      setStageDie(1 + ((Math.random() * 6) | 0), who);
      Sfx.tick();
      await wait(55);
    }
    stage.classList.remove('rolling');
  }
  apply();                                         // setDie lands the drawn face
  if (stage) {
    stage.classList.add('pop');
    setTimeout(() => stage.classList.remove('pop'), 320);
    const r = stage.getBoundingClientRect();
    burst(r.left + r.width / 2, r.top + r.height / 2, spellHue('fate'), 12);
  }
};

/* NUDGE ticks the face where it stands */
const nudgeFx: Fx = async (who, col, apply) => {
  Sfx.spell();
  vibrate([10, 30, 14]);
  apply();
  const stage = $('#dieStage') as HTMLElement;
  if (stage) {
    stage.classList.add('pop');
    setTimeout(() => stage.classList.remove('pop'), 320);
    const r = stage.getBoundingClientRect();
    burst(r.left + r.width / 2, r.top + r.height / 2, spellHue('nudge'), 10);
  }
  await wait(REDUCED ? 0 : 200);
};

/* WARD lands its mark on the column chip — the repaint pops it in */
const wardFx: Fx = async (who, col, apply) => {
  Sfx.spell();
  vibrate([10, 30, 14]);
  apply();
  renderSide(who, true);                           // the chip reads S.charm
  const r = colEl(who, col)?.getBoundingClientRect();
  if (r) burst(r.left + r.width / 2, r.top + r.height / 2, spellHue('ward'), 14);
  await wait(REDUCED ? 0 : 260);
};

/* SUNDER charges the die in hand: the strike itself happens on placement
   (flow/game place() reads the same mark destruction consumes) */
const sunderFx: Fx = async (who, col, apply) => {
  Sfx.spell();
  vibrate([10, 30, 14]);
  apply();
  const stage = $('#dieStage') as HTMLElement;
  if (stage) {
    stage.classList.add('sundered');               // place() takes it off when the die flies
    const r = stage.getBoundingClientRect();
    burst(r.left + r.width / 2, r.top + r.height / 2, spellHue('sunder'), 14);
  }
  shake(4);
  await wait(REDUCED ? 0 : 200);
};

/* PILFER: the stolen die physically crosses the centre line — a clone flies
   while the original waits hidden, so the theft READS as a theft */
const pilferFx: Fx = async (who, col, apply) => {
  const foe = (1 - who) as Player;
  Sfx.spell();
  vibrate([10, 30, 14]);
  const srcIdx = S.boards[foe][col].length - 1;
  const dstIdx = S.boards[who][col].length;
  const src = slotEl(foe, col, slotIdx(foe, srcIdx))?.firstElementChild as HTMLElement | null;
  const dst = slotEl(who, col, slotIdx(who, dstIdx));
  if (!REDUCED && src && dst) {
    const a = src.getBoundingClientRect(), b = dst.getBoundingClientRect();
    const ghost = src.cloneNode(true) as HTMLElement;
    // numerals are drawn upside-down on a face-to-face opponent's half; the
    // flight leaves that half, so the copy wears the DESTINATION's orientation
    ghost.classList.toggle('p2flip', faceRotated(who));
    pin(ghost, a);
    fxRoot().appendChild(ghost);
    src.style.visibility = 'hidden';
    const anim = ghost.animate([
      { transform: 'translate(0,0) scale(1)' },
      { transform: 'translate(' + (b.left - a.left) / 2 + 'px,' + (b.top - a.top) / 2 + 'px)'
                 + ' scale(1.12) rotate(8deg)', offset: .5 },
      { transform: 'translate(' + (b.left - a.left) + 'px,' + (b.top - a.top) + 'px) scale(1) rotate(0deg)' },
    ], { duration: 420, easing: 'cubic-bezier(.55,.05,.25,1)', fill: 'both' });
    await anim.finished.catch(() => {});
    apply();
    renderSide(who, true);
    renderSide(foe, true);
    // renderSide REUSES a die element whose face already matches, inline styles
    // and all — the same trap that once left `.dying` survivors invisible
    // (tests/test13). Clear the hiding after the repaint, never before it.
    reveal(who, col); reveal(foe, col);
    ghost.remove();
  } else {
    apply();
    renderSide(who, true);
    renderSide(foe, true);
    reveal(who, col); reveal(foe, col);
  }
  for (const p of [who, foe] as Player[]) {
    const r = colEl(p, col)?.getBoundingClientRect();
    if (r) burst(r.left + r.width / 2, r.top + r.height / 2, colorOf(p), 12);
  }
  Sfx.mult(); shake(5); flash(0.18);
};

/* ANVIL recasts one die where it lies. The rule picks WHICH die (the lowest
   face, ties to the centre), so the animation has to land on that same die or
   the player cannot see what the cast chose — the index is read BEFORE apply()
   changes the faces, then re-resolved after the repaint, because renderSide
   reuses die elements and the old node may be gone. */
const anvilFx: Fx = async (who, col, apply) => {
  Sfx.spell();
  vibrate([10, 30, 14]);
  const c = S.boards[who][col];
  let at = 0;
  for (let i = 1; i < c.length; i++) if (c[i] < c[at]) at = i;
  apply();
  renderSide(who, true);
  const die = slotEl(who, col, slotIdx(who, at))?.firstElementChild as HTMLElement | null;
  const r = die?.getBoundingClientRect();
  if (die && !REDUCED) {
    await die.animate([
      { transform: 'scale(1)' },
      { transform: 'scale(1.35) rotate(-6deg)', offset: .45 },
      { transform: 'scale(1)' },
    ], { duration: 320, easing: 'cubic-bezier(.2,1.5,.4,1)' }).finished.catch(() => {});
  }
  if (r) burst(r.left + r.width / 2, r.top + r.height / 2, spellHue('anvil'), 14);
  Sfx.mult();
  shake(4);
  await wait(REDUCED ? 0 : 180);
};

const CAST_FX: Record<string, Fx> = {
  fate: fateFx, nudge: nudgeFx, ward: wardFx, sunder: sunderFx, pilfer: pilferFx, anvil: anvilFx,
};

/* undo a flight's hiding across a whole column, whatever survived the repaint */
function reveal(who: Player, col: number): void {
  for (let i = 0; i < SPEC.rows; i++) {
    const d = slotEl(who, col, slotIdx(who, i))?.firstElementChild as HTMLElement | null;
    if (d) d.style.visibility = '';
  }
}

/* ===================== GESTURES =====================
   Press the rune and drag it onto its target, or tap it and tap the target.
   Both are the same aim-then-confirm; the drag is just the one that shows you
   what you are about to do. A column spell's target is a column; a self
   spell's is the die in play on its stage. */
const SLOP = 8;                      // px before a press becomes a drag

/* The rune's gesture is the RUNE'S. Every one of its pointer events is stopped
   here: the whole rail sits inside #tableEl, whose own pointerup means "you
   pointed at the board" — and a tap that lands nowhere on the board cancels
   aiming. Left to bubble, arming the rune instantly disarmed it. */
function bind(b: HTMLButtonElement, id: string): void {
  if (!window.PointerEvent) {        // hosts without pointer events: arm on click
    b.addEventListener('click', (e) => {
      e.stopPropagation();
      if (spellById(id)?.target === 'self') {
        if (undoCast()) return;
        if (castable(id)) void cast(id, -1); else bump(b);
        return;
      }
      S.spellArmed === id ? disarm() : tryArm(b, id);
    });
    return;
  }
  b.addEventListener('click', (e) => e.stopPropagation());   // the trailing synthetic one
  b.addEventListener('pointerdown', (e: PointerEvent) => {
    e.preventDefault();
    e.stopPropagation();
    const self = spellById(id)?.target === 'self';
    const wasArmed = S.spellArmed === id;
    // a rune with no charges left is still live while its cast can be put
    // back — that press IS the take-back, so it must reach the release below
    if (!castable(id) && !undoable(id)) { Sfx.tap(); bump(b); return; }
    // A SELF spell has exactly one target — the die in hand — so there is
    // nothing to aim: the tap IS the cast (below). Aiming still exists for
    // the drag, which arms the moment the finger actually travels.
    if (self) Sfx.tap(); else if (!tryArm(b, id)) return;
    const x0 = e.clientX, y0 = e.clientY;
    let dragging = false;
    const move = (m: PointerEvent) => {
      if (!dragging && Math.hypot(m.clientX - x0, m.clientY - y0) > SLOP) {
        dragging = true;
        if (self) arm(id);
        showGhost(id);
      }
      if (dragging) moveGhost(m.clientX, m.clientY, id);
    };
    const up = (u: PointerEvent) => {
      u.stopPropagation();
      b.removeEventListener('pointermove', move);
      b.removeEventListener('pointerup', up);
      b.removeEventListener('pointercancel', up);
      if (!dragging) {
        // one target: pressing it casts it — and pressing it again, while the
        // die it changed is still in hand, puts the cast back
        if (self) { if (!undoCast()) void cast(id, -1); return; }
        if (wasArmed) { Sfx.tap(); disarm(); }    // a second tap puts it away
        return;
      }
      const t = targetAt(u.clientX, u.clientY, id);
      hideGhost();
      if (t === null) { Sfx.tap(); disarm(); return; }
      void cast(id, t);
    };
    /* LISTENERS FIRST, capture second. setPointerCapture throws when the id
       is not an active pointer (a synthetic event, an odd webview), and it
       used to run first — so the throw skipped the registrations below and
       the gesture could never finish: the rune stayed armed with no way to
       release it. The capture is an improvement to the drag, never a
       requirement for the tap. */
    b.addEventListener('pointermove', move);
    b.addEventListener('pointerup', up);
    b.addEventListener('pointercancel', up);
    try { b.setPointerCapture(e.pointerId); } catch { /* drag without capture */ }
  });
}

/* may this seat spend this rune right now? The gate every gesture asks
   BEFORE it decides whether to aim or simply cast. */
function castable(id: string): boolean {
  const who = caster();
  return who !== null && chargesOf(who, id) > 0;
}
function tryArm(b: HTMLButtonElement, id: string): boolean {
  if (!castable(id)) { Sfx.tap(); bump(b); return false; }
  Sfx.tap();
  arm(id);
  return true;
}
/* the rune's own refusal — the column shake would be pointing at nothing */
function bump(b: HTMLElement): void {
  b.classList.remove('bump'); void b.offsetWidth; b.classList.add('bump');
}

/* ---- the dragged rune, and the target under it ---- */
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
function moveGhost(x: number, y: number, id: string): void {
  if (!ghostEl) return;
  const off = isEmbed() ? rootRect() : { left: 0, top: 0 };
  ghostEl.style.left = (x - off.left) + 'px';
  ghostEl.style.top = (y - off.top) + 'px';
  const t = targetAt(x, y, id);
  if (spellById(id)?.target === 'self') { stageHot(t === -1); setHot(null); }
  else setHot(t !== null && t >= 0 ? t : null);
}
function hideGhost(): void {
  ghostEl?.remove();
  ghostEl = null;
  stageHot(false);
}
/* what the point lands on, in the armed spell's vocabulary: a column index,
   −1 for the die in play (self spells only), or null — nothing useful. A
   column only counts if the rings offered it, which is the same question the
   tap and the 1–3 keys ask. */
export function targetAt(x: number, y: number, id: string): number | null {
  const el = document.elementFromPoint(x, y) as HTMLElement | null;
  if (!el || !el.closest) return null;
  if (spellById(id)?.target === 'self') return el.closest('#dieStage') ? -1 : null;
  const col = el.closest('.col') as HTMLElement | null;
  if (!col) return null;
  const c = Number(col.dataset.col);
  return Number.isInteger(c) && aimed(c) ? c : null;
}
/* light what the drop will touch — only ever a column the rings offered */
function setHot(col: number | null): void {
  document.querySelectorAll('.col.hot').forEach((c) => c.classList.remove('hot'));
  if (col === null) return;
  document.querySelectorAll('.col.aim[data-col="' + col + '"]').forEach((c) => c.classList.add('hot'));
}
function stageHot(on: boolean): void {
  ($('#dieStage') as HTMLElement | null)?.classList.toggle('hot', on);
}
