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
  session,
  onRegistered = () => undefined,
}) {
  let signedIn = false;
  let tokenCalls = 0;
  let registrationCalls = 0;
  let startToken;
  let releaseToken;
  const tokenStarted = new Promise((resolve) => { startToken = resolve; });
  const tokenRelease = new Promise((resolve) => { releaseToken = resolve; });
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

  await page.route('**/auth/v1/user*', (route) => route.fulfill({
    status: 200,
    contentType: 'application/json',
    body: JSON.stringify(signedIn ? user : session.user),
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
    signedIn = true;
    return route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify(appleSession),
    });
  });
  await page.route('**/functions/v1/apple-token-register', (route) => {
    registrationCalls++;
    if (signedIn) onRegistered();
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
    appleAccountId: () => APPLE_ACCOUNT_ID,
    appleProfile: () => signedIn ? { ...profile } : null,
  };
}
