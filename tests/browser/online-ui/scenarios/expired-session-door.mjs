// THE DOOR MUST ANSWER, AND IT MUST ANSWER TRUTHFULLY.
//
// Johannes, 3 Sep 2026: the ladder spun, the profile rank never came, ranked
// said CAN'T CONNECT, and only restarting the app cleared it. The deployment
// was healthy throughout. What had gone stale was the access token, which
// lives exactly sixty minutes (supabase/config.toml jwt_expiry), on a phone
// that had slept longer than that.
//
// An expired token turns getSession() from a storage read into a network one,
// and auth-js retries a connection it cannot reach with exponential backoff
// for as long as its 30s tick allows — longer when the requests hang rather
// than fail, which is what dead mobile data actually does. Nothing above it
// imposed a deadline, so ranked entry mounted its loading die and never came
// back. That is the "loading endlessly" in the report, and it is the first
// case below.
//
// The second case is the guard on the first. A refused refresh and an
// unreachable one look alike from above and must NOT be answered alike: the
// library deletes the session on a refusal and keeps it on a network failure,
// so telling a player with a bad line that they have been signed out would be
// a worse bug than the one being fixed. Both cases are asserted on the surface
// the player can actually see and press.

const REAL_ACCOUNT_DEVICE = () => {
  /* A device that has held a real account: the flag session.ts writes the
     first time it sees a non-guest. Without it a lost session is answered by
     silently minting a fresh guest, which is right for guests and precisely
     wrong for the player whose rating is on the dead account. */
  localStorage.setItem('knucklebones.online.attached', '1');
};

/* Poll for whichever surface the door produces. A door that produces NEITHER
   is the defect under test, so this returns its last reading rather than
   throwing, and the checks below name what the player was left looking at. */
const settleDoor = (page, budgetMs) => page.evaluate(async (budget) => {
  const read = () => {
    const sheet = document.querySelector('.authsheet:not(.foout)');
    const sheetBox = sheet?.getBoundingClientRect();
    const onSheet = sheetBox && sheetBox.width > 0 && sheetBox.height > 0
      ? document.elementFromPoint(sheetBox.x + sheetBox.width / 2, sheetBox.y + 24)
      : null;
    const ask = document.getElementById('ovAsk');
    const askBox = ask?.querySelector('.askcard')?.getBoundingClientRect();
    const onAsk = askBox
      ? document.elementFromPoint(askBox.x + askBox.width / 2, askBox.y + askBox.height / 2)
      : null;
    const loading = document.getElementById('onLoading');
    const die = loading && !loading.hidden ? loading.getBoundingClientRect() : null;
    return {
      signInOffered: !!sheet && !!onSheet && !!sheet.contains(onSheet),
      signInTitle: document.getElementById('onAuthTitle')?.textContent?.trim() ?? null,
      connectionSheet: ask?.classList.contains('on') && !!onAsk && !!ask.contains(onAsk)
        ? document.getElementById('askHead')?.textContent?.trim() ?? '' : null,
      retry: document.getElementById('btnAskYes')?.textContent?.trim() ?? null,
      stillLoading: (() => {
        if (!die || die.width <= 0 || die.height <= 0) return false;
        /* Laid out is not the same as looked at: the overlay behind a refusal
           may still hold a sized die at zero opacity. Ask what the player's
           finger would land on. */
        const at = document.elementFromPoint(die.x + die.width / 2, die.y + die.height / 2);
        return !!at && (loading.contains(at) || at === loading);
      })(),
      dieOpacity: die ? Number(getComputedStyle(loading).opacity) : null,
      overlayOn: !!document.getElementById('ovOnline')?.classList.contains('on'),
      /* Proof the player was not quietly logged out to make an error go away. */
      sessionKept: !!localStorage.getItem('sb-euzjcejbkxvqfrttgaxu-auth-token'),
    };
  };
  const deadline = Date.now() + budget;
  let state = read();
  while (Date.now() < deadline && !state.signInOffered && state.connectionSheet === null) {
    await new Promise((resolve) => { setTimeout(resolve, 150); });
    state = read();
  }
  return { ...state, waitedMs: budget - Math.max(0, deadline - Date.now()) };
}, budgetMs);

export async function runExpiredSessionDoorScenarios(suite) {
  const { visit, out, check } = suite;

  /* A TOKEN ENDPOINT THAT NEVER ANSWERS. The read is bounded at 15s
     (READ_TIMEOUT_MS), so a door that is going to answer has answered inside
     20. Without the deadline this window closes with the die still turning. */
  await visit({
    door: 'chip',
    preauthenticated: true,
    expiredSession: true,
    offlineTokenEndpoint: true,
    expectEntryRefusal: true,
    skipStandardProbes: true,
    returnAfterProbe: true,
    initScript: REAL_ACCOUNT_DEVICE,
    probe: async (page) => {
      const door = await settleDoor(page, 20000);
      out.unreachableTokenDoor = door;
      check(door.stillLoading === false,
        'the account door left its loading die turning with no error and no retry, '
          + 'which is the failure that cost a restart', door);
      check(door.connectionSheet !== null && door.retry === 'Try again',
        'an unreachable token endpoint produced no retryable connection sheet', door);
      check(door.signInOffered === false && door.sessionKept === true,
        'a player with a bad line was signed out of a session that is still stored',
        door);
    },
  });

  /* A REFUSED REFRESH TOKEN, which is a different thing entirely: the login is
     genuinely gone, the library deletes it as it gives up, and the only useful
     answer is the sign-in door. Pinned because the deadline above must never
     grow into a connection sheet over a dead login — retrying one of those
     forever is the dead end this whole change exists to remove. */
  await visit({
    door: 'chip',
    preauthenticated: true,
    expiredSession: true,
    refuseSessionRefresh: true,
    expectEntryRefusal: true,
    skipStandardProbes: true,
    returnAfterProbe: true,
    initScript: REAL_ACCOUNT_DEVICE,
    probe: async (page, routes) => {
      const door = await settleDoor(page, 12000);
      out.refusedRefreshDoor = { ...door, refreshCalls: routes.refreshCalls() };
      check(door.signInOffered === true,
        'a dead login did not put the sign-in door in front of the player', door);
      check(door.connectionSheet === null,
        'a dead login was reported as a connection problem, which no amount of '
          + 'retrying can fix', door);
      check(door.sessionKept === false,
        'the refused session was left in storage to fail every later read', door);
      check(routes.refreshCalls() >= 1,
        'the door decided without ever asking the token endpoint',
        { refreshCalls: routes.refreshCalls() });
    },
  });
}
