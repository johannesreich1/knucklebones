// Ranked entry's one connection question. The shared ask card owns modal
// behavior and locale repainting; this owner supplies only truthful copy and
// the retry decision.
import { t } from '../../i18n/index.ts';
import { ask } from '../../ui/askcard.ts';

export type ConnectionIssue = 'offline' | 'unavailable' | 'updateRequired';

export const detectedConnectionIssue = (): ConnectionIssue =>
  typeof navigator !== 'undefined' && navigator.onLine === false
    ? 'offline'
    : 'unavailable';

export async function askToRetryConnection(
  issue: ConnectionIssue,
  restoreFocus: HTMLElement | null,
): Promise<boolean> {
  return ask({
    head: () => t('online', `connection.${issue}.title`),
    body: () => t('online', `connection.${issue}.body`),
    confirm: () => t('common', 'actions.retry'),
    cancel: () => t('common', 'actions.close'),
    loud: true,
    restoreFocus,
  });
}
