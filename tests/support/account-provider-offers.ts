/* ---- what the profile's ACCOUNT ACCESS box may say ----
   The box opens for what the player can DO here, never for a fact — reach is a
   parameter, so iOS, the web and the build whose identity gateway origin is
   finally set are all decidable without a device. The last column is the offer;
   null means no box at all, and every painted row carries its OWN control (or
   null, for a way back in that already works) — before the Game Center control
   existed, its row could only ever state "not linked" at a player with nothing
   to tap. Game Center drives the box open once linking can complete; a healthy
   Apple link rides along but never opens it alone (the iOS/web healthy rows). */
import { accountProviderView, providerReach } from '../../src/online/screens/account-provider-view.ts';

type Check = (condition: boolean, message: string, detail?: unknown) => void;

const MEMBER = { id: 'p', guest: false, email: 'p@example.test' };
const GUEST = { id: 'p', guest: true, email: null };
const linkage = (apple: boolean, ready: boolean, gameCenter = false) =>
  ({ gameCenterLinked: gameCenter, appleLinked: apple, appleRevocationReady: ready });
const IOS = { apple: true, gameCenter: false, gameCenterUnidentified: false };
const WEB = { apple: false, gameCenter: false, gameCenterUnidentified: false };
const GATEWAY = { apple: true, gameCenter: true, gameCenterUnidentified: false };
const OFFERS = {
  gcLink: { state: 'profile.gameCenterNotLinked', action: 'profile.connectGameCenter' },
  gcDone: { state: 'profile.gameCenterLinked', action: null },
  appleAdd: { state: 'profile.appleNotLinked', action: 'profile.addApple' },
  appleFix: { state: 'profile.appleRepair', action: 'profile.repairApple' },
  appleDone: { state: 'profile.appleLinked', action: null },
} as const;

export function runAccountProviderOfferTests(check: Check): void {
  for (const [why, user, linked, reach, offer] of [
    ['a guest is answered by the GUEST card, not this box', GUEST, linkage(false, false), IOS, null],
    ['a healthy Apple account on iOS has nothing left to do', MEMBER, linkage(true, true), IOS, null],
    ['the same account on the web has nothing to offer', MEMBER, linkage(true, true), WEB, null],
    ['a missing credential is only repairable where Apple runs', MEMBER, linkage(true, false), WEB, null],
    ['an unlinked account on the web cannot be offered Apple', MEMBER, linkage(false, false), WEB, null],
    ['a fully linked account leaves the gateway build nothing to do',
      MEMBER, linkage(true, true, true), GATEWAY, null],
    ['a missing deletion credential is repaired where Apple runs',
      MEMBER, linkage(true, false), IOS, { gameCenter: null, apple: OFFERS.appleFix }],
    ['an unlinked account is offered Apple where the provider runs',
      MEMBER, linkage(false, false), IOS, { gameCenter: null, apple: OFFERS.appleAdd }],
    ['the gateway build offers Game Center beside the healthy Apple link',
      MEMBER, linkage(true, true), GATEWAY, { gameCenter: OFFERS.gcLink, apple: OFFERS.appleDone }],
    ['a bare account in the gateway build is offered both, each with its control',
      MEMBER, linkage(false, false), GATEWAY, { gameCenter: OFFERS.gcLink, apple: OFFERS.appleAdd }],
    ['a linked Game Center identity is a way back in, not a second offer',
      MEMBER, linkage(true, false, true), GATEWAY, { gameCenter: OFFERS.gcDone, apple: OFFERS.appleFix }],
    ['the gateway build without Apple still offers Game Center alone',
      MEMBER, linkage(false, false), { apple: false, gameCenter: true,
                                       gameCenterUnidentified: false },
      { gameCenter: OFFERS.gcLink, apple: null }],
  ] as const) {
    const view = accountProviderView(user, linked, reach);
    check(JSON.stringify(view ?? null) === JSON.stringify(offer), why, view);
  }

  /* Reach is not a hopeful guess: with no gateway origin compiled in, Game
     Center is not a tap this build offers anywhere, so the driver rows above are
     unreachable rather than merely unlikely. */
  check(providerReach().gameCenter === false,
  'an unconfigured identity gateway still advertised Game Center as reachable', providerReach());
}
