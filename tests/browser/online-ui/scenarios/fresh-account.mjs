export async function runFreshAccountScenarios(suite) {
  const { visit, out, check } = suite;
  // 1 · the newcomer: no form, a name, a rating, and the offer to keep it
  const fresh = await visit({});
  out.fresh = fresh.seen;
  out.homeStyles = fresh.homeStyles;
  check(fresh.homeStyles.before?.row.gap === '8px',
        'the Home style probe no longer targets the eager action row', fresh.homeStyles);
  const styleOnly = ({ chip: _chip, ...styles } = {}) => styles;
  check(JSON.stringify(styleOnly(fresh.homeStyles.before))
      === JSON.stringify(styleOnly(fresh.homeStyles.after)),
        'opening Online changed Home computed styles', fresh.homeStyles);
  check(fresh.seen.panel === 'account', 'newcomer was asked to sign in', fresh.seen);
  check(fresh.seen.accName === 'TestGuest001',
        'the profile does not know whose account it is showing', fresh.seen);
  /* THE NAME LINE IS GONE, and stays gone. It sat between the league and the
     points and pushed the number down for no one's benefit — you already know
     whose profile you opened (owner call). Asserted as paint, because a
     headline could return as any element. */
  check(fresh.seen.accNameShown === false,
        'a nickname headline is back under the league', fresh.seen);
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
    /* The tile announces the value AND the action, because rank loads on its
       own and may read as pending, last-known, or unavailable. */
    && /^RANK: (#[\d,]+|–|Loading)\. Open the ladder$/.test(fresh.rankDoor.control?.label ?? '')
    && fresh.rankDoor.control?.width >= 44 && fresh.rankDoor.control?.height >= 44,
  'tapping the accessible Rank tile does not open the ladder', fresh.rankDoor);
  check(fresh.ptsDoor?.board === true && fresh.ptsDoor?.title === 'LADDER',
        'tapping the points on the profile does not open the ladder', fresh.ptsDoor);
  /* THE POINTS ARE THE LEAGUE'S NUMBER, so they are painted in the league's
     material — like the ladder row they open (.lrow .rt) and the Home plate.
     They were a hardcoded var(--gold), which is RIGHT AT GOLD and wrong at
     every other league; a fresh guest is not gold, which is why this reads
     here and would prove nothing higher up the ladder. */
  check(!!fresh.seen.accPointsColor
    && fresh.seen.accPointsColor === fresh.seen.accGroup?.color,
  'the profile points are not painted in the league material the name wears', {
    points: fresh.seen.accPointsColor, league: fresh.seen.accGroup });
  /* RANK OPENS THE LADDER (asserted above), so it says so. Its neighbours,
     BEST STREAK and PEAK, open nothing and must stay unmarked. */
  check(fresh.seen.rankChevron === true,
    'the Rank tile opens the ladder but wears no door mark', fresh.seen);
  check(fresh.seen.accGroup?.text === fresh.ptsDoor?.group?.text
    && fresh.seen.accGroup?.color === fresh.ptsDoor?.group?.color,
  'the profile league name does not use its ladder material colour', {
    profile: fresh.seen.accGroup,
    ladder: fresh.ptsDoor?.group,
  });

  /* 1d · COLOUR-BLIND MODE PAINTS THE LEAGUE AND ITS NUMBER GOLD. The seven
     league materials are stone, bone, ivory, silver, gold, obsidian and neon:
     four near-neutral, and two of them the very hues the mode exists to pull
     apart — so as a set they carry nothing to a player who cannot tell them
     apart, and BONE above is exactly such a colour. The mode already pins the
     displayed pair to cyan-vs-gold, so both take var(--p2) and the profile
     stops asking the eye to name a league by its tint.
     Read as computed paint against --p2's OWN computed value, not against a
     literal: hard-coding rgb(255,209,102) here would pass a gold that had
     drifted away from the pair the rest of the screen is wearing. */
  const cb = await visit({ skipStandardProbes: true, probe: async (page) => {
    /* Enter the mode the way a player does — press Settings' own ON. Setting
       S.colorblind by hand looks equivalent and is NOT: the flag alone never
       runs the hue repaint, so --p2 stays the player's stored magenta and this
       whole check passes against a magenta league. (Measured: it did.) The
       segment's handler is the thing that pins the displayed pair to
       cyan-vs-gold, so press the button even though its page is not on top. */
    await page.evaluate(() => {
      document.querySelector('#cbSeg button[data-b="1"]').click();
    });
    /* back out to the ladder and in again through the row: the profile repaints
       on entry, the same door a player uses. */
    await page.click('#btnLadder');
    await page.waitForSelector('#ovOnline .lb .lrow.me', { timeout: 15000 });
    await page.click('#ovOnline .lb .lrow.me');
    await page.waitForSelector('#onAccount:not([hidden])', { timeout: 15000 });
    return page.evaluate(() => {
      const swatch = (value) => {
        const probe = document.createElement('span');
        probe.style.color = value;
        document.getElementById('onAccount').appendChild(probe);
        const painted = getComputedStyle(probe).color;
        probe.remove();
        return painted;
      };
      return {
        gold: swatch('var(--p2)'),
        /* --p2 must BE the gold token here, not merely agree with itself */
        goldToken: swatch('var(--gold)'),
        league: getComputedStyle(document.querySelector('#accGroup')).color,
        points: getComputedStyle(document.querySelector('#accPoints')).color,
        ring: document.querySelector('#accRing')?.style.getPropertyValue('--lr-material'),
      };
    });
  } });
  out.colorblind = cb.probeResult;
  check(cb.probeResult?.gold === cb.probeResult?.goldToken,
    'colour-blind mode did not pin the displayed pair to gold — the rest of '
    + 'this check would then pass against any hue at all', cb.probeResult);
  check(cb.probeResult?.league === cb.probeResult?.gold
    && cb.probeResult?.points === cb.probeResult?.gold,
  'colour-blind mode does not paint the league and its points in the pair gold',
  cb.probeResult);
  /* and the RING keeps the league's own material: it reports progress by how
     far it is filled, which survives any palette. */
  check(/^var\(--g-/.test(cb.probeResult?.ring ?? ''),
    'colour-blind mode flattened the ring off its league material', cb.probeResult);
}
