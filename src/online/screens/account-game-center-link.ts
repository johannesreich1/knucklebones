/* WHY THIS IS A BUTTON AND NOT SOMETHING THE APP JUST DOES.
   iOS authenticates the LOCAL PLAYER at launch and greets them by name; that
   is GameKit's business with the device and says nothing about which
   Knucklebones account the identity belongs to. Two decisions come out of
   that, and they are deliberately different:

     no account yet   the app signs the local player in on its own —
                      session.ts's ensureIdentity/restoreGameCenterAutomatically
                      still does exactly that, and it cannot take an identity
                      away from anybody because there is nothing to take it
                      from.
     guest account     the app attaches on its own, once
                       (identity.ts's linkGuestGameCenter). A guest's only
                       proof of ownership dies with the install, so this is
                       the sole way back to their own rating after a
                       reinstall — there is no safer identity to protect.
     Apple or email    binding is an explicit one-tap ACTION, right here.

   Do not "fix" the last case into an automatic attach. That account already
   survives a reinstall, so a silent bind buys it nothing — while on a shared
   or family device the Game Center player signed in at launch is frequently
   not the person holding the phone, and the bind would weld somebody else's
   identity onto this account permanently. A Game Center identity that already
   belongs to another account fails closed (`conflict`) rather than moving, so
   the automatic version could not even repair itself.

   Everything the provider distinguishes — the device having no GameKit at all,
   a local player not signed in, identifiers GameKit will not vouch for, a
   signature Apple would not produce, an unverifiable exchange, an identity
   already owned elsewhere — is copy it returns, and the shared control deals
   it as a warning card without refreshing, so a refused link leaves the
   account exactly as it was.
*/
import { GAME_CENTER, GAME_CENTER_IDENTITY_MESSAGES } from '../identity/identity.ts';
import { acknowledgeCurrentAccount } from '../identity/session.ts';
import type { OneTap } from '../identity/identity-provider.ts';
import {
  bindAccountProviderControl,
  type AccountProviderPorts,
} from './account-provider-control.ts';

export interface AccountGameCenterPorts extends AccountProviderPorts {
  gameCenter?: Pick<OneTap, 'attach'>;
}

export function bindAccountGameCenterLink(ports: AccountGameCenterPorts): void {
  const provider = ports.gameCenter ?? GAME_CENTER;
  bindAccountProviderControl({
    accountId: ports.accountId,
    refresh: ports.refresh,
    invalidate: ports.invalidate,
    control: '#btnLinkGameCenter',
    identityPatch: { gameCenterLinked: true },
    run: (accountId) => provider.attach(accountId),
    /* The player just proved this native revision belongs to this account,
       so ranked entry must not immediately demand the same assertion again
       (see gameCenterSessionAction). Publication waits for the shared control's
       post-provider account boundary; an A answer may not acknowledge B. */
    published: () => acknowledgeCurrentAccount(),
    rejected: () => GAME_CENTER_IDENTITY_MESSAGES.failed,
  });
}
