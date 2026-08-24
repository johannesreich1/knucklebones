// SUNDER's charged stage and doomed-die markers persist from cast to placement.
// Every lifecycle boundary uses this one cleanup so a restart, interruption,
// or completed move cannot leak the warning into a different turn or game.
import { appRoot } from '../embed.ts';

export function markSunderVictim(
  slot: HTMLElement,
  die: HTMLElement,
  order: number,
): void {
  slot.classList.add('sunder-doomed-slot');
  slot.style.setProperty('--sunder-order', String(order));
  die.classList.add('sunder-doomed');

  if (die.querySelector(':scope > .sunder-embers')) return;
  const embers = document.createElement('span');
  embers.className = 'sunder-embers';
  embers.setAttribute('aria-hidden', 'true');
  embers.append(document.createElement('i'), document.createElement('i'));
  die.appendChild(embers);
}

export function clearSunderPresentation(): void {
  const root = appRoot();
  root.querySelector('#dieStage')?.classList.remove('sundered');
  for (const slot of root.querySelectorAll<HTMLElement>('.sunder-doomed-slot')) {
    slot.classList.remove('sunder-doomed-slot');
    slot.style.removeProperty('--sunder-order');
  }
  for (const die of root.querySelectorAll<HTMLElement>('.sunder-doomed,.sunder-collapse')) {
    die.classList.remove('sunder-doomed', 'sunder-collapse');
    die.style.removeProperty('--sunder-delay');
  }
  root.querySelectorAll('.sunder-embers').forEach((embers) => embers.remove());
}
