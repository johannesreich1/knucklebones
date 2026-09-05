/* WHAT THE MATCHMAKING PANEL LOOKS LIKE — the label, the roll, and whether the
   die actually rides its floor. Split out of visit.mjs (2026-09-05) when the
   floor sweep pushed that file past its budget: driving a visit and reading a
   panel are two jobs, and this is the one that knows what the queue is
   supposed to look like. */

/** Read the queue panel: four label/animation samples, the floor sweep, and
 *  the cancel action's own readout. Leaves the panel's animations PAUSED. */
export async function probeQueuePanel(page) {
  const samples = [];
  for (let i = 0; i < 4; i++) {
    samples.push(await page.evaluate(() => {
      const message = document.querySelector('#onQueue .qmsg');
      const roll = document.querySelector('#onQueue .qroll');
      const turn = document.querySelector('#onQueue .qturn');
      const pseudo = getComputedStyle(message, '::after');
      /* READ THE KEYFRAMES, not just the name. The point of this roll is
         that the spin UNWINDS on the return leg — 0 -> 360 -> 0 — so the
         die turns the way it is travelling and arrives on the angle it
         left from. A name alone would still pass if someone restored the
         one-way 0 -> 360 -> 720 spin, which skids on the way back. */
      const turnFrames = (() => {
        for (const sheet of document.styleSheets) {
          let rules;
          try { rules = sheet.cssRules; } catch { continue; }
          for (const rule of rules ?? []) {
            if (rule.type !== CSSRule.KEYFRAMES_RULE || rule.name !== 'qturn') continue;
            return [...rule.cssRules].map((frame) => ({
              at: frame.keyText,
              transform: frame.style.transform,
            }));
          }
        }
        return null;
      })();
      return {
        label: message?.textContent?.trim() ?? null,
        pseudoContent: pseudo.content,
        labelAnimation: pseudo.animationName,
        dieAnimation: turn ? getComputedStyle(turn).animationName : null,
        rollAnimation: roll ? getComputedStyle(roll).animationName : null,
        splitHalves: document.querySelectorAll('#onQueue .qdice .splitmark .die').length,
        turnFrames,
      };
    }));
    if (i < 3) await page.waitForTimeout(350);
  }
  /* DOES IT ROLL ON THE LINE? Step a whole revolution and compare the die's
     lowest pixel with the floor at each angle. A die rolling on a floor
     touches it at EVERY instant — so both numbers below are 0, and either
     sign is a real defect: sink means it passes through the floor, float
     means it is a spinning sprite sliding above one. Two shipped-looking
     mistakes produce exactly this and nothing else: an eased lift (the arc
     is a sine, and an ease is still flat where the arc has already climbed
     half its height) and a mark whose size drifted from its box. Runs last
     because it leaves the animations paused. */
  const queueFloor = await page.evaluate(() => {
    const tray = document.querySelector('#onQueue .qdice');
    if (!tray) return null;
    const anims = [...document.querySelectorAll('#onQueue .qroll,#onQueue .qhop,#onQueue .qturn')]
      .flatMap((el) => el.getAnimations());
    if (!anims.length) return null;
    anims.forEach((a) => { a.effect.updateTiming({ delay: 0 }); a.pause(); });
    const faces = [...document.querySelectorAll('#onQueue .qturn .half, #onQueue .qturn .sdplate')];
    if (!faces.length) return null;
    const cycle = 2900;
    let sink = 0, float = 0;
    for (let deg = 0; deg <= 360; deg += 15) {
      const t = (deg / 360) * (cycle / 2);
      anims.forEach((a) => { a.currentTime = t; });
      const floor = tray.getBoundingClientRect().bottom;
      const low = Math.max(...faces.map((el) => el.getBoundingClientRect().bottom));
      const dev = low - floor;
      if (dev > sink) sink = dev;
      if (dev < float) float = dev;
    }
    return { maxSink: +sink.toFixed(2), maxFloat: +float.toFixed(2) };
  });
  const queueCancel = await page.evaluate(() => {
    const button = document.getElementById('btnQueueCancel');
    const style = button ? getComputedStyle(button) : null;
    return {
      label: button?.textContent?.trim() ?? null,
      textTransform: style?.textTransform ?? null,
      clipped: button ? button.scrollWidth > button.clientWidth : null,
    };
  });
  return { samples, queueFloor, queueCancel };
}
