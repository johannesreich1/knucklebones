/* THE RESERVED STATUS LANE: which localized strings have to fit it, and what
 * fitting means.
 *
 * Gameplay reserves a fixed lane for the live status line — 104x26 and at most
 * two lines in landscape, a single unwrapped line in portrait — so a long
 * translation there does not push the board. Both readings of that rule live
 * here — the resting snapshot's own status box, and every candidate string
 * written into the lane and measured — so the two cannot drift apart.
 *
 * The catalogue is every string the lane can actually hold: the uncompacted
 * game statuses (a `<key>Compact` sibling means the compact form is the one
 * that ships in the lane), each registered rune's aim copy, and the online play
 * lines — sampled with the same placeholder values production would fill in.
 */
import { SPELLS } from '../../../../src/core/spells.ts';
import { RESOURCES } from '../../../../src/i18n/catalogs.ts';

const interpolateSample = (copy, player) => copy.replace(/\{\{([^}]+)\}\}/gu, (_match, name) => ({
  column: '3',
  player,
  spell: 'COLUMN SHIELD',
  opponent: 'NovaComet992',
  count: '12',
  formatted: '12',
}[name] ?? '12'));
const statusCopies = (locale) => {
  const game = RESOURCES[locale].game;
  const online = RESOURCES[locale].online;
  return [
    ...Object.entries(game.status).flatMap(([key, copy]) =>
      typeof copy === 'string' && !(`${key}Compact` in game.status)
        ? [[`game.status.${key}`, copy]] : []),
    ...SPELLS.map(({ id }) => {
      const copy = game.runes[id];
      return [`game.runes.${id}.aim`, 'aimCompact' in copy ? copy.aimCompact : copy.aim];
    }),
    ...['reconnectingCompact', 'opponentThinking', 'yourMove', 'awayAutoPlay_one',
      'awayAutoPlay_other', 'autoPlay'].flatMap((key) =>
      key.startsWith('awayAutoPlay') ? [] :
      typeof online.play[key] === 'string' ? [[`online.play.${key}`, online.play[key]]] : []),
    ...['awayAutoPlayCompact_one', 'awayAutoPlayCompact_other'].map((key) =>
      [`online.play.${key}`, online.play[key]]),
  ].map(([key, copy]) => ({ key, copy: interpolateSample(copy, game.player.player2) }));
};

/** The resting lane, measured from a captured snapshot's `status` record. */
export function checkStatusLaneBox(check, label, expectedLandscape, status) {
  if (expectedLandscape) {
    check(Math.abs(status.box.width - 104) <= 0.5
      && Math.abs(status.box.height - 26) <= 0.5
      && status.lines <= 2,
    `${label} exceeded the 104px/two-line landscape status lane`, status);
  } else {
    check(status.lines <= 1,
      `${label} wrapped the reserved portrait status line`, status);
  }
}

/** Every localized status string the lane can hold, measured in the lane
    itself. DESTROYS the live status text — it writes each candidate into
    #status and does not put the real one back — so call it only after the
    frame for that locale has been captured. */
export async function checkStatusLaneCopies(
  page, rootSelector, locale, label, expectedLandscape, check,
) {
  const failures = [];
  for (const candidate of statusCopies(locale)) {
    const view = await page.evaluate(({ selector, copy }) => {
      const root = document.querySelector(selector);
      const status = root.querySelector('#status');
      status.textContent = copy;
      const box = status.getBoundingClientRect();
      const range = document.createRange();
      range.selectNodeContents(status);
      const text = range.getBoundingClientRect();
      const lines = new Set([...range.getClientRects()].map((line) => line.top.toFixed(2))).size;
      return {
        box: { x: box.x, y: box.y, width: box.width, height: box.height,
          right: box.right, bottom: box.bottom },
        text: { x: text.x, y: text.y, width: text.width, height: text.height,
          right: text.right, bottom: text.bottom },
        lines,
        scrollWidth: status.scrollWidth,
        clientWidth: status.clientWidth,
        scrollHeight: status.scrollHeight,
        clientHeight: status.clientHeight,
      };
    }, { selector: rootSelector, copy: candidate.copy });
    const contained = view.text.x >= view.box.x - 0.5 && view.text.right <= view.box.right + 0.5
      && view.text.y >= view.box.y - 0.5 && view.text.bottom <= view.box.bottom + 0.5
      && view.scrollWidth <= view.clientWidth + 0.5
      && view.scrollHeight <= view.clientHeight + 0.5;
    if (!contained || (expectedLandscape ? view.lines > 2 : view.lines > 1)) {
      failures.push({ ...candidate, view });
    }
  }
  check(failures.length === 0,
    `${label}/${locale} exceeds the reserved status lane`, failures);
}
