/* A WIDENED STRIKE IS ONE EVENT, not three ordinary column destructions in
   sequence. Its own arrangement, its own 160-tick observation, and the two
   checks that pin the global stagger against the authoritative board and Ward
   outcome — separate from the single-column warning-to-collapse life that
   sunder-overload.mjs keeps. */
export async function runSunderWidenedScenarios(suite) {
  const { page, out, check, newGame, waitChoose, table, guard } = suite;

  /* A widened strike is one event, not three ordinary column destructions in
     sequence. Every unprotected victim starts the same globally staggered
     collapse before any board repaint can remove another column's warning. */
  await newGame({ spell: 'sunder' });
  check(await waitChoose(), 'game never reached choose (SU6 widened collapse)');
  await table([[], [], []], [[4, 4], [4, 2], [1, 4]], 4);
  await guard(1, 0);
  await page.evaluate(() => window.__kb.spells.cast('sunder', -1));
  out.sunderWideRelease = await page.evaluate(async () => {
    const k = window.__kb;
    const targets = [...document.querySelectorAll('.die.sunder-doomed')];
    const warningTransforms = targets.map((die) => getComputedStyle(die).transform);
    const animated = targets.map(() => false);
    const visiblyChanged = targets.map(() => false);
    let firstCollapse = null, maxCollapse = 0, delays = null, returnDelays = null;
    const placement = k.place(1, 0);
    for (let i = 0; i < 160; i++) {
      await new Promise((resolve) => setTimeout(resolve, 20));
      const collapsing = [...document.querySelectorAll('.die.sunder-collapse')];
      if (collapsing.length && firstCollapse === null) firstCollapse = collapsing.length;
      maxCollapse = Math.max(maxCollapse, collapsing.length);
      if (!delays && collapsing.length === 3) delays = collapsing.map((die) =>
        die.getAnimations().find((animation) => animation.animationName === 'su6fail')
          ?.effect?.getTiming().delay ?? -1);
      if (!returnDelays && collapsing.length === 3) {
        returnDelays = [...document.querySelectorAll('.sunder-returning-slot')].map((slot) =>
          Math.round(slot.getAnimations()
            .find((animation) => animation.transitionProperty === 'background-color')
            ?.effect?.getTiming().delay ?? -1));
      }
      targets.forEach((die, index) => {
        const collapsingNow = die.getAnimations().some((a) => a.animationName === 'su6fail');
        animated[index] ||= collapsingNow;
        const style = getComputedStyle(die);
        visiblyChanged[index] ||= collapsingNow
          && (style.transform !== warningTransforms[index] || Number(style.opacity) < .98);
      });
    }
    await placement;
    return {
      targets: targets.length, firstCollapse, maxCollapse, animated, visiblyChanged, delays, returnDelays,
      theirs: JSON.stringify(k.S.boards[0]),
      wards: JSON.stringify(k.S.charm.wards),
      residue: document.querySelectorAll('.sunder-doomed,.sunder-doomed-slot,.sunder-returning-slot,.sunder-collapse,.sunder-embers').length,
    };
  });
  check(out.sunderWideRelease.targets === 3 && out.sunderWideRelease.firstCollapse === 3
      && out.sunderWideRelease.maxCollapse === 3
      && out.sunderWideRelease.animated.every(Boolean)
      && out.sunderWideRelease.visiblyChanged.every(Boolean)
      && String(out.sunderWideRelease.delays?.sort((a, b) => a - b)) === '0,160,320'
      && String(out.sunderWideRelease.returnDelays?.sort((a, b) => a - b)) === '1900,2060,2220',
    'SU6 did not animate every widened victim as one visible staggered collapse', out.sunderWideRelease);
  check(out.sunderWideRelease.theirs === '[[],[4,2],[1]]'
      && JSON.parse(out.sunderWideRelease.wards)[0][1] === 0
      && out.sunderWideRelease.residue === 0,
    'SU6 widened collapse disagreed with its authoritative outcomes or leaked presentation', out.sunderWideRelease);
}
