/* PI5 — The snatch. These are computed-pixel contracts for its armed grip,
   bounded 0/1/2 resistance beats, straight flight and die-only landing — and
   the readings of the screen those contracts are measured against.
   ./pilfer-effects.mjs drives the situations and owns the assertion
   sentences; this file owns what the page is asked, and the numbers the
   answers have to match. */
export const FLIGHT_EASING = 'cubic-bezier(0.7,0,0.2,1)';
export const STRAIN_EASING = 'cubic-bezier(0.5,0,0.3,1)';
export const LANDING_EASING = 'cubic-bezier(0.2,1.7,0.4,1)';
export const PI5_DEPTH = {
  1: { flight: 480, along: [0], times: [0, 480], strainTimes: [], strainScales: [] },
  2: {
    flight: 1504, along: [0, 10, -3, 13, 4],
    times: [0, 288, 544, 800, 1024, 1504],
    strainTimes: [0, 800, 1024, 1184, 1440, 1760],
    strainScales: [1, 1.045, 1.02, .975, 1.01, 1],
  },
  3: {
    flight: 2016, along: [0, 10, -3, 13, 4, 13, 4],
    times: [0, 288, 544, 800, 1024, 1312, 1536, 2016],
    strainTimes: [0, 800, 1024, 1184, 1312, 1536, 1696, 1952, 2272],
    strainScales: [1, 1.045, 1.02, .975, 1.045, 1.02, .975, 1.01, 1],
  },
};
export const sameNumbers = (actual, expected, tolerance = .02) => actual.length === expected.length
  && actual.every((value, index) => Math.abs(value - expected[index]) <= tolerance);

/* Browser callbacks stay closure-free so Playwright can serialize them: each
   reader below hands its probe to page.evaluate by reference, never through an
   arrow that would capture this module's scope. */
function pilferGripProbe() {
  const previews = [...document.querySelectorAll('#topBoard .pilferpreview')];
  const preview = previews[0];
  const destination = document.querySelector('#botBoard')?.getBoundingClientRect();
  const rect = preview?.getBoundingClientRect();
  const animations = preview?.getAnimations({ subtree: true }) || [];
  const grip = animations.find((animation) => animation.animationName === 'pilfer-preview-grip');
  const lean = preview?.getAnimations()
    .find((animation) => animation.animationName === 'pilfer-preview-lean');
  const middle = lean?.effect?.getKeyframes?.()
    .find((frame) => Math.abs(Number(frame.computedOffset ?? frame.offset) - .5) < .001);
  const matrix = new DOMMatrixReadOnly(String(middle?.transform || 'none'));
  const toward = rect && destination ? {
    x: destination.x + destination.width / 2 - (rect.x + rect.width / 2),
    y: destination.y + destination.height / 2 - (rect.y + rect.height / 2),
  } : { x: 0, y: 0 };
  const dieStyle = preview ? getComputedStyle(preview) : null;
  const after = preview ? getComputedStyle(preview, '::after') : null;
  const gripAttached = (grip?.effect?.getKeyframes?.() || []).every((frame) => {
    const gripMatrix = new DOMMatrixReadOnly(String(frame.transform || 'none'));
    return Math.abs(gripMatrix.m41) < .01 && Math.abs(gripMatrix.m42) < .01;
  });
  const land = document.getElementById('kbroot').classList.contains('land');
  return {
    land, count: previews.length, value: +(preview?.dataset.v || 0),
    exactTop: +(preview?.dataset.v || 0) === window.__kb.S.boards[0][0].at(-1),
    gripAnimation: !!grip, leanAnimation: !!lean, animations: animations.length,
    gripVector: [matrix.m41, matrix.m42],
    gripAttached,
    centreDot: matrix.m41 * toward.x + matrix.m42 * toward.y,
    centreAxis: land ? Math.abs(matrix.m41) > Math.abs(matrix.m42)
      : Math.abs(matrix.m42) > Math.abs(matrix.m41),
    openOuterEdge: land ? after?.borderLeftWidth === '0px' && after?.borderRightWidth !== '0px'
      : after?.borderTopWidth === '0px' && after?.borderBottomWidth !== '0px',
    outlineFlush: !!after && !!dieStyle
      && [after.top, after.right, after.bottom, after.left].every((inset) => inset === '0px')
      && after.borderRadius === dieStyle.borderRadius,
    outlineInsets: after ? [after.top, after.right, after.bottom, after.left] : [],
    outlineRadius: after?.borderRadius, dieRadius: dieStyle?.borderRadius,
    sourceVisible: preview ? getComputedStyle(preview).visibility === 'visible' : false,
    gripContent: after?.content, gripOpacity: +(after?.opacity || 0), gripTransform: after?.transform,
  };
}

export function readPilferGrip(page) {
  return page.evaluate(pilferGripProbe);
}

async function pilferFlightProbe(advance) {
  const compact = (value) => String(value).replace(/\s+/g, '');
  const rounded = (value) => Math.round(value * 1000) / 1000;
  const offsetOf = (frame) => Number(frame.computedOffset ?? frame.offset);
  const column = document.querySelector('#topBoard .col[data-col="0"]');
  const ghost = document.querySelector('.pilfer-ghost');
  const blockers = [...column.querySelectorAll('.pilfer-blocker')];
  const room = document.querySelector('.pilfer-room');
  const animation = ghost?.getAnimations().find((item) => item.id === 'kb-spell-motion');
  const strain = column?.getAnimations().find((item) => item.id === 'kb-spell-motion');
  const duration = Number(animation?.effect?.getTiming().duration || 0);
  const frames = animation?.effect?.getKeyframes?.() || [];
  const vectors = frames.map((frame) => {
    const matrix = new DOMMatrixReadOnly(String(frame.transform || 'none'));
    return { x: matrix.m41, y: matrix.m42 };
  });
  const target = vectors.at(-1) || { x: 0, y: 1 };
  const distance = Math.hypot(target.x, target.y) || 1;
  const unit = { x: target.x / distance, y: target.y / distance };
  const horizontal = Math.abs(target.x) > Math.abs(target.y);
  const strainFrames = strain?.effect?.getKeyframes?.() || [];
  const strainDuration = Number(strain?.effect?.getTiming().duration || 0);
  animation?.pause(); strain?.pause();
  if (animation) animation.currentTime = 0;
  if (strain) strain.currentTime = 0;
  await new Promise(requestAnimationFrame);
  if (advance) {
    for (const item of [animation, strain]) {
      if (!item) continue;
      item.currentTime = Math.max(0, Number(item.effect?.getComputedTiming().endTime || 0) - 36);
      item.play();
    }
  }
  return {
    land: document.getElementById('kbroot').classList.contains('land'),
    declared: +(column.dataset.pilferCollisions || -1), blockers: blockers.length,
    blockerAnimations: blockers.flatMap((die) => die.getAnimations())
      .filter((item) => item.id === 'kb-spell-motion').length,
    columnAnimations: strain ? 1 : 0,
    flightDuration: duration, flightTimes: frames.map((frame) => rounded(offsetOf(frame) * duration)),
    flightAlong: vectors.map((point) => rounded(point.x * unit.x + point.y * unit.y)),
    flightAcross: vectors.map((point) => rounded(point.x * -unit.y + point.y * unit.x)),
    vertical: vectors.map((point) => rounded(point.y)), targetDistance: rounded(distance),
    horizontal: Math.abs(target.x) > 100 && Math.abs(target.y) < .5,
    flightEffectEasing: compact(animation?.effect?.getTiming().easing),
    flightFrameEasings: frames.map((frame) => compact(frame.easing)),
    strainTimes: strainFrames.map((frame) => rounded(offsetOf(frame) * strainDuration)),
    strainScales: strainFrames.map((frame) => {
      const matrix = new DOMMatrixReadOnly(String(frame.transform || 'none'));
      return rounded(horizontal ? matrix.m11 : matrix.m22);
    }),
    strainEffectEasing: compact(strain?.effect?.getTiming().easing),
    strainFrameEasings: strainFrames.map((frame) => compact(frame.easing)),
    releaseLines: document.querySelectorAll('.pilfer-release-snap').length,
    ghost: !!ghost, enemyColour: ghost?.classList.contains('p2') && !ghost.classList.contains('p1'),
    hiddenValues: [...column.querySelectorAll('.slot .die')]
      .filter((die) => getComputedStyle(die).visibility === 'hidden').map((die) => +die.dataset.v),
    roomCount: document.querySelectorAll('.pilfer-room').length,
    roomCorrect: !!room && room.matches('#botBoard .col[data-col="0"] .slot')
      && !room.firstElementChild && getComputedStyle(room).boxShadow !== 'none',
    state: [JSON.stringify(window.__kb.S.boards[1][0]),
      JSON.stringify(window.__kb.S.boards[0][0])].join('/'),
    particles: document.querySelectorAll('.particle').length,
    boardShake: document.getElementById('app').getAnimations()
      .some((item) => item.playState === 'running'),
  };
}

/* `advance` decides what the probe leaves behind: without it the flight and
   the column strain stay paused at frame 0 (the landscape read only measures
   them), with it both resume 36ms before their end so the cast still reaches
   its arrival beat. */
export function readPilferFlight(page, advance) {
  return page.evaluate(pilferFlightProbe, advance);
}

function pilferLandingProbe() {
  const die = document.querySelector('#botBoard .col[data-col="0"] .pilfer-soft-settle');
  const animation = die?.getAnimations().find((item) => item.id === 'kb-spell-motion');
  const frames = animation?.effect?.getKeyframes?.() || [];
  const duration = Number(animation?.effect?.getTiming().duration || 0);
  if (animation) { animation.currentTime = Math.max(0, duration - 36); animation.play(); }
  const compact = (value) => String(value).replace(/\s+/g, '');
  const offsetOf = (frame) => Number(frame.computedOffset ?? frame.offset);
  return {
    mine: JSON.stringify(window.__kb.S.boards[1][0]),
    theirs: JSON.stringify(window.__kb.S.boards[0][0]), settling: !!animation, duration,
    times: frames.map((frame) => Math.round(offsetOf(frame) * duration)),
    scales: frames.map((frame) => Math.round(new DOMMatrixReadOnly(
      String(frame.transform || 'none')).m11 * 1000) / 1000),
    effectEasing: compact(animation?.effect?.getTiming().easing),
    frameEasings: frames.map((frame) => compact(frame.easing)),
    transform: die ? getComputedStyle(die).transform : 'none',
    particles: document.querySelectorAll('.particle').length,
    flash: document.getElementById('flash').getAnimations().length,
    boardShake: document.getElementById('app').getAnimations().length,
  };
}

export function readPilferLanding(page) {
  return page.evaluate(pilferLandingProbe);
}

function pilferTargetsProbe() {
  const state = window.__kb.S;
  return [...document.querySelectorAll('#topBoard .pilferpreview')].map((die) => {
    const column = +(die.closest('.col')?.dataset.col || -1);
    const lean = die.getAnimations().find((item) => item.animationName === 'pilfer-preview-lean');
    const grip = die.getAnimations({ subtree: true })
      .find((item) => item.animationName === 'pilfer-preview-grip');
    const leanFrames = lean?.effect?.getKeyframes?.() || [];
    const gripFrames = grip?.effect?.getKeyframes?.() || [];
    const middle = leanFrames
      .find((frame) => Math.abs(Number(frame.computedOffset ?? frame.offset) - .5) < .001);
    const matrix = new DOMMatrixReadOnly(String(middle?.transform || 'none'));
    const after = getComputedStyle(die, '::after');
    const style = getComputedStyle(die);
    return {
      column,
      value: +die.dataset.v,
      exactTop: +die.dataset.v === state.boards[0][column].at(-1),
      leanDuration: Number(lean?.effect?.getTiming().duration || 0),
      leanEffectEasing: lean?.effect?.getTiming().easing,
      leanFrameEasings: leanFrames.map((frame) => frame.easing),
      towardY: matrix.m42,
      rotation: Math.atan2(matrix.m12, matrix.m11) * 180 / Math.PI,
      gripDuration: Number(grip?.effect?.getTiming().duration || 0),
      gripEffectEasing: grip?.effect?.getTiming().easing,
      gripFrameEasings: gripFrames.map((frame) => frame.easing),
      gripAttached: gripFrames.every((frame) => {
        const gripMatrix = new DOMMatrixReadOnly(String(frame.transform || 'none'));
        return Math.abs(gripMatrix.m41) < .01 && Math.abs(gripMatrix.m42) < .01;
      }),
      outlineFlush: [after.top, after.right, after.bottom, after.left]
        .every((inset) => inset === '0px') && after.borderRadius === style.borderRadius,
    };
  });
}

export function readPilferTargets(page) {
  return page.evaluate(pilferTargetsProbe);
}

/* One reading of "is anything PI5 painted still on the table", for all three
   places that ask it. The counts stay granular because those three questions
   are not the same question: the post-arrival and reduced-motion sweeps demand
   every transient gone, while the interrupted sweep has never counted
   .pilfer-soft-settle. Only the interrupted cast still has a source die to
   look at — after a height-1 steal that column is empty — so that reading is
   null-safe rather than throwing inside the page. */
function pilferResidueProbe() {
  const count = (selector) => document.querySelectorAll(selector).length;
  const source = document.querySelector('#topBoard .col[data-col="0"] .die');
  return {
    ghosts: count('.pilfer-ghost'),
    straining: count('.pilfer-straining'),
    blockers: count('.pilfer-blocker'),
    settles: count('.pilfer-soft-settle'),
    rooms: count('.pilfer-room'),
    grips: count('.pilferpreview'),
    transients: count('.pilferpreview,.pilfer-ghost,.pilfer-straining,'
      + '.pilfer-blocker,.pilfer-soft-settle,.pilfer-room'),
    hidden: [...document.querySelectorAll('#topBoard .die,#botBoard .die')]
      .filter((die) => getComputedStyle(die).visibility === 'hidden').length,
    sourceVisibility: source ? getComputedStyle(source).visibility : null,
    mine: JSON.stringify(window.__kb.S.boards[1][0]),
    theirs: JSON.stringify(window.__kb.S.boards[0][0]),
  };
}

export function readPilferResidue(page) {
  return page.evaluate(pilferResidueProbe);
}
