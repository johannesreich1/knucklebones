export async function runFreshAccountScenarios(suite) {
  const { visit, out, check } = suite;
  // 1 · the newcomer: no form, a name, a rating, and the offer to keep it
  const fresh = await visit({});
  out.fresh = fresh.seen;
  out.homeStyles = fresh.homeStyles;
  check(fresh.homeStyles.before?.row.gap === '8px',
        'the Home style probe no longer targets the eager action row', fresh.homeStyles);
  check(JSON.stringify(fresh.homeStyles.before) === JSON.stringify(fresh.homeStyles.after),
        'opening Online changed Home computed styles', fresh.homeStyles);
  check(fresh.seen.panel === 'account', 'newcomer was asked to sign in', fresh.seen);
  check(fresh.seen.accName === 'TestGuest001' && fresh.seen.accNameShown === true,
        'guest got no visible nickname headline', fresh.seen);
  /* the unnamed player is offered their ONE claim: empty input, the minted
     name as the placeholder they keep by never typing */
  check(fresh.seen.claim === true, 'a fresh player was not offered the name claim', fresh.seen);
  check(fresh.seen.nickValue === '' && fresh.seen.nickHint === 'TestGuest001',
        'the claim input should start empty with the minted name as placeholder', fresh.seen);
  check(fresh.seen.guestBox === true, 'guest was not offered the way up', fresh.seen);
  check(fresh.seen.signOut === false, 'guest offered Sign out — that discards, not signs out', fresh.seen);
  check(fresh.errs.length === 0, 'page errors on the guest path', fresh.errs);
  // both ladder facts are doors: tapping either lands on the board
  check(fresh.rankDoor?.board === true && fresh.rankDoor?.title === 'LADDER'
    && fresh.rankDoor.control?.tag === 'BUTTON'
    && fresh.rankDoor.control?.label === 'Open the ladder'
    && fresh.rankDoor.control?.width >= 44 && fresh.rankDoor.control?.height >= 44,
  'tapping the accessible Rank tile does not open the ladder', fresh.rankDoor);
  check(fresh.ptsDoor?.board === true && fresh.ptsDoor?.title === 'LADDER',
        'tapping the points on the profile does not open the ladder', fresh.ptsDoor);
  check(fresh.seen.accGroup?.text === fresh.ptsDoor?.group?.text
    && fresh.seen.accGroup?.color === fresh.ptsDoor?.group?.color,
  'the profile league name does not use its ladder material colour', {
    profile: fresh.seen.accGroup,
    ladder: fresh.ptsDoor?.group,
  });
}
