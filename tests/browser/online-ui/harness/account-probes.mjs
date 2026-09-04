export async function probeAccountActions(page, { door, named }, routes) {
  const assertNoOfflineRestart = async (label) => {
    const visible = await page.evaluate(() => {
      const button = document.getElementById('btnAskAlt');
      if (!button || button.hidden) return false;
      const rect = button.getBoundingClientRect();
      const style = getComputedStyle(button);
      return rect.width > 0 && rect.height > 0
        && style.display !== 'none' && style.visibility !== 'hidden';
    });
    if (visible) throw new Error(`${label} exposed the offline Restart duel action`);
  };
  /* the claim, end to end: type, confirm through the shared ask-card, watch
     the card retire, the headline take the name, and the way-up offer arrive
     (a guest just chained a forever-name to a device-only account) */
  let claimFlow = null;
  if (door === 'claim') {
    await page.fill('#onNick', 'NeonKing77');
    /* WebKit touch activation need not focus the tapped button. Open once from
       a deliberately unfocused synthetic tap and prove the semantic opener is
       restored before exercising the successful path. */
    await page.evaluate(() => {
      if (document.activeElement instanceof HTMLElement) document.activeElement.blur();
      document.getElementById('btnClaim').click();
    });
    await page.waitForSelector('#ovAsk.on', { timeout: 5000 });
    await page.click('#btnAskNo');
    await page.waitForFunction(() => !document.getElementById('ovAsk')
      && document.activeElement?.id === 'btnClaim');
    const cancelFocus = await page.evaluate(() => document.activeElement?.id);
    await page.click('#btnClaim');
    await page.waitForSelector('#ovAsk.on', { timeout: 5000 });
    await assertNoOfflineRestart('nickname claim');
    const confirmHead = await page.evaluate(() => document.querySelector('#askHead')?.textContent);
    routes.failNextAccountProfileResponse();
    await page.click('#btnAskYes');
    await page.waitForFunction(() => document.querySelector('#askHead')?.textContent?.startsWith('Keep '),
      null, { timeout: 15000 });
    await assertNoOfflineRestart('account upgrade');
    const state = await page.evaluate(() => {
      const vis = (s) => { const e = document.querySelector(s); if (!e) return false;
        const r = e.getBoundingClientRect(); return r.width > 0 && r.height > 0; };
      return { head: document.querySelector('#askHead')?.textContent,
               claimGone: !vis('#accClaim'),
               headline: document.querySelector('#onAccount')?.dataset.accountName,
               /* an invitation wears primary on YES (ask's loud flag) — read
                  the computed paint, not the class list */
               yesLoud: getComputedStyle(document.querySelector('#btnAskYes')).backgroundImage.includes('gradient') };
    });
    await page.click('#btnAskYes'); // "Create account" — the way up
    await page.waitForFunction(() => document.querySelector('#onAuth')?.hidden === false, null, { timeout: 5000 });
    claimFlow = { cancelFocus, confirmHead, ...state, authShown: true };
  }
  /* The shared sheet owns a z-index above every paged overlay. Recreate the
     historical hazard (Online moved to the end before the question reopens),
     wait for the sheet's intentional arrival flight, and assert it wins the
     pixel. State and DOM can agree while the player sees neither. */
  let askAbove = null;
  if (named) {
    await page.evaluate(() => {
      if (document.activeElement instanceof HTMLElement) document.activeElement.blur();
      document.getElementById('btnDeleteAcc').click();
    });
    await page.waitForSelector('#ovAsk.on', { timeout: 5000 });
    await assertNoOfflineRestart('account deletion');
    await page.click('#btnAskNo');
    await page.waitForFunction(() => !document.getElementById('ovAsk')
      && document.activeElement?.id === 'btnDeleteAcc');
    await page.evaluate(() => document.getElementById('kbroot').appendChild(document.querySelector('#ovOnline')));
    await page.click('#btnDeleteAcc');
    await page.waitForSelector('#ovAsk.on', { timeout: 5000 });
    await assertNoOfflineRestart('reopened account deletion');
    await page.waitForFunction(() => {
      const node = document.querySelector('#ovAsk .focard');
      if (!node) return false;
      const transform = getComputedStyle(node).transform;
      return transform === 'none' || Math.abs(new DOMMatrixReadOnly(transform).m42) < 0.5;
    });
    askAbove = await page.evaluate(() => {
      const card = document.querySelector('#ovAsk .askcard');
      const rc = card.getBoundingClientRect();
      return card.contains(document.elementFromPoint(rc.x + rc.width / 2, rc.y + rc.height / 2));
    });
    await page.click('#btnAskNo');
  }
  /* Rank and points are two views of the same ladder fact, so both are real,
     accessible doors to the same board. Walk both in one account session. */
  let rankDoor = null;
  let ptsDoor = null;
  if (door === 'chip') {
    const onAccount = await page.evaluate(() => document.querySelector('#onAccount')?.hidden === false);
    if (onAccount) {
      const control = await page.evaluate(() => {
        const button = document.getElementById('btnRank');
        const box = button?.getBoundingClientRect();
        return button && box ? { tag: button.tagName, label: button.getAttribute('aria-label'),
          width: box.width, height: box.height } : null;
      });
      await page.click('#btnRank');
      await page.waitForSelector('#ovOnline .lb .lrow.me', { timeout: 15000 });
      rankDoor = await page.evaluate((control) => ({
        control,
        board: document.querySelector('#onLadder')?.hidden === false,
        title: document.querySelector('#onTitle')?.textContent,
      }), control);
      await page.click('#ovOnline .lb .lrow.me');
      await page.waitForSelector('#onAccount:not([hidden])', { timeout: 15000 });
      await page.click('#btnLadder');
      await page.waitForSelector('#ovOnline .lb .lrow', { timeout: 15000 });
      ptsDoor = await page.evaluate(() => {
        const group = document.querySelector('#ovOnline .lrow.me .mesub b');
        return {
          board: document.querySelector('#onLadder')?.hidden === false,
          title: document.querySelector('#onTitle')?.textContent,
          group: group ? { text: group.textContent, color: getComputedStyle(group).color } : null,
        };
      });
    }
  }
  return { claimFlow, askAbove, rankDoor, ptsDoor };
}
