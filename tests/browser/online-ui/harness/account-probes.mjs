export async function probeAccountActions(page, { door, named }) {
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
    await page.click('#btnClaim');
    await page.waitForSelector('#ovAsk.on', { timeout: 5000 });
    await assertNoOfflineRestart('nickname claim');
    const confirmHead = await page.evaluate(() => document.querySelector('#askHead')?.textContent);
    await page.click('#btnAskYes');
    await page.waitForFunction(() => document.querySelector('#askHead')?.textContent?.startsWith('Keep '),
      null, { timeout: 15000 });
    await assertNoOfflineRestart('account upgrade');
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
    await assertNoOfflineRestart('account deletion');
    await page.click('#btnAskNo');
    await page.evaluate(() => document.getElementById('kbroot').appendChild(document.querySelector('#ovOnline')));
    await page.click('#btnDeleteAcc');
    await page.waitForSelector('#ovAsk.on', { timeout: 5000 });
    await assertNoOfflineRestart('reopened account deletion');
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
        board: document.querySelector('#onBoard')?.hidden === false,
        title: document.querySelector('#onTitle')?.textContent,
      }), control);
      await page.click('#ovOnline .lb .lrow.me');
      await page.waitForSelector('#onAccount:not([hidden])', { timeout: 15000 });
      await page.click('#btnLadder');
      await page.waitForSelector('#ovOnline .lb .lrow', { timeout: 15000 });
      ptsDoor = await page.evaluate(() => {
        const group = document.querySelector('#ovOnline .lrow.me .mesub b');
        return {
          board: document.querySelector('#onBoard')?.hidden === false,
          title: document.querySelector('#onTitle')?.textContent,
          group: group ? { text: group.textContent, color: getComputedStyle(group).color } : null,
        };
      });
    }
  }
  return { claimFlow, askAbove, rankDoor, ptsDoor };
}
