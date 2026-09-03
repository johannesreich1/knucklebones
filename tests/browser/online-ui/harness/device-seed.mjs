// What the device already holds when the page loads. Everything here runs
// BEFORE navigation, so it is the app's starting world rather than anything a
// probe does to it: the session Supabase persisted last time, and the local
// save that says this player has played before.

/** The auth slot supabase-js reads on boot. Named by project ref, so it is a
 *  literal here for the same reason it is one in the app's config. */
const AUTH_SLOT = 'sb-euzjcejbkxvqfrttgaxu-auth-token';

/** Doors that enter through ranked meet the once-only tutorial offer unless
 *  the device has played. A queue probe is never about that offer. */
const PLAYED_DOORS = new Set(['play', 'match', 'auth-play']);

/**
 * Prime storage the way a returning player's device holds it.
 *
 * `expiredSession` stores the session already past its expiry, which is the
 * only way to make the app's first read go to the token endpoint at all — and
 * therefore the only way to exercise a refresh that is refused or unreachable.
 * A phone that has slept longer than an access token lives (sixty minutes,
 * supabase/config.toml jwt_expiry) wakes holding exactly this.
 */
export async function seedDevice(page, {
  door,
  preauthenticated = false,
  expiredSession = false,
  session,
  initScript = null,
}) {
  if (PLAYED_DOORS.has(door)) {
    await page.addInitScript(() => localStorage.setItem(
      'knucklebones.v1', JSON.stringify({ played: true }),
    ));
  }
  if (preauthenticated) {
    await page.addInitScript(({ slot, stored, expired }) => localStorage.setItem(
      slot,
      JSON.stringify(expired
        ? { ...stored, expires_in: 0, expires_at: Math.floor(Date.now() / 1000) - 60 }
        : stored),
    ), { slot: AUTH_SLOT, stored: session, expired: expiredSession });
  }
  if (initScript) await page.addInitScript(initScript);
}
