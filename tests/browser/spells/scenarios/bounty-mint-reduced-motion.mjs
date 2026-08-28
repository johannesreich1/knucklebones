/* THE REDUCED-MOTION STILL — the ABSENCE of exactly the animations the strike
   module asserts the presence of: every victim appears at once, centred, with
   no bounty-mint-* animation running, held for 320ms, settling cleanly on
   authoritative state. Owns its own reduced-motion context and closes it. */
import { close } from './bounty-mint-contract.mjs';

export async function runBountyMintReducedMotionScenarios(suite) {
  const { out, check, newGame, waitChoose, table, sidePage } = suite;
  /* Reduced motion is one readable still: all victims appear together for
     320ms, centred in the grid, with no BO2 animation running. */
  const reduced = await sidePage({ name: 'BO2 reduced', w: 390, h: 844,
    opts: { reducedMotion: 'reduce' } });
  try {
    await newGame({ spell: '', mode: 5 }, reduced.page);
    check(await waitChoose(reduced.page), 'game never reached choose (BO2 reduced)');
    await table([[], [], []], [[4, 4], [], []], 4, reduced.page);
    out.bountyReduced = await reduced.page.evaluate(async () => {
      const k = window.__kb;
      const move = k.place(1, 0);
      for (let i = 0; i < 160 && !document.querySelector('.bounty-mint-static'); i++) {
        await new Promise((resolve) => setTimeout(resolve, 4));
      }
      const appearedAt = performance.now();
      const victims = [...document.querySelectorAll('.bounty-mint-static')].map((stamp) => {
        const slot = stamp.closest('.slot'), sr = slot.getBoundingClientRect(), mr = stamp.getBoundingClientRect();
        return {
          source: slot.dataset.bountySource,
          delay: parseFloat(slot.style.getPropertyValue('--bounty-delay')),
          flatten: !!slot.querySelector('.bounty-flatten'),
          animations: slot.getAnimations({ subtree: true }).filter((animation) =>
            animation.animationName?.startsWith('bounty-mint-')).length,
          centreError: Math.max(
            Math.abs(sr.x + sr.width / 2 - (mr.x + mr.width / 2)),
            Math.abs(sr.y + sr.height / 2 - (mr.y + mr.height / 2)),
          ),
        };
      });
      for (let i = 0; i < 160 && document.querySelector('.bounty-mint-static'); i++) {
        await new Promise((resolve) => setTimeout(resolve, 4));
      }
      const visibleFor = performance.now() - appearedAt;
      await move;
      return { victims, visibleFor, board: JSON.stringify(k.S.boards[0]), bounty: JSON.stringify(k.S.bounty),
        residue: document.querySelectorAll('.bounty-mint,.bounty-mint-slot,.bounty-flatten').length };
    });
    const still = out.bountyReduced;
    check(still.victims.length === 2 && still.victims.every((victim) =>
      victim.source === 'ordinary' && victim.delay === 0 && !victim.flatten
        && victim.animations === 0 && victim.centreError <= 1)
        && close(still.visibleFor, 320, 45),
      'reduced motion did not show simultaneous static centred coins for 320ms', still);
    check(still.board === '[[],[],[]]' && still.bounty === '[0,2]' && still.residue === 0,
      'reduced BO2 did not cleanly settle on authoritative state', still);
  } finally {
    await reduced.ctx.close();
  }
}
