import type { ModeSpec } from '../../core/modes.ts';
import type { Player } from '../../core/rules.ts';
import { formatNumber, t } from '../../i18n/index.ts';
import { modeChip, type BadgeChip } from '../../ui/game/hud.ts';
import { setStatus, type StatusCopyPair } from '../../ui/game/turn-state.ts';
import type { MatchNames } from './play-types.ts';

export function defaultOnlineNames(): MatchNames {
  return {
    p1: t('common', 'people.playerOne'),
    p2: t('common', 'people.playerTwo'),
  };
}

/** Keep ranked mode copy live so shared HUD repaint preserves its claim. */
export function rankedBadge(mode: Pick<ModeSpec, 'id'>): () => readonly BadgeChip[] {
  return () => [modeChip(mode)];
}

export const reconnectingCopy: StatusCopyPair = {
  visible: () => t('online', 'play.reconnectingCompact'),
  accessible: () => t('online', 'play.reconnecting'),
};

export function opponentThinkingCopy(opponent: () => string): () => string {
  return () => t('online', 'play.opponentThinking', { opponent: opponent() });
}

export function turnCopy(mine: boolean, opponent: () => string): () => string {
  return mine ? () => t('online', 'play.yourMove') : opponentThinkingCopy(opponent);
}

/** Give a stalled turn a bounded, locale-live shape without owning match state. */
export function showAwayAutoPlayCountdown(options: {
  active(): boolean;
  lastMoveAt(): number;
  who: Player;
}): void {
  const tick = (): void => {
    if (!options.active()) return;
    const left = Math.max(0, Math.ceil((13_000 - (Date.now() - options.lastMoveAt())) / 1000));
    const values = { count: left, formatted: formatNumber(left) };
    setStatus(left > 0 ? {
      visible: () => t('online', 'play.awayAutoPlayCompact', values),
      accessible: () => t('online', 'play.awayAutoPlay', values),
    } : () => t('online', 'play.autoPlay'), options.who);
    if (left > 0) setTimeout(tick, 500);
  };
  tick();
}
