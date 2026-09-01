// Cosmetic progression records on Profile. Reading and painting live together
// so Account cannot accidentally display a stale record from another session.
import { formatNumber, t } from '../../i18n/index.ts';
import {
  activeWeeklyChallenge,
  readProgressionStatusSnapshot,
  type ProgressionStatusSnapshot,
} from '../../progression-status-cache.ts';
import { $ } from '../../ui/dom.ts';

export function accountProgressionSnapshot(accountId: string): ProgressionStatusSnapshot | null {
  const snapshot = readProgressionStatusSnapshot();
  return snapshot?.accountId === accountId.toLowerCase() ? snapshot : null;
}

export function paintAccountAchievements(progression: ProgressionStatusSnapshot | null): void {
  const weeklyComplete = activeWeeklyChallenge(progression)?.completed === true;
  const medalCount = progression?.neonMedalSeasons.length ?? 0;
  $('#accWeeklyMark').hidden = !weeklyComplete;
  const medals = $('#accNeonMedals');
  medals.hidden = medalCount === 0;
  medals.textContent = medalCount
    ? t('online', 'profile.neonMedals', {
      count: medalCount,
      formatted: formatNumber(medalCount),
    })
    : '';
  $('#accAchievements').hidden = !weeklyComplete && medalCount === 0;
}
