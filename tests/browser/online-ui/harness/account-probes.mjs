export async function probeAccountActions(page, { door, named }) {
  /* the claim, end to end: type, confirm through the shared ask-card, watch
     the card retire, the headline take the name, and the way-up offer arrive
     (a guest just chained a forever-name to a device-only account) */
  let claimFlow = null;
  if (door === 'claim') {
    await page.fill('#onNick', 'NeonKing77');
    await page.click('#btnClaim');
    await page.waitForSelector('#ovAsk.on', { timeout: 5000 });
    const confirmHead = await page.evaluate(() => document.querySelector('#askHead')?.textContent);
    await page.click('#btnAskYes');
    await page.waitForFunction(() => document.querySelector('#askHead')?.textContent?.startsWith('Keep '),
      null, { timeout: 15000 });
    const state = await page.evaluate(() => {
      const vis = (s) => { const e = document.querySelector(s); if (!e) return false;
        const r = e.getBoundingClientRect(); return r.width > 0 && r.height > 0; };
      return { head: document.querySelector('#askHead')?.textContent,
               claimGone: !vis('#accClaim'),
               headline: document.querySelector('#accName')?.textContent,
               /* an invitation wears primary on YES (ask's loud flag) — read
                  the computed paint, not the class list */
               yesLoud: getComputedStyle(document.querySelector('#btnAskYes')).backgroundImage.includes('gradient') };
    });
    await page.click('#btnAskYes'); // "Create account" — the way up
    await page.waitForFunction(() => document.querySelector('#onAuth')?.hidden === false, null, { timeout: 5000 });
    claimFlow = { confirmHead, ...state, authShown: true };
  }
  /* the ask-card vs later overlays: every .ov shares one z-index, so DOM order
     paints. Recreate the hazard (an overlay re-appended AFTER #ovAsk — the
     offline-quit-then-profile ordering) and assert the card wins the PIXEL:
     ask() re-appends itself on every open. test13's lesson — state and DOM can
     agree while the player sees neither. */
  let askAbove = null;
  if (named) {
    await page.click('#btnDeleteAcc');
    await page.waitForSelector('#ovAsk.on', { timeout: 5000 });
    await page.click('#btnAskNo');
    await page.evaluate(() => document.getElementById('kbroot').appendChild(document.querySelector('#ovOnline')));
    await page.click('#btnDeleteAcc');
    await page.waitForSelector('#ovAsk.on', { timeout: 5000 });
    askAbove = await page.evaluate(() => {
      const card = document.querySelector('#ovAsk .askcard');
      const rc = card.getBoundingClientRect();
      return card.contains(document.elementFromPoint(rc.x + rc.width / 2, rc.y + rc.height / 2));
    });
    await page.click('#btnAskNo');
  }
  /* the points on the profile are a door: tapping them opens the ladder */
  let ptsDoor = null;
  if (door === 'chip') {
    const onAccount = await page.evaluate(() => document.querySelector('#onAccount')?.hidden === false);
    if (onAccount) {
      await page.click('#btnLadder');
      await page.waitForSelector('#ovOnline .lb .lrow', { timeout: 15000 });
      ptsDoor = await page.evaluate(() => ({
        board: document.querySelector('#onBoard')?.hidden === false,
        title: document.querySelector('#onTitle')?.textContent,
      }));
    }
  }
  return { claimFlow, askAbove, ptsDoor };
}
