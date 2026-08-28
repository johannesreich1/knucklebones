import { runRuneCardTreatmentScenarios } from './rune-card-treatments.mjs';
import { runTurnContextScenarios } from './turn-contexts.mjs';
import { runTurnHandoffScenarios } from './turn-handoff.mjs';

function createTurnPresentationProbes(page) {
  const rail = () => page.evaluate(() => {
    const root = document.getElementById('kbroot');
    const shown = [...document.querySelectorAll('#spellBar .rune:not([hidden])')]
      .filter((card) => !!card.offsetParent);
    const alphaOf = (colour) => {
      const match = colour.match(/^rgba?\((.*)\)$/);
      if (!match) return null;
      const slash = match[1].split('/');
      if (slash.length === 2) return Number.parseFloat(slash[1]);
      const values = match[1].split(/[\s,]+/).filter(Boolean);
      return values.length > 3 ? Number.parseFloat(values[3]) : 1;
    };
    const read = (card) => {
      const charge = card.querySelector('.rune-charge.top');
      const empty = [...card.querySelectorAll('.rune-empty')].find((item) => !item.hidden) ?? null;
      const back = charge?.querySelector('.rback');
      const icon = back?.querySelector('svg');
      const style = getComputedStyle(card);
      const matrix = style.transform === 'none'
        ? new DOMMatrixReadOnly() : new DOMMatrixReadOnly(style.transform);
      const rect = card.getBoundingClientRect();
      const relative = (element) => {
        if (!element) return null;
        const inner = element.getBoundingClientRect();
        return { x: (inner.left - rect.left) / rect.width, y: (inner.top - rect.top) / rect.height,
          width: inner.width / rect.width, height: inner.height / rect.height };
      };
      const shadow = charge ? getComputedStyle(charge, '::after') : null;
      const matte = empty ? getComputedStyle(empty) : null;
      return {
        seat: card.dataset.seat, spell: card.dataset.spell, probe: card.dataset.handoffProbe ?? null,
        active: card.classList.contains('hand-active'),
        standby: card.classList.contains('hand-standby'),
        spentBack: card.classList.contains('hand-spent-back'),
        liveFront: card.classList.contains('hand-live-front'),
        disabled: card.disabled, offturn: card.classList.contains('offturn'),
        unavailable: card.classList.contains('unavailable'),
        opacity: Number(style.opacity), filter: style.filter, transform: style.transform,
        transitionProperty: style.transitionProperty, transitionDuration: style.transitionDuration,
        scale: Math.hypot(matrix.a, matrix.b), z: style.zIndex,
        card: { cx: rect.left + rect.width / 2, cy: rect.top + rect.height / 2,
          width: rect.width, height: rect.height },
        charge: relative(charge), icon: relative(icon),
        cards: [...card.querySelectorAll('.rune-charge')].filter((element) => !element.hidden).length,
        outlines: [...card.querySelectorAll('.rune-empty')].filter((element) => !element.hidden).length,
        buttonMark: getComputedStyle(card, '::before').content,
        ownerShadow: shadow ? { content: shadow.content, opacity: Number(shadow.opacity),
          boxShadow: shadow.boxShadow, duration: shadow.transitionDuration } : null,
        matte: matte ? { opacity: Number(matte.opacity), background: matte.backgroundColor,
          backgroundAlpha: alphaOf(matte.backgroundColor), image: matte.backgroundImage,
          size: matte.backgroundSize } : null,
        wash: back ? getComputedStyle(back, '::before').backgroundImage : 'none',
      };
    };
    const cards = shown.map(read);
    return {
      paired: document.getElementById('spellBar').classList.contains('paired'),
      opponentTurn: root.classList.contains('opponent-turn'), count: cards.length, cards,
      active: cards.find((card) => card.active) ?? null,
      standby: cards.find((card) => card.standby) ?? null,
      bySeat: Object.fromEntries(cards.map((card) => [card.seat, card])),
    };
  });
  const turnTo = async (turn) => {
    await page.evaluate((next) => {
      const k = window.__kb;
      k.S.mode = 'cpu'; k.S.turn = next; k.S.bottom = 1; k.S.busy = false;
      k.S.boards = [[[3], [], []], [[4], [], []]];
      k.S.phase = next === 1 ? 'choose' : 'anim'; k.S.die = 3;
      k.applySides(); k.setActivePlate(); k.spells.render();
    }, turn);
    /* WAIT FOR THE SWAP TO LAND, do not guess at it. This was a flat 320ms
       against a .25s transition (styles/game/spells.css:11) — 70ms of slack,
       which a loaded machine eats. The probe then caught a card mid-tween and
       read one CSS rule half-applied: hand-standby's opacity and filter live
       but its transform still near identity, reported as "the active CPU card
       looked disabled". Measured on 2026-08-28: the same build passed and
       failed in the same minute. Ask the browser when its animations are
       actually finished instead. */
    await page.evaluate(async () => {
      const cards = () => [...document.querySelectorAll('#spellBar .rune:not([hidden])')];
      /* two frames: one for the class change to commit, one for the
         transitions it starts to exist and be reported as running */
      await new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r)));
      const deadline = performance.now() + 2000;
      while (performance.now() < deadline) {
        const running = cards().flatMap((el) => el.getAnimations())
          .filter((a) => a.playState === 'running');
        if (!running.length) return;
        /* allSettled: a transition replaced mid-flight REJECTS its finished
           promise, and that is a normal outcome here, not a failure */
        await Promise.race([
          Promise.allSettled(running.map((a) => a.finished)),
          new Promise((r) => setTimeout(r, 120)),
        ]);
      }
    });
  };
  return { rail, turnTo };
}

export async function runTurnPresentationScenarios(suite) {
  const scoped = { ...suite, ...createTurnPresentationProbes(suite.page) };
  await runTurnHandoffScenarios(scoped);
  await runRuneCardTreatmentScenarios(scoped);
  await runTurnContextScenarios(scoped);
}
