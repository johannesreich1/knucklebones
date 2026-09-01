// Small result-card copy derived from progression-v2 match metadata. Keeping
// it here prevents the reward/transition orchestrator from owning formatting.
import { formatNumber, t } from '../../i18n/index.ts';
import type { FinishReport } from '../play/play-types.ts';

export function resultDeltaBreakdown(report: FinishReport): string {
  if (report.scoringVersion !== 2
      || report.baseDelta == null || report.finishDelta == null) return '';
  const signed = (value: number): string => `${value >= 0 ? '+' : ''}${formatNumber(value)}`;
  return t('online', 'result.deltaBreakdown', {
    base: signed(report.baseDelta),
    finish: signed(report.finishDelta),
  });
}

export function resultReplayAction(report: FinishReport, run: () => void) {
  return {
    label: t('online', report.entryKind === 'weekly'
      ? 'result.replayWeekly' : 'result.nextDuel'),
    icon: 'play' as const,
    run,
  };
}
