// The Profile ring's two compact ladder facts. The larger screen owns loading
// and sequencing; this module owns only their visible classification.
import { currentBoardGroup } from '../../ladder-presentation.ts';
import { formatNumber, ladderGroupName } from '../../i18n/index.ts';
import { $ } from '../../ui/dom.ts';
import type { Standing } from '../api/ladder-api.ts';

export function paintAccountGroup(points: number, apex = false): void {
  const group = currentBoardGroup(points, apex);
  const label = $('#accGroup') as HTMLElement;
  const material = `var(--g-${group.id})`;
  label.textContent = ladderGroupName(group.id);
  label.style.setProperty('--gc', material);
  ($('#accRing') as HTMLElement).style.setProperty('--lr-material', material);
}

export function accountRankText(standing: Standing | null, games: number): string {
  return standing && games ? '#' + formatNumber(standing.rank) : '–';
}
