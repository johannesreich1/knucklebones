const WARD_APPROACH_MS = 640;
const WARD_RECOIL_MS = 1024;
const WARD_REBOUND_MS = 384;
const WARD_EASE = 'cubic-bezier(0.3,1.5,0.4,1)';

const compact = (value) => String(value).replace(/\s+/g, '');

/* Read one real opponent hit for its whole lifetime. Timings and keyframes come
   from the running WAAPI effects; positions come from painted page rectangles.
   This keeps W3's contract independent of private implementation state. */
export function inspectWardStrike(page, { side, col, who, at, ticks }) {
  return page.evaluate(async (spec) => {
    const WARD_APPROACH_MS = 640, WARD_RECOIL_MS = 1024, WARD_REBOUND_MS = 384;
    const compact = (value) => String(value).replace(/\s+/g, '');
    const k = window.__kb;
    const column = document.querySelector(`#${spec.side}Board .col[data-col="${spec.col}"]`);
    const chip = document.querySelectorAll(`#${spec.side}Cols .chip`)[spec.col];
    const clasp = column.querySelector('.smint .sv');
    const target = clasp.getBoundingClientRect();
    const targetCenter = { x: target.x + target.width / 2, y: target.y + target.height / 2 };
    const lit = () => {
      let best = 0;
      for (const node of column.querySelectorAll('.seal path,.seal circle')) {
        let parent = node, opacity = 1, shown = true;
        while (parent && parent !== column) {
          const style = getComputedStyle(parent);
          if (style.display === 'none' || style.visibility === 'hidden') { shown = false; break; }
          opacity *= +style.opacity;
          parent = parent.parentElement;
        }
        if (shown) best = Math.max(best, opacity);
      }
      return best;
    };
    let host = column;
    while (host?.classList.contains('sealmerged')) host = host.previousElementSibling;
    const describe = (animation) => {
      const duration = Number(animation.effect.getTiming().duration || 0);
      const frames = animation.effect.getKeyframes();
      const details = frames.map((frame) => {
        const matrix = new DOMMatrixReadOnly(String(frame.transform || 'none'));
        const properties = Object.keys(frame).filter((key) =>
          !['offset', 'computedOffset', 'easing', 'composite'].includes(key));
        return {
          time: Math.round(Number(frame.computedOffset ?? frame.offset) * duration),
          x: +matrix.m41.toFixed(2), y: +matrix.m42.toFixed(2),
          scale: +matrix.m11.toFixed(3),
          unit: Math.abs(matrix.m11 - 1) < .001 && Math.abs(matrix.m22 - 1) < .001
            && Math.abs(matrix.m12) < .001 && Math.abs(matrix.m21) < .001,
          opacity: frame.opacity === undefined ? null : +frame.opacity,
          filter: frame.filter === undefined ? null : compact(frame.filter),
          easing: compact(frame.easing), properties,
        };
      });
      return { duration, effectEasing: compact(animation.effect.getTiming().easing), frames: details };
    };
    const animations = new Set(), marks = new Set(), flare = new Set();
    const hostAnimations = new Set(), hostMarks = new Set();
    let approach = null, recoil = null, burn = null, unwind = null, source = null, sourceStart = null;
    let firstGhostAt = null, spentAt = null, goneAt = null, sourceVisible = true, sourceDrift = 0;
    let sourceAnchorError = Infinity, ghostValue = null, ghostOwner = null;
    let outlived = false, gone = false, particles = false, flash = false;
    const ghostFilters = new Set();
    let peakScale = 1, peakAt = null, fadedWhilePresent = false;
    const started = performance.now();
    void k.place(spec.who, spec.at);
    for (let index = 0; index < spec.ticks; index++) {
      await new Promise((resolve) => setTimeout(resolve, 40));
      const now = performance.now();
      for (const animation of column.getAnimations({ subtree: true })) {
        animations.add(animation.animationName);
        if (animation.animationName === 'sealunwind' && unwind === null) {
          unwind = animation.effect.getKeyframes().map((frame) =>
            parseFloat(String(frame.strokeDashoffset)));
        }
      }
      for (const animation of chip.getAnimations({ subtree: true })) animations.add(animation.animationName);
      for (const mark of column.classList) marks.add(mark);
      for (const animation of host.getAnimations({ subtree: true })) hostAnimations.add(animation.animationName);
      for (const mark of host.classList) hostMarks.add(mark);
      for (const node of chip.querySelectorAll('.sh,.wd'))
        for (const mark of node.classList) flare.add(`${node.classList[0]}:${mark}`);
      const spent = k.S.charm.wards[0][spec.col] === 0;
      if (spent && spentAt === null) spentAt = now;
      if (spent && lit() > .05) outlived = true;
      if (spent && lit() <= .05) gone = true;
      particles ||= !!document.querySelector('#fx .particle');
      flash ||= document.getElementById('flash').getAnimations().some((animation) => animation.playState === 'running');

      const ghost = document.querySelector('.ward-strike-ghost');
      if (ghost) {
        ghostFilters.add(compact(getComputedStyle(ghost).filter));
        if (firstGhostAt === null) firstGhostAt = now;
        ghostValue ??= ghost.dataset.v || null;
        ghostOwner ??= ghost.classList.contains('p1') ? 'p1'
          : ghost.classList.contains('p2') ? 'p2' : null;
        const sourceSide = k.sideKey(spec.who);
        source ??= document.querySelector(`#${sourceSide}Board .col[data-col="${spec.at}"] .die[data-v="${ghost.dataset.v}"]`);
        if (source) {
          const rect = source.getBoundingClientRect();
          sourceStart ??= { x: rect.x, y: rect.y, w: rect.width, h: rect.height };
          sourceVisible &&= getComputedStyle(source).visibility === 'visible' && +getComputedStyle(source).opacity > .95;
          /* The board's 300ms scale settle may still be finishing, but its seat
             must not travel when the W3 copy departs. Measure the painted
             centre, not the scale-changing top-left corner. */
          sourceDrift = Math.max(sourceDrift, Math.hypot(
            rect.x + rect.width / 2 - sourceStart.x - sourceStart.w / 2,
            rect.y + rect.height / 2 - sourceStart.y - sourceStart.h / 2));
          const anchorX = parseFloat(ghost.style.left) + parseFloat(ghost.style.width) / 2;
          const anchorY = parseFloat(ghost.style.top) + parseFloat(ghost.style.height) / 2;
          sourceAnchorError = Math.min(sourceAnchorError,
            Math.hypot(anchorX - rect.x - rect.width / 2, anchorY - rect.y - rect.height / 2));
        }
        /* Approach is fill-mode `both` and remains associated while recoil runs,
           so inspect every spell-motion effect instead of repeatedly finding
           the older finished one. */
        for (const animation of ghost.getAnimations().filter((item) => item.id === 'kb-spell-motion')) {
          const description = describe(animation);
          if (description.duration === WARD_APPROACH_MS) approach ??= description;
          if (description.duration === WARD_RECOIL_MS) recoil ??= description;
        }
      } else if (firstGhostAt !== null && goneAt === null) {
        goneAt = now;
      }

      const ward = chip.querySelector('.wd');
      const burnAnimation = ward?.getAnimations().find((animation) => animation.animationName === 'wdblock');
      if (burnAnimation) burn ??= describe(burnAnimation);
      if (spentAt !== null && ward?.firstElementChild) {
        const elapsed = now - spentAt;
        const matrix = new DOMMatrixReadOnly(getComputedStyle(ward).transform);
        if (matrix.m11 > peakScale) { peakScale = matrix.m11; peakAt = elapsed; }
        if (elapsed >= 700 && elapsed <= 900 && +getComputedStyle(ward).opacity <= .25)
          fadedWhilePresent = true;
      }
    }

    let contact = null;
    if (approach?.frames.length && sourceStart) {
      const last = approach.frames.at(-1);
      const sourceCenter = { x: sourceStart.x + sourceStart.w / 2, y: sourceStart.y + sourceStart.h / 2 };
      const dx = targetCenter.x - sourceCenter.x, dy = targetCenter.y - sourceCenter.y;
      const distance = Math.hypot(dx, dy), ux = dx / distance, uy = dy / distance;
      const contactCenter = { x: sourceCenter.x + last.x, y: sourceCenter.y + last.y };
      const remaining = { x: targetCenter.x - contactCenter.x, y: targetCenter.y - contactCenter.y };
      const half = (Math.abs(ux) * sourceStart.w + Math.abs(uy) * sourceStart.h) / 2;
      const rebound = recoil?.frames.find((frame) => frame.time === WARD_REBOUND_MS);
      contact = {
        axis: Math.abs(dx) > Math.abs(dy) ? 'x' : 'y',
        edgeGap: +(remaining.x * ux + remaining.y * uy - half).toFixed(2),
        crossError: +Math.abs(remaining.x * -uy + remaining.y * ux).toFixed(2),
        centerGap: +Math.hypot(remaining.x, remaining.y).toFixed(2),
        reboundRetreat: rebound
          ? +((last.x - rebound.x) * ux + (last.y - rebound.y) * uy).toFixed(2) : null,
        reboundProgress: rebound
          ? +((rebound.x * ux + rebound.y * uy) / (last.x * ux + last.y * uy)).toFixed(4) : null,
      };
    }
    const sourceAfter = source && getComputedStyle(source);
    return {
      anims: [...animations].sort(), marks: [...marks].sort(), flare: [...flare].sort(),
      hostAnims: [...hostAnimations].sort(), hostMarks: [...hostMarks].sort(),
      approach, recoil, burn, unwind, contact, ghostValue, ghostOwner,
      sawWardGhost: firstGhostAt !== null, ghostFilters: [...ghostFilters],
      approachElapsed: firstGhostAt !== null && spentAt !== null ? +(spentAt - firstGhostAt).toFixed(0) : null,
      recoilElapsed: spentAt !== null && goneAt !== null ? +(goneAt - spentAt).toFixed(0) : null,
      sourceVisible, sourceAfterVisible: !!sourceAfter && sourceAfter.visibility === 'visible' && +sourceAfter.opacity > .95,
      sourceDrift: +sourceDrift.toFixed(2),
      sourceAnchorError: Number.isFinite(sourceAnchorError) ? +sourceAnchorError.toFixed(2) : null,
      particles, flash, peakScale: +peakScale.toFixed(2), peakAt: peakAt === null ? null : +peakAt.toFixed(0),
      fadedWhilePresent, outlived, gone,
      wards: JSON.stringify(k.S.charm.wards), theirs: JSON.stringify(k.S.boards[0][spec.col]),
      elapsed: +(performance.now() - started).toFixed(0),
    };
  }, { side, col, who, at, ticks });
}

export function wardMotionMatchesW3(strike) {
  const clean = (motion) => !!motion && motion.effectEasing === 'linear'
    && motion.frames.every((frame) => frame.unit && frame.filter === null
      && frame.properties.every((property) => property === 'transform' || property === 'opacity'))
    && motion.frames.slice(0, -1).every((frame) => frame.easing === compact(WARD_EASE));
  return strike.approach?.duration === WARD_APPROACH_MS
    && strike.recoil?.duration === WARD_RECOIL_MS
    && strike.recoil.frames.some((frame) => frame.time === WARD_REBOUND_MS)
    && clean(strike.approach) && clean(strike.recoil)
    && strike.ghostFilters?.every((filter) => filter === 'none');
}

export async function inspectReducedWardStrike(page) {
  return page.evaluate(async () => {
    const k = window.__kb;
    let sawGhost = false, sawSnap = false, sawParticles = false, sawFlash = false, spentAt = null;
    const started = performance.now();
    const placement = k.place(1, 1);
    for (let index = 0; index < 320; index++) {
      await new Promise((resolve) => setTimeout(resolve, 10));
      if (k.S.charm.wards[0][1] === 0 && spentAt === null) spentAt = performance.now();
      sawGhost ||= !!document.querySelector('.ward-strike-ghost');
      sawSnap ||= !!document.querySelector('.sealsnap');
      sawParticles ||= !!document.querySelector('#fx .particle');
      sawFlash ||= document.getElementById('flash').getAnimations().some((animation) => animation.playState === 'running');
      if (spentAt !== null && k.S.phase === 'choose' && !k.S.busy) break;
    }
    await placement;
    const column = document.querySelector('#topBoard .col[data-col="1"]');
    const ward = document.querySelectorAll('#topCols .chip')[1].querySelector('.wd');
    const hint = getComputedStyle(column, '::after');
    return {
      elapsed: +(performance.now() - started).toFixed(0), spentAt: spentAt === null ? null : +(spentAt - started).toFixed(0),
      sawGhost, sawSnap, sawParticles, sawFlash,
      wards: JSON.stringify(k.S.charm.wards), warded: column.classList.contains('warded'),
      snap: column.classList.contains('sealsnap'), rune: !!ward.firstElementChild,
      legal: column.classList.contains('legal'), hint: hint.display !== 'none' && +hint.opacity > .05,
    };
  });
}
