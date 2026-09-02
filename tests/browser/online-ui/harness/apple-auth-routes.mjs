const APPLE_ACCOUNT_ID = '00000000-0000-4000-8000-00000000a991';

function accessTokenFor(session, accountId) {
  const parts = String(session.access_token ?? '').split('.');
  if (parts.length !== 3) return session.access_token;
  let payload;
  try {
    payload = JSON.parse(Buffer.from(parts[1], 'base64url').toString('utf8'));
  } catch {
    return session.access_token;
  }
  const encoded = Buffer.from(JSON.stringify({
    ...payload,
    sub: accountId,
    is_anonymous: false,
  })).toString('base64url');
  return `${parts[0]}.${encoded}.${parts[2]}`;
}

/** Stateful native Apple/Supabase fixture: the restored session, auth user,
 * and profile all name one account, distinct from the guest it replaces. */
export async function installAppleAuthRoutes(page, {
  mode = 'invalid',
  defer = false,
  deferRegistration = false,
  session,
  onRegistered = () => undefined,
}) {
  let signedIn = false;
  let linkedCurrentAccount = false;
  let tokenCalls = 0;
  let registrationCalls = 0;
  let startToken;
  let releaseToken;
  let startRegistration;
  let releaseRegistration;
  const tokenStarted = new Promise((resolve) => { startToken = resolve; });
  const tokenRelease = new Promise((resolve) => { releaseToken = resolve; });
  const registrationStarted = new Promise((resolve) => { startRegistration = resolve; });
  const registrationRelease = new Promise((resolve) => { releaseRegistration = resolve; });
  const user = {
    ...session.user,
    id: APPLE_ACCOUNT_ID,
    email: 'apple-player@example.test',
    is_anonymous: false,
    identities: [{ id: APPLE_ACCOUNT_ID, provider: 'apple' }],
  };
  const appleSession = {
    ...session,
    access_token: accessTokenFor(session, APPLE_ACCOUNT_ID),
    refresh_token: 'apple-refresh-token',
    user,
  };
  const profile = {
    id: APPLE_ACCOUNT_ID,
    nickname: 'ApplePlayer99',
    named_at: '2026-08-01T00:00:00Z',
  };

  const linkedUser = {
    ...session.user,
    identities: [
      ...(session.user.identities ?? []).filter((identity) => identity.provider !== 'apple'),
      { id: session.user.id, provider: 'apple' },
    ],
  };
  await page.route('**/auth/v1/user*', (route) => route.fulfill({
    status: 200,
    contentType: 'application/json',
    body: JSON.stringify(signedIn ? user : linkedCurrentAccount ? linkedUser : session.user),
  }));
  await page.route('**/auth/v1/token?grant_type=id_token', async (route) => {
    tokenCalls++;
    startToken();
    if (defer) await tokenRelease;
    if (mode !== 'success') return route.fulfill({
      status: 400,
      contentType: 'application/json',
      body: JSON.stringify({ error_code: 'invalid_credentials', message: 'Invalid Apple token' }),
    });
    const linking = route.request().postDataJSON()?.link_identity === true;
    if (linking) linkedCurrentAccount = true;
    else signedIn = true;
    return route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify(linking ? { ...session, user: linkedUser } : appleSession),
    });
  });
  await page.route('**/functions/v1/apple-token-register', async (route) => {
    registrationCalls++;
    if (deferRegistration) {
      startRegistration();
      await registrationRelease;
    }
    if (signedIn || linkedCurrentAccount) onRegistered();
    return route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: '{"registered":true}',
    });
  });

  return {
    appleTokenCalls: () => tokenCalls,
    appleRegistrationCalls: () => registrationCalls,
    appleTokenStarted: tokenStarted,
    releaseAppleToken: () => releaseToken(),
    appleRegistrationStarted: registrationStarted,
    releaseAppleRegistration: () => releaseRegistration(),
    appleAccountId: () => APPLE_ACCOUNT_ID,
    appleProfile: () => signedIn ? { ...profile } : null,
  };
}
