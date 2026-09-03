/* WHEN THE SHARED WAIT ARRIVES, AND WHETHER IT ARRIVES AS ONE THING.
   loading-panels owns WHICH panel a wait covers and where its die sits; this
   owns the reveal's TIMING, which is a different question with a different
   probe — painted opacity per frame rather than a settled geometry read.

   The bug it was written for: .ldwait and the .die.ldclock nested inside it
   each ran their own copy of the 200ms anti-flash grace — one idea written
   twice — so anything that re-timed the wrapper split the pair. A wait entered
   through a page transition does exactly that: paged-view.css zeroes the
   wrapper's delay because there the 420ms push IS the reveal. The die kept its
   own 200ms, so the player read "Loading" and only then saw the dice
   (reported from a device 2026-09-03, on the Ladder; measured 182ms apart). */

/* Sampled as PAINTED opacity, because the die's own value is only half the
   answer: what reaches the eye is the die's multiplied by the wrapper's, and a
   probe reading either alone cannot see this bug at all. */
const recordWaitReveal = () => {
  window.__ldReveal = null;
  let t0 = null;
  const seen = { word: null, die: null };
  const tick = () => {
    const wrap = document.querySelector('#onLoading .ldwait');
    if (wrap) {
      const die = wrap.querySelector('.die.ldclock');
      if (t0 === null) t0 = performance.now();
      const at = performance.now() - t0;
      const wrapOpacity = Number(getComputedStyle(wrap).opacity);
      /* .ldmsg carries no animation of its own, so the word is visible exactly
         when the wrapper is. */
      if (seen.word === null && wrapOpacity > .01) seen.word = at;
      if (seen.die === null && die
          && wrapOpacity * Number(getComputedStyle(die).opacity) > .01) seen.die = at;
      /* Latched, not sampled: the page-motion class lives only for the 420ms
         push and the delays revert with it, so a reading taken after cleanup
         describes a state the player never waited through. */
      const revealed = document.getElementById('onLoading')
        ?.classList.contains('page-motion-loader-revealed') ?? false;
      window.__ldReveal = {
        ...seen,
        revealed: revealed || (window.__ldReveal?.revealed ?? false),
        wrapDelay: window.__ldReveal?.wrapDelay ?? getComputedStyle(wrap).animationDelay,
        dieDelay: window.__ldReveal?.dieDelay
          ?? (die ? getComputedStyle(die).animationDelay : null),
      };
    }
    requestAnimationFrame(tick);
  };
  requestAnimationFrame(tick);
};

export async function runWaitRevealScenarios(suite) {
  const { visit, out, check } = suite;

  const entered = await visit({
    door: 'board',
    inspectLoading: true,
    initScript: `(${recordWaitReveal.toString()})();`,
    skipStandardProbes: true,
    returnAfterProbe: true,
    probe: (page) => page.evaluate(async () => {
      /* Past the wrapper's own 200ms grace and the die's, whichever ran. */
      await new Promise((resolve) => setTimeout(resolve, 700));
      return window.__ldReveal;
    }),
  });
  const reveal = entered.probeResult;
  const split = reveal && reveal.die !== null && reveal.word !== null
    ? Math.round(reveal.die - reveal.word) : null;
  out.waitReveal = { ...reveal, split };

  check(reveal?.revealed === true && split !== null,
    'never caught the shared wait revealing through a page transition — the '
    + 'timing below describes a state no player waits through', reveal);
  /* Two frames of slack and no more: 200ms apart is the reported bug, and a
     frame or two is the sampler. */
  check(split !== null && split <= 40,
    `the dice appear ${split}ms after the word does — the wait's die is still `
    + 'running its own grace instead of arriving with its label', out.waitReveal);
  check(entered.errs.length === 0,
    'page errors while revealing the shared wait', entered.errs);
}
