/* One implementation behind every ACCOUNT ACCESS control.
   Each row in that box is the same shape of offer — run this provider against
   the account the player is already signed into, and repaint the box from a
   fresh identity-status read when it worked. Only three things differ per
   provider: which button, which provider call, and the copy for a call that
   rejects outright. Everything else (the tap sound, clearing the last error,
   the busy state, the null / '' / copy contract, and the refresh) is the same
   promise to the player, so it lives here once. */
import { Sfx } from '../../ui/audio.ts';
import { $ } from '../../ui/dom.ts';
import {
  cacheAccountIdentity,
  type CachedAccountIdentityPatch,
} from '../../profile-cache.ts';
import { currentUser } from '../identity/session.ts';
import { repaintOnlineMessage } from '../message-copy.ts';
import { showAccountProblem } from './account-problem-sheet.ts';

export interface AccountProviderPorts {
  /** Verified Profile account that owns the visible control. */
  accountId(): string | null;
  /* Re-reads identity-status and repaints the provider rows, so a completed
     link loses its offer (and its button) without a manual reload. */
  refresh(): Promise<unknown>;
  /** Remove a presentation whose successful mutation cannot be tied back to
      the account that opened the provider control. */
  invalidate(accountId: string): void;
}

export interface AccountProviderControl extends AccountProviderPorts {
  /** The control's element id, e.g. '#btnLinkApple'. */
  control: string;
  /** Provider call: null is success, '' is a cancelled native sheet, else copy. */
  run(accountId: string): Promise<string | null>;
  /** Local fact established by a null provider answer. */
  identityPatch: CachedAccountIdentityPatch;
  /** Provider-specific success side effects, released only after the account
      and cache publication boundary above has accepted the result. */
  published?(accountId: string): void;
  /** Copy for a provider that rejected instead of answering. */
  rejected(): string;
}

export function bindAccountProviderControl(ports: AccountProviderControl): void {
  const button = $(ports.control) as HTMLButtonElement;
  button.addEventListener('click', async () => {
    Sfx.tap();
    button.disabled = true;
    try {
      /* Capture ownership before the native/provider wait. A may finish after
         the browser has become B; a success is useful local state only when
         the same account still owns the session at the publication boundary. */
      const accountId = ports.accountId()?.toLowerCase() ?? null;
      const requestedUser = await currentUser();
      if (!accountId || requestedUser?.id.toLowerCase() !== accountId) {
        if (accountId) ports.invalidate(accountId);
        return;
      }
      let message: string | null;
      try {
        message = await ports.run(accountId);
      } catch {
        message = ports.rejected();
      }
      /* Ownership applies to every answer, not just success. A cancellation or
         error that settles after A became B must not deal A's reply over B or
         leave A's stale Profile mounted. */
      const activeUser = await currentUser();
      if (activeUser?.id.toLowerCase() !== accountId) {
        ports.invalidate(accountId);
        return;
      }
      /* Same contract as the auth sheet's one-tap row: null is success, '' is a
         player-cancelled native sheet with nothing to report, anything else is
         copy the player must read. A failure never refreshes: the account is
         unchanged, and repainting it would replace the reply with silence.
         The reply is DEALT AS A CARD over the panel rather than written into a
         line the player has to go looking for — one treatment for every control
         in the box, and the opener gets its focus back when the card goes. */
      if (message !== null) {
        if (message) {
          const returned = message;
          showAccountProblem(() => repaintOnlineMessage(returned), button);
        }
        return;
      }
      /* This write-through is the fallback for an unavailable status refresh,
         not a second success gate. A forgetful/quota-limited host may refuse
         localStorage while the provider mutation is still fully valid. */
      cacheAccountIdentity(accountId, ports.identityPatch);
      ports.published?.(accountId);
      /* Refresh still reconciles every provider fact. If that independent read
         is unavailable, Account falls back to the just-patched complete cache
         and the completed offer remains retired. */
      await ports.refresh();
    } finally {
      /* Invalidation deliberately leaves Profile action-locked behind its
         loading cover. Do not punch this one control back through that lock. */
      if (!button.closest('#onAccount')?.hasAttribute('data-account-pending')) {
        button.disabled = false;
      }
    }
  });
}
