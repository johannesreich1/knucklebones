// The rune rail and its read-only opponent indicator. Cast legality and state
// transitions stay in flow/spells; this leaf renders facts supplied by it.
import { AI, ME, SPEC, type GameState, type Player } from '../core/rules.ts';
import { SPELLS, spellById, type CastCtx, type SpellSpec } from '../core/spells.ts';
import { S } from '../state.ts';
import { colEl, sideKey } from '../ui/dom.ts';
import { appRoot } from '../ui/embed.ts';
import { spellIcon } from '../ui/spellicons.ts';
import { colorOf, nameOf } from '../ui/identity.ts';
import { isFaceToFace, setCastingPresentation } from '../ui/game/root-state.ts';

export interface SpellRailPorts {
  caster: () => Player | null;
  castContext: () => CastCtx;
  chargesOf: (who: Player, id: string) => number;
  undoable: (id: string) => boolean;
  bindRune: (button: HTMLButtonElement, id: string) => void;
}

/* TWO JOBS, TWO PLACES: the near rune is a thing you wield beside the die;
   the other player's rune is a small, inert readout in their nameplate. */
export function renderSpellRail(ports: SpellRailPorts): void {
  const bar = appRoot().querySelector<HTMLElement>('#spellBar');
  if (!bar) return;
  if (!built) build(ports.bindRune);
  const near = (isFaceToFace() ? S.turn : S.bottom) as Player;
  const now = ports.caster();
  for (const seat of [AI, ME] as Player[]) {
    const home = seat === near ? bar : opponentSlot(seat);
    for (const spell of SPELLS) {
      const button = runeOf(seat, spell.id);
      if (!button || !home) continue;
      if (button.parentElement !== home) home.appendChild(button);
      button.hidden = !(spell.id in S.spellCharges[seat]);
      const left = ports.chargesOf(seat, spell.id);
      const readout = seat !== near;
      const offturn = !readout && seat !== S.turn;
      const canUndo = seat === now && ports.undoable(spell.id);
      button.style.setProperty('--sh', colorOf(seat));
      button.classList.toggle('spent', left <= 0 && !canUndo);
      button.classList.toggle('undo', canUndo);
      button.classList.toggle('ready', left > 0 && !readout);
      button.classList.toggle('idle', left > 0 && readout);
      button.classList.toggle('armed', S.spellArmed === spell.id && seat === now);
      button.classList.toggle('offturn', offturn);
      button.disabled = (left <= 0 && !canUndo) || seat !== now;
      const count = button.querySelector('.n');
      if (count) count.textContent = left > 1 ? String(left) : '';
      button.setAttribute('aria-label', nameOf(seat) + ': ' + spell.name + ' — ' + spell.blurb
        + (canUndo ? ' Cast — press again to put it back.'
          : left > 0 ? ' ' + left + ' cast left.' : ' Spent.'));
    }
  }

  for (const seat of [AI, ME] as Player[]) {
    opponentSlot(seat)?.classList.toggle('live', Object.keys(S.spellCharges[seat]).length > 0);
  }
  const armed = spellById(S.spellArmed);
  setCastingPresentation(armed?.target ?? 'none');
  markAim(armed, ports);
}

function opponentSlot(seat: Player): Element | null {
  return appRoot().querySelector('#plate' + (sideKey(seat) === 'bot' ? 'Bot' : 'Top'))
    ?.querySelector('.runeslot') ?? null;
}

/* Ring exactly the columns the registry says are legal for the armed spell. */
function markAim(spell: SpellSpec | null, ports: SpellRailPorts): void {
  appRoot().querySelectorAll('.col.aim').forEach((column) => column.classList.remove('aim'));
  const who = ports.caster();
  if (!spell || who === null || spell.target !== 'column') return;
  const side = (spell.side === 'foe' ? 1 - who : who) as Player;
  const context = ports.castContext();
  for (let column = 0; column < SPEC.cols; column++) {
    if (spell.legal(S.boards as GameState, who, column, context)) colEl(side, column)?.classList.add('aim');
  }
}

/* One question shared by drag, tap, and keyboard input. */
export function isAimedColumn(column: number): boolean {
  return !!appRoot().querySelector(`.col.aim[data-col="${column}"]`);
}

let built = false;
const runes = new Map<string, HTMLButtonElement>();
const runeKey = (seat: Player, id: string): string => `${seat}:${id}`;
const runeOf = (seat: Player, id: string): HTMLButtonElement | null => runes.get(runeKey(seat, id)) ?? null;

function build(bindRune: SpellRailPorts['bindRune']): void {
  built = true;
  for (const seat of [AI, ME] as Player[]) {
    for (const spell of SPELLS) {
      const button = document.createElement('button');
      button.type = 'button';
      button.className = 'rune';
      button.dataset.spell = spell.id;
      button.dataset.seat = String(seat);
      /* An even icon in the even 20px button lands on whole device pixels. */
      button.innerHTML = spellIcon(spell.id, 16) + '<b class="n"></b>';
      bindRune(button, spell.id);
      runes.set(runeKey(seat, spell.id), button);
    }
  }
}
