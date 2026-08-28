/* WHERE BO2 MUST NOT APPEAR, AND WHAT IT MUST NOT LEAVE BEHIND. Both beats run
   on the shared page and both assert zero stamps and zero residue.

   Two exports rather than one because run.mjs drives every spell scenario
   against a single page and only guards the room BETWEEN scenarios: the entry
   keeps each beat in its original slot, the CLASSIC control second and the
   restart last, instead of collapsing them into one trailing call. */

export async function runBountyClassicControlScenario(suite) {
  const { page, out, check, newGame, waitChoose, table } = suite;
  /* CLASSIC remains the control: the same hit uses generic destruction and
     never manufactures a struck coin. */
  await newGame({ spell: '', mode: 0 });
  check(await waitChoose(), 'game never reached choose (BO2 classic control)');
  await table([[], [], []], [[4, 4, 2], [4], []], 4);
  out.bountyClassic = await page.evaluate(async () => {
    const k = window.__kb;
    const move = k.place(1, 0);
    for (let i = 0; i < 120 && !document.querySelector('.die.dying'); i++) {
      await new Promise((resolve) => setTimeout(resolve, 5));
    }
    const during = { dying: document.querySelectorAll('.die.dying').length,
      stamps: document.querySelectorAll('.bounty-mint').length,
      particles: document.querySelectorAll('#fx .particle').length };
    await move;
    return { during, board: JSON.stringify(k.S.boards[0]), bounty: JSON.stringify(k.S.bounty) };
  });
  check(out.bountyClassic.during.dying === 2 && out.bountyClassic.during.stamps === 0
      && out.bountyClassic.during.particles > 0 && out.bountyClassic.board === '[[2],[4],[]]'
      && out.bountyClassic.bounty === '[0,0]',
    'CLASSIC no longer uses its unchanged generic destruction control', out.bountyClassic);
}

export async function runBountyRestartScenario(suite) {
  const { page, out, check, newGame, waitChoose, table } = suite;
  /* A new generation cancels the absolute clock and owns a clean grid. */
  await newGame({ spell: '', mode: 5 });
  check(await waitChoose(), 'game never reached choose (BO2 interruption)');
  await table([[], [], []], [[4, 4, 4], [], []], 4);
  await page.evaluate(() => {
    window.__bountyInterruptedDone = false;
    void window.__kb.place(1, 0).finally(() => { window.__bountyInterruptedDone = true; });
  });
  await page.waitForSelector('.bounty-mint');
  await page.evaluate(() => window.__kb.newGame());
  await page.waitForFunction(() => window.__bountyInterruptedDone
    && !document.querySelector('.bounty-mint,.bounty-mint-slot,.bounty-flatten'));
  out.bountyInterrupted = await page.evaluate(() => ({
    residue: document.querySelectorAll('.bounty-mint,.bounty-mint-slot,.bounty-flatten').length,
    boards: JSON.stringify(window.__kb.S.boards), bounty: JSON.stringify(window.__kb.S.bounty),
  }));
  check(out.bountyInterrupted.residue === 0 && out.bountyInterrupted.bounty === '[0,0]'
      && out.bountyInterrupted.boards === '[[[],[],[]],[[],[],[]]]',
    'restart leaked BO2 presentation or the interrupted destruction state', out.bountyInterrupted);
}
