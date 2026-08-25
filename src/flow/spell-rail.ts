// The paired-seat rune rail. Cast legality and state transitions stay in
// flow/spells; this leaf renders both hands and plays committed cards.
import { AI, ME, SPEC, type GameState, type Player } from '../core/rules.ts';
import { SPELLS, spellById, type CastCtx, type SpellSpec } from '../core/spells.ts';
import { spellCopy, t } from '../i18n/index.ts';
import { S } from '../state.ts';
import { colEl, slotEl, slotIdx } from '../ui/dom.ts';
import { appRoot } from '../ui/embed.ts';
import { REDUCED } from '../ui/fx.ts';
import { spellHue } from '../ui/spellicons.ts';
import { nameOf } from '../ui/identity.ts';
import { setCastingPresentation } from '../ui/game/root-state.ts';
import { runeCardFaces } from '../ui/runedeal.ts';

export interface SpellRailPorts {
  caster: () => Player | null;
  castContext: () => CastCtx;
  chargesOf: (who: Player, id: string) => number;
  castable: (id: string) => boolean;
  bindRune: (button: HTMLButtonElement, id: string) => void;
}

/* ONE SLOT, BOTH HANDS. Every dealt seat keeps its own physical card in the
   rail, even when both seats received the same rune. The active hand comes to
   the front on every turn change; RANDOM ×2 differs only in the two faces. */
export function renderSpellRail(ports: SpellRailPorts): void {
  const bar = appRoot().querySelector<HTMLElement>('#spellBar');
  if (!bar) return;
  if (!built) build(ports.bindRune);
  clearStaleFlights(bar);
  const seat = S.turn as Player;
  const now = ports.caster();
  const dealtIds = S.spellCharges.map((hand) => Object.keys(hand)[0] ?? '');
  const paired = !!dealtIds[ME] && !!dealtIds[1 - ME];
  const otherSeat = (1 - seat) as Player;
  const turnLeft = dealtIds[seat] ? ports.chargesOf(seat, dealtIds[seat]) : 0;
  const otherLeft = dealtIds[otherSeat] ? ports.chargesOf(otherSeat, dealtIds[otherSeat]) : 0;
  /* A fully spent turn hand is an opaque matte. Let it recede immediately
     behind the still-live hand instead of masking that card until the turn
     changes; the departing clone remains above both during its deal-away. */
  const spentTurnHandRecedes = paired && turnLeft <= 0 && otherLeft > 0;
  let shown = 0;
  for (const spell of SPELLS) {
    for (const owner of [ME, AI] as Player[]) {
      const button = runeOf(owner, spell.id);
      if (!button) continue;
      const held = spell.id in S.spellCharges[owner];
      button.hidden = !held;
      if (!held) continue;
      shown++;
      const currentHand = owner === seat;
      const left = ports.chargesOf(owner, spell.id);
      const committed = S.spellAimCommitted?.id === spell.id
        && S.spellAimCommitted.who === owner;
      const canCast = currentHand && owner === now && left > 0 && ports.castable(spell.id);
      /* Keep the historical CPU mute tied to the owning hand, not `canCast`:
         brief busy/legality changes on the player's own card must not blink. */
      const offturn = S.mode === 'cpu' && owner !== ME;
      /* `now` is null during transient phase/busy locks. Requiring the active
         chooser here leaves those brief locks visually stable; with charges
         and commitment ruled out, false `canCast` is registry legality. */
      const unavailable = owner === now && left > 0 && !committed && !canCast;
      button.dataset.left = String(left);
      button.classList.toggle('spent', left <= 0);
      button.classList.toggle('committed', committed);
      button.classList.toggle('ready', !committed && canCast);
      button.classList.toggle('armed', S.spellArmed === spell.id && owner === now);
      button.classList.toggle('offturn', offturn);
      button.classList.toggle('unavailable', unavailable);
      button.classList.toggle('hand-active', paired && currentHand);
      button.classList.toggle('hand-standby', paired && !currentHand);
      button.classList.toggle('hand-spent-back', spentTurnHandRecedes && currentHand);
      button.classList.toggle('hand-live-front', spentTurnHandRecedes && !currentHand);
      button.disabled = !canCast;
      paintCharges(button, spell, left);
      const copy = spellCopy(spell.id);
      const values = { player: nameOf(owner), name: copy.name, blurb: copy.blurb, count: left };
      button.setAttribute('aria-label', committed
        ? t('game', 'runes.ariaCommitted', values)
        : canCast ? t('game', 'runes.ariaAvailable', values)
          : left > 0 ? t('game', 'runes.ariaUnavailable', values)
            : t('game', 'runes.ariaSpent', values));
    }
  }
  bar.classList.toggle('paired', paired);
  bar.classList.toggle('live', shown > 0);
  const armed = spellById(S.spellArmed);
  setCastingPresentation(armed?.target ?? 'none');
  markAim(armed, ports);
}

/* Called only from the state transition that spends a charge. The outgoing
   copy is independent of the rerender that reveals what remains underneath. */
export function playSpellCharge(who: Player, id: string, alreadyFaceUp = false): void {
  // Reduced motion resolves straight to the remaining hand. Creating a card
  // whose animation is collapsed to zero leaves a transient copy until the
  // browser happens to deliver animationend (or the safety timeout), which is
  // both visually noisy and observably non-reduced on slower renderers.
  if (REDUCED) return;
  const button = runeOf(who, id);
  if (!button || button.hidden || Number(button.dataset.seat) !== who) return;
  const top = button.querySelector<HTMLElement>('.rune-charge.top');
  const bar = button.parentElement;
  if (!top || !bar) return;
  const flight = top.cloneNode(true) as HTMLElement;
  const flightAnimation = alreadyFaceUp ? 'runeDealUp' : 'runeTurnDeal';
  flight.className = 'rune-charge rune-played' + (alreadyFaceUp
    ? ' face-up owner-muted' : ' turning owner-fade');
  flight.dataset.seat = String(who);
  /* The copy leaves both the button that supplied currentColor and the hand
     transform that fans it around the fixed rail. Pin both before reparenting:
     otherwise every paired cast snaps back to the untransformed slot on its
     first flight frame. The animation composes this matrix with its own turn. */
  const buttonStyle = getComputedStyle(button);
  flight.style.color = buttonStyle.color;
  flight.style.setProperty('--rune-flight-hand', buttonStyle.transform === 'none'
    ? 'matrix(1,0,0,1,0,0)' : buttonStyle.transform);
  flight.dataset.gen = String(S.gen);
  flight.setAttribute('aria-hidden', 'true');
  bar.appendChild(flight);
  const remove = () => flight.remove();
  flight.addEventListener('animationend', (event) => {
    /* The ownership echo has its own shorter pseudo-element animation. Ignore
       that event or it would remove the played card before its deal finishes. */
    if (event.target === flight && event.animationName === flightAnimation) remove();
  });
  window.setTimeout(remove, 900);
}

function clearStaleFlights(bar: HTMLElement): void {
  bar.querySelectorAll<HTMLElement>('.rune-played').forEach((card) => {
    if (card.dataset.gen !== String(S.gen)) card.remove();
  });
}

function paintCharges(button: HTMLButtonElement, spell: SpellSpec, left: number): void {
  button.querySelectorAll<HTMLElement>('.rune-charge').forEach((card) => {
    const charge = Number(card.dataset.charge);
    card.hidden = charge > left;
    card.classList.toggle('top', charge === left);
    card.classList.toggle('under', charge < left);
  });
  button.querySelectorAll<HTMLElement>('.rune-empty').forEach((outline) => {
    outline.hidden = left > 0;
  });
  button.style.setProperty('--rune-hue', spellHue(spell.id));
}

/* Ring exactly the columns the registry says are legal for the armed spell. */
function markAim(spell: SpellSpec | null, ports: SpellRailPorts): void {
  appRoot().querySelectorAll('.col.aim').forEach((column) => column.classList.remove('aim'));
  appRoot().querySelectorAll('.spellpreview').forEach((die) => {
    die.classList.remove('spellpreview', 'anvilpreview', 'pilferpreview');
    (die as HTMLElement).style.removeProperty('--spell-hue');
  });
  const who = ports.caster();
  if (!spell || who === null || spell.target !== 'column') return;
  const side = (spell.side === 'foe' ? 1 - who : who) as Player;
  const context = ports.castContext();
  for (let column = 0; column < SPEC.cols; column++) {
    if (!spell.legal(S.boards as GameState, who, column, context)) continue;
    colEl(side, column)?.classList.add('aim');
    const target = spell.previewDieIndex?.(S.boards as GameState, who, column, context);
    if (target === null || target === undefined) continue;
    const die = slotEl(side, column, slotIdx(side, target))?.firstElementChild as HTMLElement | null;
    if (die) {
      die.classList.add('spellpreview', spell.id + 'preview');
      die.style.setProperty('--spell-hue', spellHue(spell.id));
    }
  }
}

/* One question shared by drag, tap, and keyboard input. */
export function isAimedColumn(who: Player, column: number): boolean {
  return !!colEl(who, column)?.classList.contains('aim');
}

let built = false;
const runes = new Map<string, HTMLButtonElement>();
const runeKey = (who: Player, id: string): string => `${who}:${id}`;
const runeOf = (who: Player, id: string): HTMLButtonElement | null =>
  runes.get(runeKey(who, id)) ?? null;

function build(bindRune: SpellRailPorts['bindRune']): void {
  built = true;
  const bar = appRoot().querySelector<HTMLElement>('#spellBar');
  if (!bar) return;
  for (const spell of SPELLS) {
    for (const owner of [ME, AI] as Player[]) {
      const button = document.createElement('button');
      button.type = 'button';
      button.className = 'rune' + (spell.uses > 1 ? ' multi' : '');
      button.dataset.spell = spell.id;
      button.dataset.seat = String(owner);
      const outlines = Array.from({ length: spell.uses }, (_, index) =>
        `<i class="rune-empty charge-${index + 1}" hidden></i>`).join('');
      const charges = Array.from({ length: spell.uses }, (_, index) =>
        `<i class="rune-charge charge-${index + 1}" data-charge="${index + 1}">`
        + `${runeCardFaces(spell, 12, 21, false)}</i>`).join('');
      button.innerHTML = outlines + charges;
      bindRune(button, spell.id);
      runes.set(runeKey(owner, spell.id), button);
      bar.appendChild(button);
    }
  }
}
