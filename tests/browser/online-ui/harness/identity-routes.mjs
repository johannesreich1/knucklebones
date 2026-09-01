/* Identity answers, stubbed at the network edge like everything else here.
 *
 * Two endpoints, and they are deliberately NOT the same origin. identity-status
 * is a Supabase Edge Function; the Game Center exchange goes to the dedicated
 * identity gateway Worker, whose origin the build inlines. `**\/v1/game-center`
 * therefore matches whatever origin this build was compiled with — including
 * the relative path an unconfigured build would post to, so a run that ought to
 * offer nothing cannot quietly reach a stub either.
 *
 * The state is LIVE: a completed attach flips gameCenterLinked, so the profile's
 * refresh reads what the server would really say next, and a refused attach
 * leaves the account exactly as the player left it. */
export async function installIdentityRoutes(page, { identity, gameCenter, session }) {
  const state = { ...identity };
  const modes = [];
  const readers = {
    gameCenterModes: () => [...modes],
    identityState: () => ({ ...state }),
    setAppleIdentity: (linked, revocationReady) => {
      state.appleLinked = linked;
      state.appleRevocationReady = revocationReady;
    },
  };
  await page.route('**/functions/v1/identity-status', (r) => r.fulfill({
    status: 200, contentType: 'application/json', body: JSON.stringify(state),
  }));
  if (!gameCenter) return readers;
  /* Reached only where Game Center can run: the launch sign-in exchanges its
     verified token for a session, and a completed attach refreshes the JWT the
     gateway just added an identity to. */
  const asSession = (r) => r.fulfill({
    status: 200, contentType: 'application/json', body: JSON.stringify(session),
  });
  await page.route('**/auth/v1/verify*', asSession);
  await page.route('**/auth/v1/token?grant_type=refresh_token', asSession);
  await page.route('**/v1/game-center', (r) => {
    const mode = r.request().postDataJSON()?.mode ?? '';
    modes.push(mode);
    /* The ownership check mutates nothing; it reports who owns this local
       player. A guest that has never linked is 'unlinked' — which is what
       lets identity.ts's linkGuestGameCenter recover them — while the
       account standing in for somebody else's identity answers just as the
       attach below would. */
    if (mode === 'assert-current') {
      const status = state.gameCenterLinked ? 'match'
        : gameCenter === 'conflict' ? 'other-account' : 'unlinked';
      return r.fulfill({ status: 200, contentType: 'application/json',
        body: JSON.stringify({ kind: 'assertion', status }) });
    }
    if (mode !== 'attach') {
      return r.fulfill({ status: 200, contentType: 'application/json',
        body: JSON.stringify({ kind: 'session', tokenHash: 'gc-hash' }) });
    }
    /* The identity is owned by somebody else. The gateway answers 409 and
       moves NOTHING — the account below keeps its unlinked state. */
    if (gameCenter === 'conflict') {
      return r.fulfill({ status: 409, contentType: 'application/json',
        body: JSON.stringify({ error: 'identity-already-linked' }) });
    }
    state.gameCenterLinked = true;
    return r.fulfill({ status: 200, contentType: 'application/json',
      body: JSON.stringify({ kind: 'linked' }) });
  });
  return readers;
}
