export async function installOnlineRoutes(
  page,
  { anonymous, attached, door, named, SESSION, GUEST_ID },
) {
  let signupCalls = 0;
  /* Kill the service worker before app code runs. Once it controls the page it
     re-issues requests from the worker, where page.route() cannot see them —
     and whether it has claimed the page by the time of the tap is a race, so a
     stub would work or not work depending on the machine's mood. */
  await page.addInitScript(() => {
    Object.defineProperty(navigator, 'serviceWorker', {
      configurable: true,
      value: { register: () => Promise.resolve({ addEventListener() {} }), ready: new Promise(() => {}),
               controller: null, addEventListener() {}, getRegistrations: () => Promise.resolve([]) },
    });
  });
  if (attached) await page.addInitScript(() => localStorage.setItem('knucklebones.online.attached', '1'));
  await page.route('**/auth/v1/signup*', (r) => {
    signupCalls++;
    return anonymous === 200
      ? r.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(SESSION) })
      : r.fulfill({ status: 422, contentType: 'application/json',
                    body: JSON.stringify({ code: 'anonymous_provider_disabled', message: 'Anonymous sign-ins are disabled' }) });
  });
  /* stateful, like the live table: the claim PATCH flips named_at (migration
     0026's trigger stamps it server-side), and every later GET tells the
     claimed truth — nickname included */
  let claimed = named;
  await page.route('**/rest/v1/profiles*', (r) => {
    if (r.request().method() === 'PATCH') {
      claimed = true;
      return r.fulfill({ status: 204, body: '' });
    }
    return r.fulfill({ status: 200, contentType: 'application/json',
      body: JSON.stringify([{ id: GUEST_ID, nickname: claimed && door === 'claim' ? 'NeonKing77' : 'TestGuest001',
                              rating: 1000, created_at: new Date().toISOString(),
                              named_at: claimed ? '2026-08-01T00:00:00Z' : null }]) });
  });
  await page.route('**/rest/v1/matches*', (r) => r.fulfill({ status: 200, contentType: 'application/json', body: '[]' }));
  await page.route('**/auth/v1/.well-known/**', (r) => r.fulfill({ status: 200, contentType: 'application/json', body: '{"keys":[]}' }));
  /* the 0022 shape: points/rank/apex/avatar/peak. The two rows sit in
     DIFFERENT groups (1,072 is IVORY, 465 is BONE) so the board has to draw a
     horizon for each — the group structure is asserted below. */
  await page.route('**/rest/v1/rpc/leaderboard*', (r) => {
    const board = r.request().url().includes('/rpc/leaderboard_before') ? []
      : [{ nickname: 'NovaComet992', points: 1072, wins: 7, losses: 2, games: 9, rank: 1, apex: false, avatar: 'die:3:mg', peak: 1100 },
         { nickname: 'TestGuest001', points: 465, wins: 42, losses: 61, games: 103, rank: 2, apex: false, avatar: 'die:5:cy', peak: 700 }];
    return r.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(board) });
  });
  await page.route('**/rest/v1/rpc/player_card*', (r) => r.fulfill({ status: 200, contentType: 'application/json',
    body: JSON.stringify([{ streak: 4, since: '2026-06-01T00:00:00Z' }]) }));
  return () => signupCalls;
}
