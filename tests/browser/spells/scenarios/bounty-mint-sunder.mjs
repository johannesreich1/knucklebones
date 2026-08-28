/* BO2 UNDER SU6. A different promise from the plain strike: BO2 defers to the
   collapse rather than replacing it, settles each coin on the collapse’s 62%
   impact, never outlives it, and never stamps a Warded column. */
import { close } from './bounty-mint-contract.mjs';

export async function runBountyMintSunderScenarios(suite) {
  const { page, out, check, newGame, waitChoose, table, guard } = suite;
  /* SUNDER owns the collapse. BO2 settles each coin on the SU6 impact; the
     Warded middle column is neither collapsed nor stamped. */
  await newGame({ spell: 'sunder', mode: 5 });
  check(await waitChoose(), 'game never reached choose (BO2 + SU6)');
  await table([[], [], []], [[4, 4], [4, 2], [4, 1, 4]], 4);
  await guard(1, 0);
  await page.evaluate(() => window.__kb.spells.cast('sunder', -1));
  out.bountySunder = await page.evaluate(async () => {
    const k = window.__kb;
    const move = k.place(1, 0);
    for (let i = 0; i < 220 && document.querySelectorAll('.bounty-mint').length !== 4; i++) {
      await new Promise((resolve) => setTimeout(resolve, 10));
    }
    const slots = [...document.querySelectorAll('.bounty-mint-slot')]
      .sort((a, b) => Number(a.dataset.bountyOrder) - Number(b.dataset.bountyOrder));
    await Promise.all(slots.flatMap((slot) => slot.getAnimations({ subtree: true }))
      .map((animation) => animation.ready));
    const victims = slots
      .map((slot) => {
        const die = slot.querySelector(':scope > .die');
        const stamp = slot.querySelector(':scope > .bounty-mint');
        const collapse = die.getAnimations().find((item) => item.animationName === 'su6fail');
        const strike = stamp.getAnimations().find((item) => item.animationName === 'bounty-mint-strike');
        const collapseTiming = collapse.effect.getTiming(), strikeTiming = strike.effect.getTiming();
        return {
          order: Number(slot.dataset.bountyOrder), source: slot.dataset.bountySource,
          flatten: die.classList.contains('bounty-flatten'),
          collapseDuration: Number(collapseTiming.duration), collapseDelay: Number(collapseTiming.delay),
          stampDuration: Number(strikeTiming.duration), stampDelay: Number(strikeTiming.delay),
          settle: Number(strikeTiming.delay) + 360,
          impact: Number(collapseTiming.delay) + Number(collapseTiming.duration) * .62,
          stampEnd: Number(strikeTiming.delay) + Number(strikeTiming.duration),
          collapseEnd: Number(collapseTiming.delay) + Number(collapseTiming.duration),
          timelineSettle: Number(strike.startTime) + Number(strikeTiming.delay) + 360,
          timelineImpact: Number(collapse.startTime) + Number(collapseTiming.delay)
            + Number(collapseTiming.duration) * .62,
          timelineStampEnd: Number(strike.startTime) + Number(strikeTiming.delay)
            + Number(strikeTiming.duration),
          timelineCollapseEnd: Number(collapse.startTime) + Number(collapseTiming.delay)
            + Number(collapseTiming.duration),
        };
      });
    const protectedColumn = document.querySelector('#topBoard .col[data-col="1"]');
    const during = {
      collapse: document.querySelectorAll('.die.sunder-collapse').length,
      protectedStamps: protectedColumn.querySelectorAll('.bounty-mint').length,
      protectedCollapse: protectedColumn.querySelectorAll('.die.sunder-collapse').length,
    };
    await move;
    return {
      victims, during, board: JSON.stringify(k.S.boards[0]), bounty: JSON.stringify(k.S.bounty),
      wards: JSON.stringify(k.S.charm.wards),
      feedback: [...document.querySelectorAll('.pts')].map((element) => element.textContent),
      residue: document.querySelectorAll('.bounty-mint,.bounty-mint-slot,.bounty-flatten,.sunder-collapse').length,
    };
  });
  const combo = out.bountySunder;
  check(combo.victims.length === 4 && combo.during.collapse === 4
      && combo.during.protectedStamps === 0 && combo.during.protectedCollapse === 0
      && combo.victims.every((victim) => victim.source === 'sunder' && !victim.flatten),
    'BO2 replaced SU6 collapse or stamped its Warded matching die', combo);
  check(combo.victims.every((victim, index) => victim.order === index
      && victim.collapseDuration === 2600 && victim.stampDuration === 1296
      && close(victim.settle, victim.impact, .5) && victim.stampEnd <= victim.collapseEnd
      && close(victim.timelineSettle, victim.timelineImpact, 2)
      && victim.timelineStampEnd <= victim.timelineCollapseEnd),
    'BO2 coin does not settle on SU6 62% impact or extends the collapse', combo.victims);
  check(combo.board === '[[],[4,2],[1]]' && combo.bounty === '[0,4]'
      && JSON.parse(combo.wards)[0][1] === 0 && combo.feedback.includes('+4 ✦')
      && combo.residue === 0,
    'BO2 + SU6 presentation disagreed with protected authoritative state', combo);
}
