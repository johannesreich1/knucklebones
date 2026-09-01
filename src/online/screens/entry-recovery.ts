// The ranked door's two non-game destinations: a retryable connection sheet
// and explicit account restore. Keeping this decision beside the sheet stops
// an unreadable identity result from drifting back into "signed out" copy.
import type { IdentityEntry } from '../identity/session.ts';
import {
  askToRetryConnection,
  detectedConnectionIssue,
  type ConnectionIssue,
} from './connection-sheet.ts';

type IdentityFailure = Exclude<IdentityEntry, { readonly kind: 'authenticated' }>;

interface EntryRecoveryPorts<View, RetryContext extends object> {
  retryContext(): RetryContext | null;
  goHome(): void;
  opener(view: View): HTMLElement | null;
  retry(view: View, context: RetryContext): void;
  restore(view: View, sessionless: boolean): void;
}

export function createEntryRecovery<View, RetryContext extends object>(
  ports: EntryRecoveryPorts<View, RetryContext>,
) {
  const presentConnectionIssue = (
    view: View,
    issue: ConnectionIssue = detectedConnectionIssue(),
  ): void => {
    const context = ports.retryContext();
    ports.goHome();
    void askToRetryConnection(issue, ports.opener(view)).then((retry) => {
      if (retry && context && ports.retryContext() === context) ports.retry(view, context);
    });
  };

  const handleIdentityFailure = (view: View, identity: IdentityFailure): void => {
    if (identity.kind === 'unavailable') return presentConnectionIssue(view);
    ports.restore(view, identity.kind === 'sessionless');
  };

  return { presentConnectionIssue, handleIdentityFailure };
}
