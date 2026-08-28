import { SUPABASE_AUTH_STORAGE_KEY } from '../../../../src/config.ts';

/* Browser integration for the account path: first paint follows the German
   device, then a delayed existing player_settings row applies French in
   place. Unit tests own the race matrix; this proves the real lazy Supabase
   client, persistence and DOM-root subscription are wired together. */
export async function readRemoteLocaleSync({ standaloneUrl, attachErrors, localeContext }) {
  const remoteContext = await localeContext(['de-DE']);
  const remoteUser = '00000000-0000-4000-8000-00000000f123';
  const encode = (value) => Buffer.from(JSON.stringify(value)).toString('base64url');
  const remoteSession = {
    access_token: `${encode({ alg: 'HS256', typ: 'JWT' })}.${encode({
      sub: remoteUser,
      aud: 'authenticated',
      role: 'authenticated',
      is_anonymous: true,
      exp: Math.floor(Date.now() / 1000) + 3600,
    })}.stub`,
    token_type: 'bearer',
    expires_in: 3600,
    expires_at: Math.floor(Date.now() / 1000) + 3600,
    refresh_token: 'stub',
    user: {
      id: remoteUser,
      aud: 'authenticated',
      role: 'authenticated',
      email: null,
      is_anonymous: true,
      created_at: '2026-08-24T00:00:00Z',
      app_metadata: {},
      user_metadata: {},
      identities: [],
    },
  };
  await remoteContext.addInitScript(([storageKey, session]) => {
    localStorage.setItem(storageKey, JSON.stringify(session));
  }, [SUPABASE_AUTH_STORAGE_KEY, remoteSession]);
  const remote = attachErrors(await remoteContext.newPage(), 'remote-locale');
  /* The stubbed row is held shut until the page has already painted German
     and stamped its sentinel: markRemoteRead reports that the read started,
     releaseRemote answers it. That handshake is what makes "late" a fact
     here rather than a race against the first paint. */
  let releaseRemote;
  let markRemoteRead;
  const remoteGate = new Promise((resolve) => { releaseRemote = resolve; });
  const remoteRead = new Promise((resolve) => { markRemoteRead = resolve; });
  await remote.route('**/auth/v1/**', (route) => route.fulfill({
    status: 200,
    contentType: 'application/json',
    body: JSON.stringify(route.request().url().includes('/user')
      ? remoteSession.user : remoteSession),
  }));
  await remote.route('**/rest/v1/**', async (route) => {
    const request = route.request();
    if (request.url().includes('/player_settings')) {
      if (request.method() !== 'GET') {
        return route.fulfill({ status: 201, contentType: 'application/json', body: '[]' });
      }
      markRemoteRead();
      await remoteGate;
      return route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify([{
        user_id: remoteUser,
        locale: 'fr',
        sound: true,
        numerals: false,
        p1_hue: 'cy',
        p2_hue: 'mg',
        colorblind: false,
        reduced_motion: false,
      }]) });
    }
    return route.fulfill({ status: 200, contentType: 'application/json', body: '[]' });
  });
  await remote.goto(standaloneUrl);
  await remote.waitForFunction(() => window.__kb && document.documentElement.lang === 'de');
  await Promise.race([
    remoteRead,
    new Promise((_, reject) => setTimeout(() => reject(new Error('remote locale read did not start')), 8000)),
  ]);
  await remote.evaluate(() => {
    const column = document.querySelector('#topBoard .col');
    window.__remoteLocaleColumn = column;
    column?.setAttribute('data-remote-locale-sentinel', 'kept');
    document.getElementById('btnSettingsHome')?.focus();
  });
  releaseRemote();
  await remote.waitForFunction(() => window.__kb.S.localeOverride === 'fr'
    && document.documentElement.lang === 'fr');
  const reading = await remote.evaluate(() => {
    const column = document.querySelector('#topBoard .col');
    return {
      first: window.__kbFirstHomeFrame,
      override: window.__kb.S.localeOverride,
      lang: document.documentElement.lang,
      locale: document.documentElement.dataset.locale,
      settings: document.getElementById('btnSettingsHome')?.textContent?.trim(),
      sameColumn: column === window.__remoteLocaleColumn,
      sentinel: column?.getAttribute('data-remote-locale-sentinel'),
      focused: document.activeElement?.id,
      stored: JSON.parse(localStorage.getItem('knucklebones.v1') ?? '{}').localeOverride,
    };
  });
  await remoteContext.close();
  return reading;
}
