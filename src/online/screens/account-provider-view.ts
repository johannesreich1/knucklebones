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
   provider line with nothing behind it. In particular "Game Center not linked
   to this account" is not a fact worth painting until linking can succeed:
   iOS signs the LOCAL PLAYER in at launch, which is a different thing from
   attaching that identity here, and while the gateway origin is unset the
   attach cannot complete anywhere. Reach is read from the one-tap registry —
   the same capability list the auth sheet offers its buttons from — so this
   view cannot drift from what the app can really perform.

   Every driver therefore carries its own control: a row and the tap that
   answers it are ONE offer, which is why they are modelled as one value
   instead of a row list plus a single privileged button.

   There is exactly one case where an offer is WITHHELD and said so instead of
   simply not painted: GameKit authenticates the local player and then refuses
   to identify them (Screen Time's multiplayer limit does this). Everything a
   link needs is there, so the silence would read as a bug, and the control
   would be a dead end that cannot ever succeed — see gameCenterUnidentified.
   That is the profile's only standing warning; every other refusal here is
   still an answer to a tap. */
import { t, type LocaleKey } from '../../i18n/index.ts';
import { gameCenterCannotIdentify } from '../../native/game-center.ts';
import { $ } from '../../ui/dom.ts';
import { availableTaps } from '../identity/identity.ts';
import type { IdentityStatus, Me } from '../identity/session.ts';
import { paintWarningNote } from './warning-note.ts';

type Copy = LocaleKey<'online'>;

/** Whether each provider could actually complete an account link right here. */
export interface ProviderReach {
  apple: boolean;
  gameCenter: boolean;
  /* Everything a Game Center link needs is present — GameKit, an authenticated
     local player, a gateway origin — and GameKit has nevertheless said it will
     not identify this player. Kept apart from `gameCenter: false`, which is
     the ordinary "not on this device / not in this build" and has nothing to
     say to anybody. */
  gameCenterUnidentified: boolean;
}

/** What one provider row says, and the tap (if any) that changes it. */
export interface ProviderOffer { state: Copy; action: Copy | null }

export interface AccountProviderView {
  gameCenter: ProviderOffer | null;
  apple: ProviderOffer | null;
}

export function providerReach(): ProviderReach {
  const reachable = new Set(availableTaps().map((tap) => tap.id));
  const refused = gameCenterCannotIdentify();
  return {
    apple: reachable.has('apple'),
    gameCenter: reachable.has('gamecenter') && !refused,
    gameCenterUnidentified: reachable.has('gamecenter') && refused,
  };
}

/* THE STANDING REFUSAL, and why it is not just another row.
   A row states a fact; this states why an OFFER IS MISSING, and it is only
   worth stating where the offer would otherwise have been made: to a real
   account (a guest is never offered the Game Center link at all — the app
   attaches theirs silently, and refuses this player there too) that has not
   already linked one. Anywhere else it would be a warning about a control the
   player was never going to see. */
export function gameCenterUnidentified(
  user: Me | null,
  identity: IdentityStatus | null,
  reach: ProviderReach,
): boolean {
  return !!user && !user.guest && reach.gameCenterUnidentified && !identity?.gameCenterLinked;
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
    gameCenter: gameCenterDriver
      ? { state: 'profile.gameCenterNotLinked', action: 'profile.connectGameCenter' }
      : gameCenterLinked ? { state: 'profile.gameCenterLinked', action: null } : null,
    apple: appleDriver
      ? {
        state: appleLinked ? 'profile.appleRepair' : 'profile.appleNotLinked',
        action: appleLinked ? 'profile.repairApple' : 'profile.addApple',
      }
      : appleLinked ? { state: 'profile.appleLinked', action: null } : null,
  };
}

/* Row and control are painted together and UNCONDITIONALLY: a control left
   un-hidden inside a hidden box is still an offer as far as any query for it
   — or any stray tap on a re-shown box — is concerned. */
function paintOffer(row: string, control: string, offer: ProviderOffer | null): void {
  const line = $(row);
  line.hidden = !offer;
  line.textContent = offer ? t('online', offer.state) : '';
  const button = $(control) as HTMLButtonElement;
  button.hidden = !offer?.action;
  if (!offer?.action) return;
  button.setAttribute('data-i18n', `online:${offer.action}`);
  button.textContent = t('online', offer.action);
}

export function paintAccountProviders(
  user: Me | null,
  identity: IdentityStatus | null,
  reach: ProviderReach = providerReach(),
): void {
  const view = accountProviderView(user, identity, reach);
  $('#accProviders').hidden = !view;
  paintOffer('#accGameCenterState', '#btnLinkGameCenter', view?.gameCenter ?? null);
  paintOffer('#accAppleState', '#btnLinkApple', view?.apple ?? null);
  /* Painted from the same call as the rows, so the withheld offer and the
     reason it is withheld can never be one repaint apart. Re-read on every
     locale change for free: paintAccount is what subscribeLocale runs. */
  const note = $('#accGameCenterBlocked');
  note.hidden = !gameCenterUnidentified(user, identity, reach);
  if (!note.hidden) {
    paintWarningNote(note, t('online', 'profile.gameCenterBlocked'),
      t('online', 'errors.gameCenterIdentifiers'));
  }
}
