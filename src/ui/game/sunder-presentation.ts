// SUNDER's charged stage and doomed-die markers persist from cast to placement.
// Every lifecycle boundary uses this one cleanup so a restart, interruption,
// or completed move cannot leak the warning into a different turn or game.
import { appRoot } from '../embed.ts';

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
}
