/* WHAT HAPPENS TO A PLAYER WHO CANNOT PROVE WHO THEY ARE.
 *
 * Two questions, both decided the moment the identity gateway origin ships:
 *
 *   arriving   a first-time iPhone player has an authenticated Game Center
 *              local player and no Knucklebones account. Do they play?
 *   leaving    a guest reinstalls. Is their rating still theirs?
 *
 * The first is answered by what the SERVER really says, so these cases wire the
 * client provider's request port straight into the live gc-auth operation — the
 * gateway Worker proxies that body verbatim, so this is the real contract and
 * not a guessed status code. The second is the guest auto-link seam, driven
 * through its ports across every answer the ownership check can give.
 */
import { completeGameCenterIdentity } from '../../supabase/functions/gc-auth/operation.ts';
import { FakeGameCenterService, identityDependencies } from './gcauth-operation.ts';
import {
  GAME_CENTER_IDENTITY_MESSAGES,
  createGameCenterIdentity,
  linkGuestGameCenter,
  resetGuestGameCenterLink,
  restoreGameCenterAutomatically,
  type GameCenterIdentityPorts,
  type GameCenterOwnership,
  type GuestGameCenterPorts,
} from '../../src/online/identity/identity.ts';
import type { GameCenterAuthState, GameCenterProof } from '../../src/native/game-center.ts';

type Check = (condition: boolean, message: string, detail?: unknown) => void;

const PROOF: GameCenterProof = {
  publicKeyUrl: 'https://static.gc.apple.com/public-key/gc-prod-12.cer',
  signature: 'signed', salt: 'salt', timestamp: '123', teamPlayerID: 'first-time-player',
};
const AUTHENTICATED: GameCenterAuthState = { status: 'authenticated', revision: 1 };

/* A provider whose gateway call IS the Edge Function. Restore deliberately
   carries no session, exactly as the real one does. */
function edgeBackedProvider(service: FakeGameCenterService) {
  const verified: string[] = [];
  const identity = createGameCenterIdentity({
    available: () => true,
    getProof: async () => PROOF,
    // The stub speaks only the narrow protocol the identity code exercises,
    // so widen to the full supabase-js auth surface at this boundary alone.
    getAuth: () => ({
      getSession: async () => ({ data: { session: null }, error: null }),
      verifyOtp: async (params: { token_hash: string }) => {
        verified.push(params.token_hash);
        return { data: { user: null, session: null }, error: null };
      },
      refreshSession: async () => ({ data: { user: null, session: null }, error: null }),
    }) as unknown as ReturnType<GameCenterIdentityPorts['getAuth']>,
    request: async (_input, init) => {
      const { mode } = JSON.parse(String(init.body)) as { mode: 'sign-in' | 'attach' };
      const response = await completeGameCenterIdentity(
        new Request('https://edge.test'), PROOF.teamPlayerID, mode,
        identityDependencies(service),
      );
      return { ok: response.ok, status: response.status, json: () => response.json() };
    },
  });
  return { identity, verified };
}

function guestPorts(
  assert: GameCenterOwnership | 'throws',
  attach: string | null | 'throws' = null,
) {
  const calls = { assert: 0, attach: 0, acknowledge: 0 };
  const ports: GuestGameCenterPorts = {
    assert: async () => {
      calls.assert++;
      if (assert === 'throws') throw new Error('gateway unreachable');
      return assert;
    },
    attach: async () => {
      calls.attach++;
      if (attach === 'throws') throw new Error('gateway unreachable');
      return attach;
    },
    acknowledge: () => { calls.acknowledge++; },
  };
  return { calls, ports };
}

const GUEST = { guest: true, gameCenterLinked: false } as const;
const MEMBER = { guest: false, gameCenterLinked: false } as const;

export async function runGameCenterRecoveryTests(check: Check): Promise<void> {
  /* ---- arriving: an unlinked Game Center player is NOT a failure ----
     gc-auth answers `sign-in` for a player it has never seen by provisioning
     an account and handing back a session, so there is no "not linked yet"
     refusal for the client to distinguish. If this ever became one, a
     first-time player would meet the sign-in panel instead of a game. */
  const firstTime = new FakeGameCenterService();
  const provider = edgeBackedProvider(firstTime);
  const arrival = await restoreGameCenterAutomatically({
    configured: () => true,
    waitForState: async () => AUTHENTICATED,
    restore: () => provider.identity.restore(),
  });
  check(arrival === 'signed-in' && firstTime.created.length === 1
    && firstTime.mapping?.user_id === 'created-1' && provider.verified.length === 1,
  'a first-time Game Center player with no linked account was refused instead of provisioned '
    + 'and signed in, so ranked entry would answer them with the sign-in panel',
  { arrival, created: firstTime.created, mapping: firstTime.mapping });

  /* The same player arriving again is the reinstall case in miniature: the
     mapping now exists, so the SAME account comes back rather than a second. */
  const returning = edgeBackedProvider(firstTime);
  const second = await restoreGameCenterAutomatically({
    configured: () => true,
    waitForState: async () => AUTHENTICATED,
    restore: () => returning.identity.restore(),
  });
  check(second === 'signed-in' && firstTime.created.length === 1
    && firstTime.mapping?.user_id === 'created-1',
  'a known Game Center player was given a second account instead of the one they own',
  { second, created: firstTime.created });

  /* ---- only a genuinely unresolved answer may hold a player back ----
     'retry' reaches ensureIdentity as null, which shows the sign-in panel. It
     must therefore mean a real failure and nothing else; every state GameKit
     reports as not-authenticated falls through to the silent guest instead. */
  const held: Array<[string, GameCenterAuthState['status'], string | null, string]> = [
    ['a network or gateway failure', 'authenticated', GAME_CENTER_IDENTITY_MESSAGES.failed, 'retry'],
    ['a refused verification', 'authenticated', GAME_CENTER_IDENTITY_MESSAGES.invalid, 'retry'],
    ['a lifecycle still authenticating', 'authenticating', null, 'retry'],
    ['a signed-out local player', 'signed-out', null, 'unavailable'],
    ['a declined Game Center prompt', 'declined', null, 'unavailable'],
    ['a failed GameKit lifecycle', 'failed', null, 'unavailable'],
  ];
  for (const [why, status, message, expected] of held) {
    const classified = await restoreGameCenterAutomatically({
      configured: () => true,
      waitForState: async () => ({ status, revision: 1 }),
      restore: async () => message,
    });
    check(classified === expected,
      `${why} was classified ${classified}, not ${expected}; a player is blocked or a failure `
      + 'is being mistaken for a fresh guest', { why, classified, expected });
  }
  check(await restoreGameCenterAutomatically({
    configured: () => false,
    waitForState: async () => AUTHENTICATED,
    restore: async () => { throw new Error('no gateway may be called'); },
  }) === 'unavailable',
  'a build with no identity gateway origin reached for one anyway');

  /* ---- leaving: the guest auto-link ----
     A guest with an authenticated local player and no identity yet attaches
     it, once. Everything else refuses, and no refusal may cost the player
     their game. resetGuestGameCenterLink() is what signOut() does. */
  resetGuestGameCenterLink();
  const attaching = guestPorts('unlinked', null);
  const attached = await linkGuestGameCenter(GUEST, AUTHENTICATED, attaching.ports);
  const repeated = await linkGuestGameCenter(GUEST, AUTHENTICATED, attaching.ports);
  check(attached === true && repeated === false && attaching.calls.attach === 1
    && attaching.calls.acknowledge === 1 && attaching.calls.assert === 1,
  'a guest did not attach the authenticated Game Center player exactly once, so their rating '
    + 'either cannot survive a reinstall or the gateway is called from every ranked entry',
  attaching.calls);

  /* The identity belongs to somebody else. The guest has local progress and
     that account has its own; picking either strands the other, so this leaves
     BOTH alone and lets the explicit control report the conflict. */
  resetGuestGameCenterLink();
  const clash = guestPorts('other-account');
  check(await linkGuestGameCenter(GUEST, AUTHENTICATED, clash.ports) === false
    && clash.calls.attach === 0 && clash.calls.acknowledge === 0,
  'a Game Center player owning a different account was attached to this guest, or the guest '
    + 'was switched away from the progress on this device', clash.calls);

  /* Refusals that are nobody's fault. None may attach, and none may spend the
     player's game: linkGuestGameCenter answering false means "carry on". */
  for (const [why, assert, attach] of [
    ['an ownership check that could not complete', 'retry', null],
    ['a build with no gateway origin', 'unavailable', null],
    ['an identity this account already owns', 'match', null],
    ['an ownership check that rejected', 'throws', null],
    ['an attach that rejected', 'unlinked', 'throws'],
    ['an attach the gateway refused', 'unlinked', GAME_CENTER_IDENTITY_MESSAGES.conflict],
    ['an attach that failed in transit', 'unlinked', GAME_CENTER_IDENTITY_MESSAGES.failed],
  ] as Array<[string, GameCenterOwnership | 'throws', string | null | 'throws']>) {
    resetGuestGameCenterLink();
    const refused = guestPorts(assert, attach);
    check(await linkGuestGameCenter(GUEST, AUTHENTICATED, refused.ports) === false
      && refused.calls.acknowledge === 0,
      `${why} did not leave the guest exactly as they were`, { why, calls: refused.calls });
  }

  /* Accounts and devices that must never be asked in the first place. An
     account carrying Apple or email keeps the explicit control; an unread
     identity-status is not evidence of an unlinked account; and a local player
     who is not authenticated has nothing to attach. */
  for (const [why, account, native] of [
    ['an account with Apple or email attached', MEMBER, AUTHENTICATED],
    ['an account that already carries this identity',
      { guest: true, gameCenterLinked: true }, AUTHENTICATED],
    ['a guest whose identity-status could not be read',
      { guest: true, gameCenterLinked: null }, AUTHENTICATED],
    ['a guest on a device still authenticating',
      GUEST, { status: 'authenticating', revision: 1 }],
    ['a guest whose local player signed out', GUEST, { status: 'signed-out', revision: 1 }],
    ['a guest on a device without Game Center', GUEST, { status: 'unavailable', revision: 0 }],
  ] as Array<[string, { guest: boolean; gameCenterLinked: boolean | null }, GameCenterAuthState]>) {
    resetGuestGameCenterLink();
    const untouched = guestPorts('unlinked');
    check(await linkGuestGameCenter(account, native, untouched.ports) === false
      && untouched.calls.assert === 0,
      `${why} was auto-attached, or asked the gateway about it`, { why, calls: untouched.calls });
    /* Refusing must not spend the one attempt: the same run may still reach a
       guest who really can be recovered. */
    check(await linkGuestGameCenter(GUEST, AUTHENTICATED, untouched.ports) === true,
      `${why} spent the attempt that belonged to a recoverable guest`, why);
  }
}
