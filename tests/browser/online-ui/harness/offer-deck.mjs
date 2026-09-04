/* The profile's two identity offers share one swipe deck (src/online/screens/
   account-offers.ts), so only one card is laid out at a time. A suite that
   wants a control on the second card has to get there the way a player does.

   Paging by DOTS is deliberate rather than by synthetic swipe: the dots are
   presentation and carry aria-hidden, so this drives the deck's own move()
   through its scoped arrow keys — the same code path a keyboard player uses,
   and one that does not depend on a 48px gesture landing in a headless
   browser. The swipe itself is asserted separately, once, in fresh-account. */
export async function openOffer(page, offer) {
  const order = ['claim', 'guest'];
  const target = order.indexOf(offer);
  if (target < 0) throw new Error(`unknown identity offer: ${offer}`);
  /* Not every scenario reaches a profile that is owed offers — a linked member
     with a claimed name is asked nothing and the deck never deals. Return
     quietly there and let the caller's own click report what it could not
     find; a throw here would blame the deck for a state that never had one. */
  const dealt = await page.waitForSelector('#accOffers:not([hidden])', { timeout: 5000 })
    .then(() => true, () => false);
  if (!dealt) return;
  /* Page TOWARD the target rather than always forward. A probe that only ever
     presses ArrowRight can reach the guest offer and never get back, and the
     deck does not wrap — so walking home from the last slide silently did
     nothing and every later wait blamed the page. */
  for (let step = 0; step <= order.length; step += 1) {
    const showing = await page.evaluate(() => (
      !document.getElementById('accClaim')?.hidden ? 'claim'
        : !document.getElementById('accGuest')?.hidden ? 'guest' : null));
    if (showing === offer) return;
    const at = order.indexOf(showing);
    const key = at >= 0 && at > target ? 'ArrowLeft' : 'ArrowRight';
    await page.evaluate((arrow) => {
      document.getElementById('accOffers')
        .dispatchEvent(new KeyboardEvent('keydown', { key: arrow, bubbles: true }));
    }, key);
    await page.waitForTimeout(60);
  }
  throw new Error(`identity offer "${offer}" never came up after paging the whole deck`);
}
