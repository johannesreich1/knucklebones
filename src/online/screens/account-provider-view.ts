/* ACCOUNT ACCESS answers one question: how do I get back into this account,
   and can I add another way? A row that states a fact the player cannot act on
   here answers neither half, so it is not painted at all.

   Two kinds of row exist, and only one of them opens the box:

     DRIVER     something this build and this device can actually do — add
                Apple sign-in, repair its deletion credential, link Game
                Center once the identity gateway is configured.
     PASSENGER  a way back in that already works. It completes the answer once
                the box is open and never keeps it open on its own.

   So a fully healthy account sees NO box, and no player is ever shown a
   provider line with nothing behind it. In particular "Game Center not
   connected" is not a fact about this account until linking can succeed:
   iOS signs the LOCAL PLAYER in at launch, which is a different thing from
   attaching that identity here, and while the gateway origin is unset the
   attach cannot complete anywhere. Reach is read from the one-tap registry —
   the same capability list the auth sheet offers its buttons from — so this
   view cannot drift from what the app can really perform. */
import { t, type LocaleKey } from '../../i18n/index.ts';
import { $ } from '../../ui/dom.ts';
import { availableTaps } from '../identity/identity.ts';
import type { IdentityStatus, Me } from '../identity/session.ts';

type Copy = LocaleKey<'online'>;

/** Whether each provider could actually complete an account link right here. */
export interface ProviderReach { apple: boolean; gameCenter: boolean }

export interface AccountProviderView {
  gameCenter: Copy | null;
  apple: Copy | null;
  action: Copy | null;
}

export function providerReach(): ProviderReach {
  const reachable = new Set(availableTaps().map((tap) => tap.id));
  return { apple: reachable.has('apple'), gameCenter: reachable.has('gamecenter') };
}

/** null when nothing is actionable — the caller then shows no box at all. */
export function accountProviderView(
  user: Me | null,
  identity: IdentityStatus | null,
  reach: ProviderReach,
): AccountProviderView | null {
  if (!user || user.guest) return null;
  const appleLinked = !!identity?.appleLinked;
  const appleHealthy = appleLinked && !!identity?.appleRevocationReady;
  const gameCenterLinked = !!identity?.gameCenterLinked;
  const appleDriver = reach.apple && !appleHealthy;
  const gameCenterDriver = reach.gameCenter && !gameCenterLinked;
  if (!appleDriver && !gameCenterDriver) return null;
  return {
    gameCenter: gameCenterDriver ? 'profile.gameCenterNotLinked'
      : gameCenterLinked ? 'profile.gameCenterLinked' : null,
    apple: appleDriver ? (appleLinked ? 'profile.appleRepair' : 'profile.appleNotLinked')
      : appleLinked ? 'profile.appleLinked' : null,
    action: appleDriver ? (appleLinked ? 'profile.repairApple' : 'profile.addApple') : null,
  };
}

function paintRow(selector: string, key: Copy | null): void {
  const row = $(selector);
  row.hidden = !key;
  row.textContent = key ? t('online', key) : '';
}

export function paintAccountProviders(
  user: Me | null,
  identity: IdentityStatus | null,
  reach: ProviderReach = providerReach(),
): void {
  const view = accountProviderView(user, identity, reach);
  $('#accProviders').hidden = !view;
  paintRow('#accGameCenterState', view?.gameCenter ?? null);
  paintRow('#accAppleState', view?.apple ?? null);
  /* Set unconditionally: a control left un-hidden inside a hidden box is still
     an offer as far as any query for it is concerned. */
  const apple = $('#btnLinkApple') as HTMLButtonElement;
  apple.hidden = !view?.action;
  if (!view?.action) return;
  apple.setAttribute('data-i18n', `online:${view.action}`);
  apple.textContent = t('online', view.action);
}
