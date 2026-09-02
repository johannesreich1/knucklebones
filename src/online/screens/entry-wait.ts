// The presentation shown while an online door verifies identity. It is data-
// aware only for Profile: a complete account-bound snapshot is already a real
// destination, while every incomplete data-backed view keeps the shared wait.
import { isNewcomer } from '../../ui/firstrun.ts';
import { $ } from '../../ui/dom.ts';
import { persistedAuthAccountId } from '../identity/session-read.ts';
import { showOnlineLoading } from './shell.ts';
import type { OnlineView } from './result-entry.ts';

interface EntryWaitPorts {
  showCachedAccount(accountId: string): boolean;
  showQueueSearching(): void;
}

export function focusOnlineTitle(): void {
  $('#onTitle').focus({ preventScroll: true });
}

export function paintOnlineEntryWait(
  view: OnlineView | null,
  ports: EntryWaitPorts,
): void {
  if (view === 'account') {
    /* The eager Home label can lag a direct/cross-tab Supabase account
       replacement. Bind private Profile facts to the synchronously persisted
       session before they are allowed to paint. */
    const accountId = persistedAuthAccountId();
    if (accountId && ports.showCachedAccount(accountId)) return;
    showOnlineLoading('onAccount');
    return;
  }
  if (view === 'ladder') return showOnlineLoading('onLadder');
  /* Play paints its real destination at once: the queue's searching state
     shows nothing account-derived. Only newcomers keep the die because the
     tutorial offer may still route them away. */
  if (isNewcomer()) return showOnlineLoading('onQueue');
  ports.showQueueSearching();
}
