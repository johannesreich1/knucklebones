// The one turn-owned rune rail. Cast legality and state transitions stay in
// flow/spells; this leaf renders the current hand and plays committed cards.
import { SPEC, type GameState, type Player } from '../core/rules.ts';
import { SPELLS, spellById, type CastCtx, type SpellSpec } from '../core/spells.ts';
import { S } from '../state.ts';
import { colEl, slotEl, slotIdx } from '../ui/dom.ts';
import { appRoot } from '../ui/embed.ts';
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

/* ONE SLOT, ONE HAND. The die and status already say whose turn it is; the
   rail changes owner with them instead of drawing a second plate readout. */
export function renderSpellRail(ports: SpellRailPorts): void {
  const bar = appRoot().querySelector<HTMLElement>('#spellBar');
  if (!bar) return;
  if (!built) build(ports.bindRune);
  clearStaleFlights(bar);
  const seat = S.turn as Player;
  const now = ports.caster();
  for (const spell of SPELLS) {
    const button = runeOf(spell.id);
    if (!button) continue;
    const dealt = spell.id in S.spellCharges[seat];
    button.hidden = !dealt;
    if (!dealt) continue;
    const left = ports.chargesOf(seat, spell.id);
    const committed = S.spellAimCommitted?.id === spell.id
      && S.spellAimCommitted.who === seat;
    const canCast = seat === now && left > 0 && ports.castable(spell.id);
    button.dataset.seat = String(seat);
    button.dataset.left = String(left);
    button.classList.toggle('spent', left <= 0);
    button.classList.toggle('committed', committed);
    button.classList.toggle('ready', !committed && canCast);
    button.classList.toggle('armed', S.spellArmed === spell.id && seat === now);
    button.disabled = !canCast;
    paintCharges(button, spell, left);
    button.setAttribute('aria-label', nameOf(seat) + ': ' + spell.name + ' — ' + spell.blurb
      + (committed ? ' Committed — choose a marked column.'
        : canCast ? ` ${left} cast${left === 1 ? '' : 's'} left.`
          : left > 0 ? ` ${left} cast${left === 1 ? '' : 's'} left. Not available right now.`
            : ' Spent.'));
  }
  bar.classList.toggle('live', SPELLS.some((spell) => !runeOf(spell.id)?.hidden));
  const armed = spellById(S.spellArmed);
  setCastingPresentation(armed?.target ?? 'none');
  markAim(armed, ports);
}

/* Called only from the state transition that spends a charge. The outgoing
   copy is independent of the rerender that reveals what remains underneath. */
export function playSpellCharge(who: Player, id: string, alreadyFaceUp = false): void {
  const button = runeOf(id);
  if (!button || button.hidden || Number(button.dataset.seat) !== who) return;
  const top = button.querySelector<HTMLElement>('.rune-charge.top');
  const bar = button.parentElement;
  if (!top || !bar) return;
  const flight = top.cloneNode(true) as HTMLElement;
  flight.className = 'rune-charge rune-played' + (alreadyFaceUp ? ' face-up' : ' turning');
  flight.dataset.gen = String(S.gen);
  flight.setAttribute('aria-hidden', 'true');
  bar.appendChild(flight);
  const remove = () => flight.remove();
  flight.addEventListener('animationend', (event) => {
    if (event.target === flight) remove();
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
    die.classList.remove('spellpreview', 'anvilpreview');
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
const runeOf = (id: string): HTMLButtonElement | null => runes.get(id) ?? null;

function build(bindRune: SpellRailPorts['bindRune']): void {
  built = true;
  const bar = appRoot().querySelector<HTMLElement>('#spellBar');
  if (!bar) return;
  for (const spell of SPELLS) {
    const button = document.createElement('button');
    button.type = 'button';
    button.className = 'rune' + (spell.uses > 1 ? ' multi' : '');
    button.dataset.spell = spell.id;
    const outlines = Array.from({ length: spell.uses }, (_, index) =>
      `<i class="rune-empty charge-${index + 1}" hidden></i>`).join('');
    const charges = Array.from({ length: spell.uses }, (_, index) =>
      `<i class="rune-charge charge-${index + 1}" data-charge="${index + 1}">`
      + `${runeCardFaces(spell, 12, 21, false)}</i>`).join('');
    button.innerHTML = outlines + charges;
    bindRune(button, spell.id);
    runes.set(spell.id, button);
    bar.appendChild(button);
  }
}
