// LOSING BY FORFEIT IS STILL A RESULT, AND BEING PLAYED FOR IS STILL A WARNING.
//
// Two surfaces that used to say nothing:
//
//   · The result screen stamped only the FOE, and only on a win. The player who
//     forfeited — by quitting, or by letting the away allowance run out — read
//     a bare scoreline that could not tell them which defeat this was. Their
//     own plate now carries FORFEITED; the winner's screen is unchanged.
//   · The away warning is the last turn auto play will cover. It wears the
//     player's own --p1 (user call, once the card went full-screen): it is the
//     player's own moment, and --p1 is what means "you" on the plate, the
//     scoreline and the active row. --orange stays with the clock that is
//     actually running out underneath. It used to borrow the heat
//     must be a warning rather than a gate: it may not touch input state, and a
//     tap dismisses it without placing anything.
//
// These pin PRESENTATION, in painted pixels and resolved colour. What triggers
// them is pinned elsewhere and deliberately: the streak that opens the warning
// by tests/edge-auto-forfeit.test.ts and supabase/tests/database, and the
// clock that arms the request by tests/online-watchdog.test.ts.
import { RESOURCES } from '../../../../src/i18n/catalogs.ts';

const COPY = RESOURCES.en.online;

const base = {
  draw: false,
  my: 22,
  their: 31,
  delta: -18,
  opp: 'NovaComet992',
  oppAvatar: 'die:3:mg',
  oppRating: 1072,
};
const LOST_TO_FORFEIT = { ...base, won: false, forfeit: true };
const LOST_ON_SCORE = { ...base, won: false, forfeit: false };
const WON_BY_FORFEIT = { ...base, won: true, forfeit: true, my: 31, their: 22, delta: 21 };

/* A stamp the player cannot see is the bug this suite exists for, so read the
   painted box and hit test it rather than trusting the DOM node's presence. */
const READ_PLATES = () => {
  const read = (plate) => {
    const stamp = plate?.querySelector('.pstamp');
    if (!stamp) return null;
    const rect = stamp.getBoundingClientRect();
    const style = getComputedStyle(stamp);
    const hit = document.elementFromPoint(
      rect.left + rect.width / 2, rect.top + rect.height / 2,
    );
    return {
      text: (stamp.textContent || '').trim(),
      width: Math.round(rect.width),
      height: Math.round(rect.height),
      visibility: style.visibility,
      opacity: Number(style.opacity),
      inPlate: !!hit && plate.contains(hit),
    };
  };
  const plates = [...document.querySelectorAll('#endPlates > *')];
  return { mine: read(plates[0]), theirs: read(plates[1]) };
};

function resultProbe(report) {
  return async (page) => {
    await page.evaluate((payload) => {
      window.__kb.S.played = true;
      window.__kbResult(payload);
    }, report);
    await page.waitForSelector('#ovEnd.on', { timeout: 15000 });
    // the plates deal in turn and the stamp slams after them
    await page.waitForTimeout(2000);
    return page.evaluate(READ_PLATES);
  };
}

async function awayWarningProbe(page) {
  return page.evaluate(() => {
    const overlay = document.getElementById('ovAway');
    const busyBefore = window.__kb.S.busy;
    /* Stand the in-match stacking up honestly. Every .ov shares one z-index, so
       DOM order decides, and #ovAway sits above the board but below the panels
       that enterMatch closes on the way in. Leaving the account panel open
       would test a state the warning never appears in. */
    for (const other of document.querySelectorAll('.ov.on')) other.classList.remove('on');
    overlay.classList.add('on');
    const title = overlay.querySelector('.who');
    /* Resolve --orange through the same element rather than parsing the token
       text, so this compares the colour actually painted. */
    const swatch = document.createElement('span');
    swatch.style.color = 'var(--p1)';
    title.appendChild(swatch);
    const expected = getComputedStyle(swatch).color;
    swatch.remove();
    const rect = overlay.getBoundingClientRect();
    const hit = document.elementFromPoint(
      rect.left + rect.width / 2, rect.top + rect.height / 2,
    );
    return {
      busyBefore,
      busyWhileShown: window.__kb.S.busy,
      titleColor: getComputedStyle(title).color,
      /* The glyph is one of ours, not whichever hourglass the platform ships.

         An emoji here wears a colour and a weight the app never chose, beside

         icons that are all one stroke language — and it cannot take the

         player's colour, because it is not drawn on currentColor. */

      icon: (() => {

        const box = document.querySelector('#ovAway .awayicon');

        const svg = box?.querySelector('svg');

        return {

          svg: !!svg,

          stroke: svg ? getComputedStyle(svg).stroke : null,

          text: (box?.textContent ?? '').trim(),

          drawn: (svg?.querySelectorAll('path').length ?? 0),

        };

      })(),
      expectedColor: expected,
      title: (title.textContent || '').trim(),
      body: (overlay.querySelector('.hint').textContent || '').trim(),
      ownsHit: !!hit && overlay.contains(hit),
      width: Math.round(rect.width),
      height: Math.round(rect.height),
      // the clock lane must survive underneath: the next expiry is the loss
      clockPresent: !!document.getElementById('timerWrap'),
    };
  });
}

export async function runAwayForfeitScenarios({ visit, out, check }) {
  const lost = await visit({ named: true, skipStandardProbes: true, probe: resultProbe(LOST_TO_FORFEIT) });
  out.forfeitLossPlates = lost.probeResult;
  const mine = lost.probeResult?.mine;
  check(mine?.text === COPY.result.forfeitedStamp,
    'the player who forfeited was not told so on their own plate', lost.probeResult);
  check(!!mine && mine.width > 0 && mine.height > 0
    && mine.visibility === 'visible' && mine.opacity > 0 && mine.inPlate,
  'the FORFEITED stamp is in the DOM but not painted where the player looks', mine);
  check(lost.probeResult?.theirs === null,
    'the loser\'s screen also stamped the winner', lost.probeResult);

  const outrolled = await visit({ named: true, skipStandardProbes: true, probe: resultProbe(LOST_ON_SCORE) });
  out.scoreLossPlates = outrolled.probeResult;
  check(outrolled.probeResult?.mine === null && outrolled.probeResult?.theirs === null,
    'an ordinary defeat was stamped as if the player had left', outrolled.probeResult);

  const won = await visit({ named: true, skipStandardProbes: true, probe: resultProbe(WON_BY_FORFEIT) });
  out.forfeitWinPlates = won.probeResult;
  check(won.probeResult?.theirs?.text === COPY.result.forfeitStamp,
    'the winner stopped seeing the opponent stamped as forfeited', won.probeResult);
  check(won.probeResult?.mine === null,
    'the winner\'s own plate was stamped too', won.probeResult);

  const warning = await visit({ named: true, skipStandardProbes: true, probe: awayWarningProbe });
  out.awayWarning = warning.probeResult;
  const seen = warning.probeResult;
  check(seen?.title === COPY.play.awayWarnTitle && seen?.body === COPY.play.awayWarnBody,
    'the away warning did not render its localized copy', seen);
  check(!!seen?.icon?.svg && seen.icon.drawn >= 3 && seen.icon.text === '',
    'the away card is not wearing one of our own stroke icons', seen?.icon);
  check(seen?.icon?.stroke === seen?.expectedColor,
    'the away icon does not take the player\u2019s colour through currentColor', seen?.icon);
  check(!!seen && seen.titleColor === seen.expectedColor,
    'the away warning is not wearing the player\u2019s own colour', seen);
  check(!!seen && seen.ownsHit && seen.width > 0 && seen.height > 0,
    'the away warning is not on top of the board where a tap can reach it', seen);
  check(!!seen && seen.busyWhileShown === seen.busyBefore && seen.clockPresent,
    'the away warning gated input or removed the clock instead of only warning', seen);
}
